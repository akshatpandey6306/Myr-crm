import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Inject, Logger, Optional, Post, Body, Req, Res, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { ExternalCallback, Public, SkipOrganizationContext } from "../auth/public.decorator.js";
import { getWebOrigin } from "../common/web-origin.js";
import { effectiveSubscriptionStatus } from "./subscription-status.js";
import { DemoDataService } from "../demo-data/demo-data.controller.js";
import { PayUService, type PayUVerification } from "./payu.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_FEE = "49.00";
function configuredTrialFee() {
  return process.env.PAYU_MODE?.trim().toLowerCase() === "test" &&
    process.env.PAYU_TEST_TRIAL_AMOUNT?.trim() === "1.00"
    ? "1.00"
    : TRIAL_FEE;
}
const RENEWAL_WINDOW_DAYS = 10;
type PayUReturnResponse = { redirect(statusCode: number, url: string): void };

function amountInPaise(value: unknown): bigint | null {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function intervalEnd(from: Date, interval: "monthly" | "yearly") {
  const end = new Date(from);
  const day = end.getUTCDate();
  const months = interval === "yearly" ? 12 : 1;
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

@SkipOrganizationContext()
@Controller("billing")
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DemoDataService) private readonly demoData: DemoDataService,
    @Optional() @Inject(PayUService) private readonly payu: PayUService = new PayUService(),
  ) {}

  @Get("current")
  async current(@Req() request: HttpRequest) {
    const membership = await this.findMembership(request);
    const organization = membership.organization;
    const [plans, overrides, activationRequest, partnerMapping] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: [{ price: "asc" }, { code: "asc" }],
        select: {
          code: true,
          name: true,
          price: true,
          currency: true,
          billingInterval: true,
          trialDays: true,
          employeeLimit: true,
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
    ]);
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
        plans: plans.map((basePlan) => ({ basePlan, override: overrides.find((item) => item.planCode === basePlan.code) }))
          .filter(({ basePlan, override }) => override?.isActive ?? true)
          .map(({ basePlan, override }) => {
          const plan = override ? { ...override, code: override.planCode } : basePlan;
          return ({
          code: plan.code,
          name: plan.name,
          monthlyPrice: plan.price,
          currency: plan.currency.trim(),
          billingInterval: plan.billingInterval,
          trialDays: plan.trialDays,
          seats: plan.employeeLimit ?? 0,
          features: plan.features,
          modules: plan.modules,
        }); }),
        activationRequest: activationRequest ? {
          id: activationRequest.id,
          planCode: activationRequest.planCode,
          requestType: activationRequest.requestType.toLowerCase(),
          requestedAt: activationRequest.createdAt.toISOString(),
        } : null,
        payuEnabled: this.payu.isConfigured(),
        trialAmount: configuredTrialFee(),
        canManageBilling: membership.role === "OWNER" || membership.role === "ADMIN",
        organizationRole: membership.role.toLowerCase(),
      },
    };
  }

  @Post("subscribe")
  async startTrial(@Req() request: HttpRequest, @Body() body: { planCode?: unknown }) {
    void request;
    void body;
    throw new ConflictException({ code: "payment_required", message: "Trial access now requires completing PayU checkout for the INR 49 fee" });
  }

  @Post("checkout")
  async createCheckout(
    @Req() request: HttpRequest,
    @Body() body: { planCode?: unknown; purchaseType?: unknown; phone?: unknown },
  ) {
    const purchaseType = body?.purchaseType;
    if (typeof body?.planCode !== "string" || !["trial", "plan", "renewal"].includes(String(purchaseType))) {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid plan and payment type" });
    }
    if (!this.payu.isConfigured()) {
      throw new ServiceUnavailableException({ code: "payu_not_configured", message: "PayU test credentials and a reachable callback URL must be configured on the API" });
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
      select: { code: true, name: true, price: true, currency: true, billingInterval: true },
    });
    const override = await this.prisma.organizationSubscriptionPlanOverride?.findUnique?.({
      where: { organizationId_planCode: { organizationId: membership.organization.id, planCode: body.planCode } },
    }) ?? null;
    if (!basePlan) throw new BadRequestException({ code: "validation_error", message: "Choose a valid active subscription plan" });
    const plan = override ? { ...override, code: override.planCode } : basePlan;
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
    const renewalWindowOpen = ["active", "trial"].includes(subscriptionStatus) &&
      currentEnd !== null && currentEnd > now &&
      currentEnd.getTime() <= now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS;
    const allowed = purchaseType === "trial" && subscriptionStatus === "pending" ||
      purchaseType === "plan" && ["pending", "trial", "expired", "cancelled"].includes(subscriptionStatus) ||
      purchaseType === "renewal" && renewalWindowOpen;
    if (!allowed) {
      throw new ConflictException({ code: "subscription_not_payable", message: "This payment type is not available for the workspace's current subscription" });
    }

    const paymentType = purchaseType === "trial" ? "TRIAL" : purchaseType === "renewal" ? "RENEWAL" : "PLAN";
    const amount = paymentType === "TRIAL" ? configuredTrialFee() : plan.price.toFixed(2);
    const paymentId = randomUUID();
    const transactionId = randomBytes(12).toString("hex");
    const productInfo = paymentType === "TRIAL"
      ? "Myr CRM paid two-day trial"
      : `Myr CRM ${plan.name} ${paymentType === "RENEWAL" ? "renewal" : "subscription"}`;
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
    const redirect = (payment: "success" | "failed" | "pending" | "review") => {
      const url = new URL("/subscription", getWebOrigin());
      url.searchParams.set("payment", payment);
      response.redirect(303, url.toString());
    };
    if (!this.payu.verifyCallbackHash(body)) {
      redirect("failed");
      return;
    }
    const transactionId = typeof body.txnid === "string" ? body.txnid : "";
    const payment = transactionId
      ? await this.prisma.subscriptionPayment.findUnique({ where: { transactionId } })
      : null;
    if (!payment || body.udf1 !== payment.id || body.productinfo !== payment.productInfo ||
      amountInPaise(body.amount) !== amountInPaise(payment.amount.toString())) {
      redirect("failed");
      return;
    }
    if (payment.status === "SUCCEEDED") {
      redirect("success");
      return;
    }
    if (payment.status !== "PENDING") {
      redirect("failed");
      return;
    }
    const callbackStatus = String(body.status).toLowerCase();
    if (callbackStatus === "failure") {
      await this.prisma.subscriptionPayment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", failureReason: "PayU reported an unsuccessful payment" },
      });
      redirect("failed");
      return;
    }
    if (callbackStatus !== "success") {
      redirect("pending");
      return;
    }

    let verified: PayUVerification;
    try {
      verified = await this.payu.verifyPayment(transactionId);
    } catch (error) {
      this.logger.warn(`PayU verification is pending for transaction ${transactionId}`, error instanceof Error ? error.message : undefined);
      redirect("pending");
      return;
    }
    if (verified.status === "pending") {
      redirect("pending");
      return;
    }
    if (verified.status !== "success" || verified.transactionId !== transactionId ||
      amountInPaise(verified.amount) !== amountInPaise(payment.amount.toString()) || !verified.payuId) {
      await this.prisma.subscriptionPayment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", failureReason: "PayU verification did not match the order" },
      });
      redirect("failed");
      return;
    }

    const result = await this.activateVerifiedPayment(payment, verified);
    if (result === "success" && payment.paymentType === "TRIAL") {
      try {
        await this.demoData.load(payment.organizationId, payment.requestedByUserId);
      } catch (error) {
        this.logger.error("The paid trial started, but sample workspace data could not be loaded", error instanceof Error ? error.stack : undefined);
      }
    }
    redirect(result);
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
    const renewalWindowOpen = ["active", "trial"].includes(subscriptionStatus) &&
      currentEnd !== null && currentEnd > now &&
      currentEnd.getTime() <= now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS;
    if (!["expired", "cancelled"].includes(subscriptionStatus) && !renewalWindowOpen) {
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
    payment: { id: string; organizationId: string; requestedByUserId: string; planCode: string; paymentType: "TRIAL" | "PLAN" | "RENEWAL"; renewalBaseEndsAt: Date | null },
    verified: PayUVerification,
  ): Promise<"success" | "review"> {
    return this.prisma.$transaction(async (transaction) => {
      const currentPayment = await transaction.subscriptionPayment.findUnique({ where: { id: payment.id } });
      if (!currentPayment) return "review";
      if (currentPayment.status === "SUCCEEDED") return "success";
      if (currentPayment.status !== "PENDING") return "review";

      const organization = await transaction.organization.findUnique({
        where: { id: payment.organizationId },
        select: { id: true, status: true, subscriptionStatus: true, subscriptionEndsAt: true },
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
      const canActivate = organization?.status === "ACTIVE" && plan && (
        payment.paymentType === "TRIAL" && organization.subscriptionStatus === "PENDING" ||
        payment.paymentType === "PLAN" && ["pending", "trial", "expired", "cancelled"].includes(currentStatus) ||
        payment.paymentType === "RENEWAL" && renewalStillMatches && ["active", "trial", "expired", "cancelled"].includes(currentStatus)
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
        return "review";
      }

      const periodStart = payment.paymentType === "RENEWAL" && payment.renewalBaseEndsAt
        ? payment.renewalBaseEndsAt
        : now;
      const subscriptionData = payment.paymentType === "TRIAL"
        ? {
            subscriptionPlan: plan.code,
            subscriptionStatus: "TRIAL" as const,
            subscriptionStartedAt: now,
            subscriptionEndsAt: new Date(now.getTime() + 2 * DAY_MS),
            billingProvider: "payu",
            enabledModules: plan.modules,
          }
        : {
            subscriptionPlan: plan.code,
            subscriptionStatus: "ACTIVE" as const,
            subscriptionStartedAt: periodStart,
            subscriptionEndsAt: intervalEnd(periodStart, plan.billingInterval as "monthly" | "yearly"),
            billingProvider: "payu",
            enabledModules: plan.modules,
          };

      await transaction.organization.update({ where: { id: organization.id }, data: subscriptionData });
      await transaction.subscriptionPayment.update({ where: { id: payment.id }, data: paymentData });
      await transaction.subscriptionActivationRequest.updateMany({
        where: { organizationId: organization.id, status: "PENDING" },
        data: { status: "ACTIVATED" },
      });
      return "success";
    }, { isolationLevel: "Serializable" });
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
