import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Inject, Post, Body, Req, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";
import { effectiveSubscriptionStatus } from "./subscription-status.js";

const TRIAL_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SUBSCRIPTION_PLANS = [
  { code: "starter", name: "Starter", monthlyPrice: 999, currency: "INR", seats: 3, features: ["Core CRM", "Leads and contacts", "Sales pipeline"] },
  { code: "growth", name: "Growth", monthlyPrice: 2499, currency: "INR", seats: 10, features: ["Everything in Starter", "Team collaboration", "Reports and analytics"] },
  { code: "business", name: "Business", monthlyPrice: 4999, currency: "INR", seats: 25, features: ["Everything in Growth", "Advanced permissions", "Priority support"] },
] as const;

type PlanCode = (typeof SUBSCRIPTION_PLANS)[number]["code"];

function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && SUBSCRIPTION_PLANS.some((plan) => plan.code === value);
}

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
        plans: SUBSCRIPTION_PLANS,
        testMode: isTestMode(),
        canManageBilling: membership.role === "OWNER" || membership.role === "ADMIN",
      },
    };
  }

  @Post("subscribe")
  async startTestSubscription(@Req() request: HttpRequest, @Body() body: { planCode?: unknown }) {
    if (!isPlanCode(body?.planCode)) {
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
    if (membership.organization.status !== "ACTIVE") {
      throw new ForbiddenException({ code: "organization_suspended", message: "This workspace has been suspended. Contact your account administrator." });
    }

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + TRIAL_DAYS * DAY_MS);
    const result = await this.prisma.organization.updateMany({
      where: { id: membership.organization.id, subscriptionStatus: "PENDING" },
      data: {
        subscriptionPlan: body.planCode,
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
        planCode: body.planCode,
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
