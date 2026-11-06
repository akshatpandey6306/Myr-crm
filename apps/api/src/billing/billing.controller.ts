import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Inject, Post, Body, Req, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";
import { effectiveSubscriptionStatus } from "./subscription-status.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_MODULES = ["leads", "contacts", "companies", "deals", "activities", "team", "settings"];

@SkipOrganizationContext()
@Controller("billing")
export class BillingController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("current")
  async current(@Req() request: HttpRequest) {
    const membership = await this.findMembership(request);
    const organization = membership.organization;
    const [plans, activationRequest] = await Promise.all([
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
      this.prisma.subscriptionActivationRequest.findFirst({
        where: { organizationId: organization.id, status: "PENDING" },
        select: { id: true, planCode: true, requestType: true, createdAt: true },
      }),
    ]);
    return {
      data: {
        organization: { id: organization.id, name: organization.name, status: organization.status.toLowerCase() },
        subscription: {
          planCode: organization.subscriptionPlan,
          status: effectiveSubscriptionStatus(organization.subscriptionStatus, organization.subscriptionEndsAt),
          startsAt: organization.subscriptionStartedAt?.toISOString() ?? null,
          endsAt: organization.subscriptionEndsAt?.toISOString() ?? null,
          provider: organization.billingProvider,
        },
        plans: plans.map((plan) => ({
          code: plan.code,
          name: plan.name,
          monthlyPrice: plan.price,
          currency: plan.currency.trim(),
          billingInterval: plan.billingInterval,
          trialDays: plan.trialDays,
          seats: plan.employeeLimit ?? 0,
          features: plan.features,
          modules: plan.modules,
        })),
        activationRequest: activationRequest ? {
          id: activationRequest.id,
          planCode: activationRequest.planCode,
          requestType: activationRequest.requestType.toLowerCase(),
          requestedAt: activationRequest.createdAt.toISOString(),
        } : null,
        canManageBilling: membership.role === "OWNER" || membership.role === "ADMIN",
        organizationRole: membership.role.toLowerCase(),
      },
    };
  }

  @Post("subscribe")
  async requestTrial(@Req() request: HttpRequest, @Body() body: { planCode?: unknown }) {
    if (typeof body?.planCode !== "string") {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid subscription plan" });
    }

    const membership = await this.findMembership(request);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException({ code: "forbidden", message: "Only a workspace owner or administrator can manage billing" });
    }
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { code: body.planCode, isActive: true },
      select: { code: true },
    });
    if (!plan) throw new BadRequestException({ code: "validation_error", message: "Choose a valid active subscription plan" });
    if (membership.organization.status !== "ACTIVE") {
      throw new ForbiddenException({ code: "organization_suspended", message: "This workspace has been suspended. Contact your account administrator." });
    }

    if (membership.organization.subscriptionStatus !== "PENDING") {
      throw new ConflictException({
        code: "subscription_exists",
        message: "This workspace already has a subscription or has requested its trial.",
      });
    }
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const existing = await this.prisma.subscriptionActivationRequest.findFirst({
      where: { organizationId: membership.organization.id, status: "PENDING" },
      select: { id: true, planCode: true, requestType: true, createdAt: true },
    });
    if (existing) return { data: this.activationRequestData(existing) };
    try {
      const created = await this.prisma.subscriptionActivationRequest.create({
        data: {
          organizationId: membership.organization.id,
          requestedById: request.userId,
          planCode: plan.code,
          requestType: "TRIAL",
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
    if (!["expired", "cancelled"].includes(subscriptionStatus)) {
      throw new ConflictException({ code: "subscription_not_ended", message: "Activation can be requested after the free trial or subscription ends" });
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
    return membership;
  }
}
