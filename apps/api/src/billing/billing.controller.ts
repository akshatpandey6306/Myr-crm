import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Inject, Logger, NotFoundException, Optional, Param, Post, Body, Req, Res, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { ExternalCallback, Public, SkipOrganizationContext } from "../auth/public.decorator.js";
import { getWebOrigin } from "../common/web-origin.js";
import { effectiveSubscriptionStatus } from "./subscription-status.js";
import { PayUService, type PayUVerification } from "./payu.service.js";
import { AuthEmailService } from "../auth/email.service.js";
import { billingPeriodEnd } from "./billing-period.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RENEWAL_WINDOW_DAYS = 10;
type PayUReturnResponse = { redirect(statusCode: number, url: string): void };

function amountInPaise(value: unknown): bigint | null {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function intervalEnd(from: Date, interval: number) {
  return billingPeriodEnd(from, interval)!;
}

@SkipOrganizationContext()
@Controller("billing")
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(PayUService) private readonly payu: PayUService = new PayUService(),
    @Optional() @Inject(AuthEmailService) private readonly authEmail?: AuthEmailService,
  ) {}

  @Get("current")
  async current(@Req() request: HttpRequest) {
    const membership = await this.findMembership(request);
    const organization = membership.organization;
    const [plans, overrides, activationRequest, partnerMapping, seatPurchases, activeUsers, pendingUsers] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: [{ price: "asc" }, { code: "asc" }],
        select: {
          code: true,
          name: true,
          price: true,
          currency: true,
          billingInterval: true,
          employeeLimit: true,
          additionalSeatsEnabled: true,
          additionalSeatPrice: true,
          features: true,
          modules: true,
        },
      }),
      this.prisma.organizationSubscriptionPlanOverride?.findMany?.({
        where: { organizationId: organization.id, plan: { isActive: true } },
      }) ?? Promise.resolve([]),
      this.prisma.subscriptionActivationRequest.findFirst({
        where: { organizationId: organization.id, status: "PENDING" },
        select: { id: true, planCode: true, requestType: true, createdAt: true },
      }),
      this.prisma.partnerCustomerMapping?.findFirst?.({ where: { organizationId: organization.id }, include: { partner: { select: { plansUrl: true } } } }) ?? Promise.resolve(null),
      this.prisma.additionalSeatPurchase.findMany({ where: { organizationId: organization.id }, orderBy: { purchasedAt: "desc" }, take: 50 }),
      this.prisma.membership.count({ where: { organizationId: organization.id, status: "ACTIVE", user: { status: "ACTIVE" } } }),
      this.prisma.membership.count({ where: { organizationId: organization.id, status: "PENDING", user: { status: "ACTIVE" } } }),
    ]);
    const seatNow = new Date();
    const subscriptionActive = effectiveSubscriptionStatus(organization.subscriptionStatus, organization.subscriptionEndsAt) === "active";
    const activeSeatPurchases = subscriptionActive ? seatPurchases.filter((purchase) => purchase.status === "ACTIVE" && purchase.startsAt <= seatNow && purchase.endsAt > seatNow) : [];
    const additionalSeats = activeSeatPurchases.reduce((total, purchase) => total + purchase.quantity, 0);
    const effectivePlans = plans.map((basePlan) => ({ basePlan, override: overrides.find((item) => item.planCode === basePlan.code) }))
      .filter(({ override }) => override?.isActive ?? true)
      .map(({ basePlan, override }) => {
        const plan = override ? { ...basePlan, ...override, code: override.planCode } : basePlan;
        return { code: plan.code, name: plan.name, monthlyPrice: plan.price, currency: plan.currency.trim(), billingInterval: plan.billingInterval, seats: plan.employeeLimit ?? 0,
          additionalSeatsEnabled: plan.additionalSeatsEnabled ?? false, additionalSeatPrice: plan.additionalSeatPrice ?? 0, features: plan.features, modules: plan.modules };
      });
    return {
      data: {
        organization: { id: organization.id, name: organization.name, status: organization.status.toLowerCase() },
        partnerPlansUrl: partnerMapping?.partner.plansUrl ?? null,
        subscription: {
          planCode: organization.subscriptionPlan,
          status: effectiveSubscriptionStatus(organization.subscriptionStatus, organization.subscriptionEndsAt),
          startsAt: organization.subscriptionStartedAt?.toISOString() ?? null,
          endsAt: organization.subscriptionEndsAt?.toISOString() ?? null,
          provider: organization.billingProvider,
        },
        plans: effectivePlans,
        activationRequest: activationRequest ? {
          id: activationRequest.id,
          planCode: activationRequest.planCode,
          requestType: activationRequest.requestType.toLowerCase(),
          requestedAt: activationRequest.createdAt.toISOString(),
        } : null,
        payuEnabled: this.payu.isConfigured(),
        canManageBilling: membership.role === "OWNER" || membership.role === "ADMIN",
        organizationRole: membership.role.toLowerCase(),
        seats: {
          included: effectivePlans.find((plan) => plan.code === organization.subscriptionPlan)?.seats ?? 0,
          additional: additionalSeats,
          activeUsers,
            pendingUsers,
          purchases: seatPurchases.map((purchase) => ({ quantity: purchase.quantity, unitPrice: purchase.unitPrice, billingInterval: purchase.billingInterval, currency: purchase.currency.trim(), status: purchase.status.toLowerCase(), purchasedAt: purchase.purchasedAt.toISOString(), endsAt: purchase.endsAt.toISOString() })),
        },
      },
    };
  }

  @Post("checkout")
  async createCheckout(
    @Req() request: HttpRequest,
    @Body() body: { planCode?: unknown; purchaseType?: unknown; phone?: unknown; seatQuantity?: unknown },
  ) {
    const purchaseType = body?.purchaseType;
    if (typeof body?.planCode !== "string" || !["plan", "renewal", "seats"].includes(String(purchaseType))) {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid plan and payment type" });
    }
    if (!this.payu.isConfigured()) {
      throw new ServiceUnavailableException({ code: "payu_not_configured", message: "PayU merchant credentials and a reachable callback URL must be configured on the API" });
    }
    const phone = typeof body.phone === "string" ? body.phone.trim().replace(/[\s()-]/g, "") : "";
    if (!/^\+?[1-9]\d{6,14}$/.test(phone)) {
      throw new BadRequestException({ code: "validation_error", message: "Enter a valid phone number for PayU checkout" });
    }
    const membership = await this.findMembership(request);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException({ code: "forbidden", message: "Only a workspace owner or administrator can manage billing" });
    }
    if (membership.organization.status !== "ACTIVE") {
      throw new ForbiddenException({ code: "organization_suspended", message: "This workspace has been suspended. Contact your account administrator." });
    }

    const basePlan = await this.prisma.subscriptionPlan.findFirst({
      where: { code: body.planCode, isActive: true },
      select: { code: true, name: true, price: true, currency: true, billingInterval: true, additionalSeatsEnabled: true, additionalSeatPrice: true },
    });
    const override = await this.prisma.organizationSubscriptionPlanOverride?.findUnique?.({
      where: { organizationId_planCode: { organizationId: membership.organization.id, planCode: body.planCode } },
    }) ?? null;
    if (!basePlan) throw new BadRequestException({ code: "validation_error", message: "Choose a valid active subscription plan" });
    const plan = override ? {
      ...override,
      code: override.planCode,
      additionalSeatsEnabled: override.additionalSeatsEnabled ?? basePlan.additionalSeatsEnabled,
      additionalSeatPrice: override.additionalSeatPrice ?? basePlan.additionalSeatPrice,
    } : basePlan;
    if (override && !override.isActive) throw new BadRequestException({ code: "plan_unavailable", message: "This plan is unavailable for the workspace" });
    if (!plan) throw new BadRequestException({ code: "validation_error", message: "Choose a valid active subscription plan" });
    if (plan.currency.trim().toUpperCase() !== "INR" || !Number.isSafeInteger(plan.price) || plan.price <= 0) {
      throw new BadRequestException({ code: "plan_currency_unsupported", message: "PayU checkout currently requires a positive INR plan price" });
    }

    const subscriptionStatus = effectiveSubscriptionStatus(
      membership.organization.subscriptionStatus,
      membership.organization.subscriptionEndsAt,
    );
    const now = new Date();
    const currentEnd = membership.organization.subscriptionEndsAt;
    const renewalAllowed = subscriptionStatus === "active" &&
      currentEnd !== null && currentEnd > now &&
      membership.organization.subscriptionPlan === plan.code;
    const seatQuantity = purchaseType === "seats" ? Number(body.seatQuantity) : 0;
    if (purchaseType === "seats" && (!Number.isSafeInteger(seatQuantity) || seatQuantity < 1 || seatQuantity > 500)) {
      throw new BadRequestException({ code: "validation_error", message: "Choose between 1 and 500 additional seats" });
    }
    const seatPurchases = purchaseType === "seats" || purchaseType === "renewal"
      ? await this.prisma.additionalSeatPurchase.findMany({ where: { organizationId: membership.organization.id, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } }, select: { quantity: true, unitPrice: true } })
      : [];
    const currentAdditionalSeats = seatPurchases.reduce((total, item) => total + item.quantity, 0);
    const allowed = purchaseType === "plan" && (subscriptionStatus !== "active" || membership.organization.subscriptionPlan !== plan.code) ||
      purchaseType === "renewal" && renewalAllowed ||
      purchaseType === "seats" && subscriptionStatus === "active" && membership.organization.subscriptionPlan === plan.code && plan.additionalSeatsEnabled && plan.additionalSeatPrice > 0;
    if (!allowed) {
      throw new ConflictException({ code: "subscription_not_payable", message: "This payment type is not available for the workspace's current subscription" });
    }

    const paymentType = purchaseType === "renewal" ? "RENEWAL" : purchaseType === "seats" ? "SEAT_ADDON" : "PLAN";
    const seatUnitPrice = purchaseType === "seats" ? plan.additionalSeatPrice : null;
    const billedSeats = purchaseType === "seats" ? seatQuantity : purchaseType === "renewal" ? currentAdditionalSeats : 0;
    const seatCharge = purchaseType === "seats"
      ? seatQuantity * plan.additionalSeatPrice
      : purchaseType === "renewal"
        ? seatPurchases.reduce((total, item) => total + item.quantity * item.unitPrice, 0)
        : 0;
    const amount = (paymentType === "SEAT_ADDON" ? seatCharge : plan.price + seatCharge).toFixed(2);
    const paymentId = randomUUID();
    const transactionId = randomBytes(12).toString("hex");
    const productInfo = `LeadPilot ${plan.name} ${paymentType === "RENEWAL" ? "renewal" : paymentType === "SEAT_ADDON" ? `${seatQuantity} additional seats` : "subscription"}`;
    const checkout = this.payu.createCheckout({
      paymentId,
      transactionId,
      amount,
      productInfo,
      firstName: membership.user.name.trim().split(/\s+/)[0] || "Customer",
      email: membership.user.email,
      phone,
    });
    await this.prisma.subscriptionPayment.create({
      data: {
        id: paymentId,
        organizationId: membership.organization.id,
        requestedByUserId: membership.userId,
        planCode: plan.code,
        productInfo,
        paymentType,
        ...(paymentType === "SEAT_ADDON" || paymentType === "RENEWAL" ? { seatQuantity: billedSeats, seatUnitPrice } : {}),
        ...(paymentType === "SEAT_ADDON" || paymentType === "RENEWAL" ? { seatAmount: seatCharge.toFixed(2) } : {}),
        transactionId,
        amount,
        currency: "INR",
        renewalBaseEndsAt: paymentType === "RENEWAL" ? currentEnd : null,
      },
    });
    return { data: { transactionId, checkoutUrl: checkout.checkoutUrl, fields: checkout.fields } };
  }

  @Public()
  @ExternalCallback()
  @Post("payu/return")
  async payuReturn(@Body() body: Record<string, unknown>, @Res() response: PayUReturnResponse) {
    const redirect = (payment: "success" | "failed" | "pending" | "review", transactionId?: string) => {
      const url = new URL("/subscription", getWebOrigin());
      url.searchParams.set("payment", payment);
      if (transactionId) url.searchParams.set("transaction", transactionId);
      response.redirect(303, url.toString());
    };
    const transactionId = typeof body.txnid === "string" ? body.txnid : "";
    const hasValidReference = /^[a-f0-9]{24}$/i.test(transactionId);
    if (!this.payu.verifyCallbackHash(body)) {
      redirect(hasValidReference ? "pending" : "failed", hasValidReference ? transactionId : undefined);
      return;
    }
    const payment = transactionId
      ? await this.prisma.subscriptionPayment.findUnique({ where: { transactionId } })
      : null;
    if (!payment || body.udf1 !== payment.id || body.productinfo !== payment.productInfo ||
      amountInPaise(body.amount) !== amountInPaise(payment.amount.toString())) {
      redirect(hasValidReference ? "pending" : "failed", hasValidReference ? transactionId : undefined);
      return;
    }
    if (payment.status === "SUCCEEDED") {
      redirect(payment.failureReason ? "review" : "success", transactionId);
      return;
    }
    if (payment.status !== "PENDING") {
      redirect("failed", transactionId);
      return;
    }
    const callbackStatus = String(body.status).toLowerCase();
    if (callbackStatus === "failure") {
      await this.prisma.subscriptionPayment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", failureReason: "PayU reported an unsuccessful payment" },
      });
      redirect("failed", transactionId);
      return;
    }
    if (callbackStatus !== "success") {
      redirect("pending", transactionId);
      return;
    }

    let verified: PayUVerification;
    try {
      verified = await this.payu.verifyPayment(transactionId);
    } catch (error) {
      this.logger.warn(`PayU verification is pending for transaction ${transactionId}`, error instanceof Error ? error.message : undefined);
      redirect("pending", transactionId);
      return;
    }
    if (verified.status === "pending") {
      redirect("pending", transactionId);
      return;
    }
    if (verified.status !== "success" || verified.transactionId !== transactionId ||
      amountInPaise(verified.amount) !== amountInPaise(payment.amount.toString()) || !verified.payuId) {
      await this.prisma.subscriptionPayment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", failureReason: "PayU verification did not match the order" },
      });
      redirect("failed", transactionId);
      return;
    }

    const activation = await this.activateVerifiedPayment(payment, verified);
    if (activation.activated) await this.notifyWorkspaceAdmins(payment);
    redirect(activation.result, transactionId);
  }

  @Get("payment-status/:transactionId")
  async paymentStatus(@Req() request: HttpRequest, @Param("transactionId") transactionId: string) {
    if (!/^[a-f0-9]{24}$/i.test(transactionId)) throw new NotFoundException({ code: "payment_not_found", message: "Payment was not found" });
    const membership = await this.findMembership(request);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException({ code: "forbidden", message: "Only a workspace owner or administrator can view payment status" });
    }
    const payment = await this.prisma.subscriptionPayment.findFirst({ where: { organizationId: membership.organization.id, transactionId } });
    if (!payment) throw new NotFoundException({ code: "payment_not_found", message: "Payment was not found" });

    let status = payment.status === "SUCCEEDED"
      ? payment.failureReason ? "review" : "success"
      : payment.status.toLowerCase();
    let failureReason = payment.failureReason;
    if (payment.status === "PENDING") {
      try {
        const verified = await this.payu.verifyPayment(transactionId);
        if (verified.status === "failure") {
          failureReason = "PayU confirmed that the payment failed";
          await this.prisma.subscriptionPayment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureReason } });
          status = "failed";
        } else if (verified.status === "success") {
          if (verified.transactionId !== transactionId || amountInPaise(verified.amount) !== amountInPaise(payment.amount.toString()) || !verified.payuId) {
            failureReason = "PayU verification did not match the order";
            await this.prisma.subscriptionPayment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureReason } });
            status = "failed";
          } else {
            const activation = await this.activateVerifiedPayment(payment, verified);
            status = activation.result;
            failureReason = status === "review" ? "Payment verified; workspace state needs platform review" : null;
            if (activation.activated) await this.notifyWorkspaceAdmins(payment);
          }
        }
      } catch (error) {
        this.logger.warn(`PayU status recheck is pending for transaction ${transactionId}`, error instanceof Error ? error.message : undefined);
      }
    }
    return { data: { status, planCode: payment.planCode, paymentType: payment.paymentType.toLowerCase(), seatQuantity: payment.seatQuantity, amount: payment.amount.toString(), failureReason } };
  }

  @Get("payments")
  async paymentHistory(@Req() request: HttpRequest) {
    const membership = await this.findMembership(request);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException({ code: "forbidden", message: "Only a workspace owner or administrator can view subscription payments" });
    }
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: { organizationId: membership.organization.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        planCode: true,
        paymentType: true,
          seatQuantity: true,
        seatAmount: true,
        transactionId: true,
        amount: true,
        currency: true,
        status: true,
        payuId: true,
        bankReference: true,
        failureReason: true,
        verifiedAt: true,
        createdAt: true,
        requestedBy: { select: { user: { select: { name: true, email: true } } } },
      },
    });
    return { data: payments.map((payment) => ({
      ...payment,
      organizationName: membership.organization.name,
      customerName: payment.requestedBy.user.name,
      customerEmail: payment.requestedBy.user.email,
      requestedBy: undefined,
      paymentType: payment.paymentType.toLowerCase(),
        seatQuantity: payment.seatQuantity,
        seatAmount: payment.seatAmount?.toString() ?? null,
      status: payment.status.toLowerCase(),
      amount: payment.amount.toString(),
      currency: payment.currency.trim(),
      verifiedAt: payment.verifiedAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    })) };
  }

  @Post("request-activation")
  async requestActivation(@Req() request: HttpRequest, @Body() body: { planCode?: unknown }) {
    if (typeof body?.planCode !== "string") {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid subscription plan" });
    }
    const membership = await this.findMembership(request);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException({ code: "forbidden", message: "Only a workspace owner or administrator can request activation" });
    }
    const subscriptionStatus = effectiveSubscriptionStatus(
      membership.organization.subscriptionStatus,
      membership.organization.subscriptionEndsAt,
    );
    const now = new Date();
    const currentEnd = membership.organization.subscriptionEndsAt;
    const renewalWindowOpen = subscriptionStatus === "active" &&
      currentEnd !== null && currentEnd > now &&
      currentEnd.getTime() <= now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS;
    const subscriptionInactive = subscriptionStatus !== "active";
    if (!subscriptionInactive && !renewalWindowOpen) {
      throw new ConflictException({ code: "subscription_not_renewable", message: "Renewal can be requested during the final 10 days of a plan or after it expires" });
    }
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { code: body.planCode, isActive: true },
      select: { code: true },
    });
    if (!plan) throw new BadRequestException({ code: "validation_error", message: "Choose a valid active subscription plan" });

    const existing = await this.prisma.subscriptionActivationRequest.findFirst({
      where: { organizationId: membership.organization.id, status: "PENDING" },
      select: { id: true, planCode: true, requestType: true, createdAt: true },
    });
    if (existing) return { data: this.activationRequestData(existing) };

    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    try {
      const created = await this.prisma.subscriptionActivationRequest.create({
        data: {
          organizationId: membership.organization.id,
          requestedById: request.userId,
          planCode: plan.code,
          requestType: "ACTIVATION",
        },
        select: { id: true, planCode: true, requestType: true, createdAt: true },
      });
      return { data: this.activationRequestData(created) };
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") throw error;
      const concurrent = await this.prisma.subscriptionActivationRequest.findFirst({
        where: { organizationId: membership.organization.id, status: "PENDING" },
        select: { id: true, planCode: true, requestType: true, createdAt: true },
      });
      if (!concurrent) throw error;
      return { data: this.activationRequestData(concurrent) };
    }
  }

  private activationRequestData(request: { id: string; planCode: string; requestType: string; createdAt: Date }) {
    return {
      id: request.id,
      planCode: request.planCode,
      requestType: request.requestType.toLowerCase(),
      requestedAt: request.createdAt.toISOString(),
    };
  }

  private async activateVerifiedPayment(
    payment: { id: string; organizationId: string; requestedByUserId: string; planCode: string; paymentType: "TRIAL" | "PLAN" | "RENEWAL" | "SEAT_ADDON"; seatQuantity: number | null; seatUnitPrice: number | null; renewalBaseEndsAt: Date | null; createdAt: Date },
    verified: PayUVerification,
  ): Promise<{ result: "success" | "review"; activated: boolean }> {
    return this.prisma.$transaction(async (transaction) => {
      const currentPayment = await transaction.subscriptionPayment.findUnique({ where: { id: payment.id } });
      if (!currentPayment) return { result: "review", activated: false };
      if (currentPayment.status === "SUCCEEDED") return { result: currentPayment.failureReason ? "review" : "success", activated: false };
      if (currentPayment.status !== "PENDING") return { result: "review", activated: false };

      const organization = await transaction.organization.findUnique({
        where: { id: payment.organizationId },
        select: { id: true, status: true, subscriptionStatus: true, subscriptionPlan: true, subscriptionStartedAt: true, subscriptionEndsAt: true },
      });
      const basePlan = await transaction.subscriptionPlan.findFirst({
        where: { code: payment.planCode, isActive: true },
        select: { code: true, billingInterval: true, modules: true },
      });
      const override = await transaction.organizationSubscriptionPlanOverride?.findUnique?.({
        where: { organizationId_planCode: { organizationId: payment.organizationId, planCode: payment.planCode } },
        select: { planCode: true, billingInterval: true, modules: true, isActive: true },
      }) ?? null;
      const plan = !basePlan ? null : override?.isActive ? { ...override, code: override.planCode } : override ? null : basePlan;
      const now = new Date();
      const currentStatus = organization
        ? effectiveSubscriptionStatus(organization.subscriptionStatus, organization.subscriptionEndsAt)
        : "missing";
      const renewalStillMatches = payment.paymentType === "RENEWAL" && payment.renewalBaseEndsAt !== null &&
        organization?.subscriptionEndsAt?.getTime() === payment.renewalBaseEndsAt.getTime();
      const renewalSeatCount = payment.paymentType === "RENEWAL" && payment.renewalBaseEndsAt && payment.seatQuantity
        ? await transaction.additionalSeatPurchase.aggregate({
          where: { organizationId: payment.organizationId, status: "ACTIVE", startsAt: { lt: payment.renewalBaseEndsAt }, endsAt: payment.renewalBaseEndsAt },
          _sum: { quantity: true },
        }).then((result) => result._sum.quantity ?? 0)
        : 0;
      const renewalSeatsStillMatch = payment.paymentType !== "RENEWAL" || (payment.seatQuantity ?? 0) === renewalSeatCount;
      const seatAddonCanActivate = payment.paymentType === "SEAT_ADDON" && organization?.subscriptionStatus === "ACTIVE" &&
        organization.subscriptionPlan === payment.planCode && Boolean(organization.subscriptionEndsAt && organization.subscriptionEndsAt > now) &&
        Boolean(payment.seatQuantity && payment.seatQuantity > 0 && payment.seatUnitPrice && payment.seatUnitPrice > 0);
      const canActivate = payment.paymentType !== "TRIAL" && organization?.status === "ACTIVE" && plan && (
        payment.paymentType === "PLAN" && (currentStatus !== "active" || organization.subscriptionPlan !== payment.planCode &&
          (!organization.subscriptionStartedAt || organization.subscriptionStartedAt <= payment.createdAt)) ||
        payment.paymentType === "RENEWAL" && renewalStillMatches && renewalSeatsStillMatch && ["active", "expired", "cancelled"].includes(currentStatus) ||
        seatAddonCanActivate
      );
      const paymentData = {
        status: "SUCCEEDED" as const,
        payuId: verified.payuId,
        bankReference: verified.bankReference,
        verifiedAt: now,
        failureReason: canActivate ? null : "Payment verified; subscription needs platform review because workspace state changed",
      };

      if (!canActivate || !organization || !plan) {
        await transaction.subscriptionPayment.update({ where: { id: payment.id }, data: paymentData });
        return { result: "review", activated: false };
      }

      const periodStart = payment.paymentType === "RENEWAL" && payment.renewalBaseEndsAt
        ? payment.renewalBaseEndsAt
        : now;
      const subscriptionData = {
            subscriptionPlan: plan.code,
            subscriptionStatus: "ACTIVE" as const,
            subscriptionStartedAt: periodStart,
            subscriptionEndsAt: intervalEnd(periodStart, plan.billingInterval),
            billingProvider: "payu",
            enabledModules: plan.modules,
          };

      if (payment.paymentType !== "SEAT_ADDON") {
        if (payment.paymentType === "RENEWAL" && payment.seatQuantity && payment.seatQuantity > 0 && payment.renewalBaseEndsAt) {
          const renewedAddons = await transaction.additionalSeatPurchase.updateMany({
            where: { organizationId: organization.id, status: "ACTIVE", startsAt: { lt: payment.renewalBaseEndsAt }, endsAt: payment.renewalBaseEndsAt },
            data: { startsAt: payment.renewalBaseEndsAt, endsAt: subscriptionData.subscriptionEndsAt },
          });
          if (!renewedAddons.count) {
            await transaction.subscriptionPayment.update({ where: { id: payment.id }, data: { ...paymentData, failureReason: "Verified renewal did not match active additional seats; platform review required" } });
            return { result: "review", activated: false };
          }
        }
        if (payment.paymentType === "PLAN" && currentStatus === "active" && organization.subscriptionPlan !== plan.code && organization.subscriptionEndsAt) {
          await transaction.additionalSeatPurchase.updateMany({
            where: { organizationId: organization.id, status: "ACTIVE", endsAt: { gt: now } },
            data: { endsAt: subscriptionData.subscriptionEndsAt },
          });
        }
        await transaction.organization.update({ where: { id: organization.id }, data: subscriptionData });
      } else {
        await transaction.additionalSeatPurchase.create({ data: {
          organizationId: organization.id, paymentId: payment.id, planCode: plan.code, quantity: payment.seatQuantity!,
          unitPrice: payment.seatUnitPrice!, billingInterval: plan.billingInterval, currency: "INR", status: "ACTIVE",
          startsAt: now, endsAt: organization.subscriptionEndsAt!,
        } });
      }
      await transaction.subscriptionPayment.update({ where: { id: payment.id }, data: paymentData });
      await transaction.subscriptionActivationRequest.updateMany({
        where: { organizationId: organization.id, status: "PENDING" },
        data: { status: "ACTIVATED" },
      });
      return { result: "success", activated: true };
    }, { isolationLevel: "Serializable" });
  }

  private async notifyWorkspaceAdmins(payment: {
    organizationId: string;
    planCode: string;
    paymentType: "TRIAL" | "PLAN" | "RENEWAL" | "SEAT_ADDON";
    seatQuantity: number | null;
    amount: { toString(): string };
    currency: string;
    transactionId: string;
    payuId: string | null;
    bankReference: string | null;
  }) {
    if (!this.authEmail?.isConfigured()) {
      this.logger.warn(`Subscription payment for organization ${payment.organizationId} was verified, but SMTP is not configured; admin email was skipped.`);
      return;
    }
    try {
      const [organization, basePlan, override, recipients] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: payment.organizationId },
          select: { name: true, subscriptionStartedAt: true, subscriptionEndsAt: true },
        }),
        this.prisma.subscriptionPlan.findUnique({ where: { code: payment.planCode }, select: { name: true, features: true, modules: true } }),
        this.prisma.organizationSubscriptionPlanOverride.findUnique({
          where: { organizationId_planCode: { organizationId: payment.organizationId, planCode: payment.planCode } },
          select: { name: true, features: true, modules: true, isActive: true },
        }),
        this.prisma.membership.findMany({
          where: { organizationId: payment.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE", user: { status: "ACTIVE" } },
          select: { user: { select: { name: true, email: true } } },
        }),
      ]);
      if (!organization) return;
      const plan = override?.isActive ? override : basePlan;
      const uniqueRecipients = new Map(recipients.map(({ user }) => [user.email.toLowerCase(), user]));
      const deliveries = await Promise.allSettled([...uniqueRecipients.values()].map((user) => this.authEmail!.sendSubscriptionPaymentNotice({
        to: user.email,
        recipientName: user.name,
        organizationName: organization.name,
        planName: plan?.name ?? payment.planCode,
        paymentType: payment.paymentType,
          seatQuantity: payment.seatQuantity,
        amount: payment.amount.toString(),
        currency: payment.currency.trim(),
        transactionId: payment.transactionId,
        paymentReference: payment.payuId ?? payment.bankReference,
        features: plan?.features ?? [],
        modules: plan?.modules ?? [],
        startsAt: organization.subscriptionStartedAt,
        endsAt: organization.subscriptionEndsAt,
      })));
      const failures = deliveries.filter((delivery) => delivery.status === "rejected").length;
      if (failures) this.logger.warn(`Subscription verified for ${organization.name}; ${failures} workspace-admin email(s) were not delivered.`);
    } catch (error) {
      this.logger.error("Subscription payment was verified, but workspace-admin email notification failed.", error instanceof Error ? error.stack : undefined);
    }
  }

  private async findMembership(request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const requestedOrganizationId = request.headers["x-organization-id"];
    const organizationId = typeof requestedOrganizationId === "string" ? requestedOrganizationId : undefined;
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: request.userId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
        ...(organizationId ? { organizationId } : {}),
      },
      include: {
        user: { select: { name: true, email: true } },
        organization: {
          select: {
            id: true,
            name: true,
            status: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            subscriptionStartedAt: true,
            subscriptionEndsAt: true,
            billingProvider: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) throw new ForbiddenException({ code: "workspace_required", message: "No active workspace is available for this account." });
    return { ...membership, userId: request.userId };
  }
}
