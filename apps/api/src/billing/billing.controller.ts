import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Inject, Post, Body, Req, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";
import { effectiveSubscriptionStatus } from "./subscription-status.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function isTestMode() {
  return process.env.BILLING_TEST_MODE === "true" && process.env.NODE_ENV !== "production";
}

@SkipOrganizationContext()
@Controller("billing")
export class BillingController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("current")
  async current(@Req() request: HttpRequest) {
    const membership = await this.findMembership(request);
    const organization = membership.organization;
    const plans = await this.prisma.subscriptionPlan.findMany({
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
      },
    });
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
        })),
        testMode: isTestMode(),
        canManageBilling: membership.role === "OWNER" || membership.role === "ADMIN",
        organizationRole: membership.role.toLowerCase(),
      },
    };
  }

  @Post("subscribe")
  async startTestSubscription(@Req() request: HttpRequest, @Body() body: { planCode?: unknown }) {
    if (typeof body?.planCode !== "string") {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid subscription plan" });
    }
    if (!isTestMode()) {
      throw new ServiceUnavailableException({
        code: "billing_unavailable",
        message: "Online checkout is not configured yet. Contact the platform team to activate your subscription.",
      });
    }

    const membership = await this.findMembership(request);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException({ code: "forbidden", message: "Only a workspace owner or administrator can manage billing" });
    }
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { code: body.planCode, isActive: true },
      select: { code: true, trialDays: true },
    });
    if (!plan) throw new BadRequestException({ code: "validation_error", message: "Choose a valid active subscription plan" });
    if (membership.organization.status !== "ACTIVE") {
      throw new ForbiddenException({ code: "organization_suspended", message: "This workspace has been suspended. Contact your account administrator." });
    }

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + (plan.trialDays || 2) * DAY_MS);
    const result = await this.prisma.organization.updateMany({
      where: { id: membership.organization.id, subscriptionStatus: "PENDING" },
      data: {
        subscriptionPlan: plan.code,
        subscriptionStatus: "TRIAL",
        subscriptionStartedAt: startsAt,
        subscriptionEndsAt: endsAt,
        billingProvider: "test",
      },
    });
    if (result.count !== 1) {
      throw new ConflictException({
        code: "subscription_exists",
        message: "This workspace already has a subscription or has used its test trial. Contact the platform team for help.",
      });
    }

    return {
      data: {
        planCode: plan.code,
        status: "trial",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        provider: "test",
      },
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
