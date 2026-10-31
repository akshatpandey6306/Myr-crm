import { createHash, randomBytes, scryptSync } from "node:crypto";


import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { AuditService } from "../audit/audit.service.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";
import { PlatformAdminGuard } from "../auth/platform-admin.guard.js";
import { SUBSCRIPTION_PLANS } from "../billing/billing.controller.js";
import { effectiveSubscriptionStatus } from "../billing/subscription-status.js";

const PLAN_CODES = new Set<string>(SUBSCRIPTION_PLANS.map((plan) => plan.code));

@SkipOrganizationContext()
@UseGuards(PlatformAdminGuard)
@Controller("control-panel")
export class ControlPanelController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  @Get("access")
  access() {
    return { data: { isPlatformAdmin: true } };
  }

  @Get("organizations")
  async listOrganizations() {
    const organizations = await this.prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionStartedAt: true,
        subscriptionEndsAt: true,
        billingProvider: true,
        memberships: {
          where: { status: "ACTIVE", role: "OWNER", user: { status: "ACTIVE" } },
          select: { user: { select: { name: true, email: true } } },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const memberCounts = await this.prisma.membership.groupBy({
      by: ["organizationId"],
      where: { status: "ACTIVE", user: { status: "ACTIVE" } },
      _count: { _all: true },
    });
    const countsByOrganization = new Map(memberCounts.map((entry) => [entry.organizationId, entry._count._all]));

    return {
      data: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        status: organization.status.toLowerCase(),
        memberCount: countsByOrganization.get(organization.id) ?? 0,
        createdAt: organization.createdAt,
        owner: organization.memberships[0]?.user ?? null,
        subscription: {
          planCode: organization.subscriptionPlan,
          status: effectiveSubscriptionStatus(organization.subscriptionStatus, organization.subscriptionEndsAt),
          startsAt: organization.subscriptionStartedAt,
          endsAt: organization.subscriptionEndsAt,
          provider: organization.billingProvider,
        },
      })),
    };
  }
  @Post("organizations")
  async createOrganization(
    @Body() body: { organizationName?: unknown; ownerName?: unknown; ownerEmail?: unknown; ownerPassword?: unknown; planCode?: unknown },
    @Req() request?: HttpRequest,
  ) {
    const organizationName = typeof body?.organizationName === "string" ? body.organizationName.trim() : "";
    const ownerName = typeof body?.ownerName === "string" ? body.ownerName.trim() : "";
    const ownerEmail = typeof body?.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : "";
    const ownerPassword = typeof body?.ownerPassword === "string" ? body.ownerPassword : "";
    const planCode = typeof body?.planCode === "string" ? body.planCode : undefined;

    if (!organizationName || organizationName.length > 160) throw new BadRequestException({ code: "validation_error", message: "Organization name is required and must be at most 160 characters" });
    if (!ownerName || ownerName.length > 120) throw new BadRequestException({ code: "validation_error", message: "Owner name is required and must be at most 120 characters" });
    if (!ownerEmail || ownerEmail.length > 254 || !/^\S+@\S+\.\S+$/.test(ownerEmail)) throw new BadRequestException({ code: "validation_error", message: "A valid owner email is required" });
    if (ownerPassword.length < 8 || ownerPassword.length > 128) throw new BadRequestException({ code: "validation_error", message: "Owner password must be 8 to 128 characters" });
    if (planCode && !PLAN_CODES.has(planCode)) throw new BadRequestException({ code: "validation_error", message: "Choose a valid subscription plan" });

    const existingUser = await this.prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
    if (existingUser) throw new ConflictException({ code: "conflict", message: "An account with this email already exists" });

    const salt = randomBytes(16);
    const derived = scryptSync(ownerPassword, salt, 64);
    const passwordHash = `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;

    const now = new Date();
    const organization = await this.prisma.user.create({
      data: {
        email: ownerEmail,
        name: ownerName,
        passwordHash,
        memberships: {
          create: {
            role: "OWNER",
            organization: {
              create: {
                name: organizationName,
                subscriptionPlan: planCode ?? null,
                subscriptionStatus: planCode ? "ACTIVE" : "PENDING",
                subscriptionStartedAt: planCode ? now : null,
                subscriptionEndsAt: planCode ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
                billingProvider: planCode ? "manual" : null,
                pipelines: {
                  create: {
                    name: "Sales pipeline",
                    isDefault: true,
                    stages: { create: ["Discovery", "Qualified", "Proposal", "Negotiation"].map((stageName, position) => ({ name: stageName, position })) },
                  },
                },
              },
            },
          },
        },
      },
      include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true } } },
    });

    const createdOrganization = organization.memberships[0]?.organization;
    if (!createdOrganization) throw new BadRequestException({ code: "server_error", message: "Could not create workspace" });

    await this.audit?.record({
      actorUserId: request?.userId ?? null,
      actorEmail: null,
      action: "organization.create",
      targetType: "organization",
      targetId: createdOrganization.id,
      metadata: { name: createdOrganization.name, ownerEmail, planCode: planCode ?? null },
    }).catch(() => undefined);

    return {
      data: {
        id: createdOrganization.id,
        name: createdOrganization.name,
        owner: { name: ownerName, email: ownerEmail },
      },
    };
  }



  @Patch("organizations/:organizationId/access")
  async updateOrganizationAccess(
    @Param("organizationId") organizationId: string,
    @Body() body: { status?: unknown; reason?: unknown },
    @Req() request?: HttpRequest,
  ) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
      throw new BadRequestException({ code: "validation_error", message: "A valid organization ID is required" });
    }
    if (body?.status !== "active" && body?.status !== "suspended") {
      throw new BadRequestException({ code: "validation_error", message: "Status must be active or suspended" });
    }

    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { status: body.status === "active" ? "ACTIVE" : "SUSPENDED" },
      select: { id: true, name: true, status: true },
    }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
        throw new NotFoundException({ code: "not_found", message: "Organization not found" });
      }
      throw error;
    });

    await this.audit?.record({
      actorUserId: request?.userId ?? null,
      actorEmail: null,
      action: body.status === "suspended" ? "organization.suspend" : "organization.restore",
      targetType: "organization",
      targetId: organization.id,
      reason: typeof body.reason === "string" ? body.reason : null,
      metadata: { status: organization.status.toLowerCase() },
    }).catch(() => undefined);

    return { data: { ...organization, status: organization.status.toLowerCase() } };
  }

  @Patch("organizations/:organizationId/subscription")
  async updateOrganizationSubscription(
    @Param("organizationId") organizationId: string,
    @Body() body: { status?: unknown; planCode?: unknown; reason?: unknown },
    @Req() request?: HttpRequest,
  ) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
      throw new BadRequestException({ code: "validation_error", message: "A valid organization ID is required" });
    }
    if (body?.status !== "active" && body?.status !== "expired" && body?.status !== "cancelled") {
      throw new BadRequestException({ code: "validation_error", message: "Subscription status must be active, expired, or cancelled" });
    }
    const planCode = typeof body.planCode === "string" ? body.planCode : undefined;
    if (body.status === "active" && (!planCode || !PLAN_CODES.has(planCode))) {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid plan before activating the subscription" });
    }
    if (body.planCode !== undefined && (!planCode || !PLAN_CODES.has(planCode))) {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid subscription plan" });
    }

    const now = new Date();
    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: body.status === "active"
        ? {
            subscriptionPlan: planCode,
            subscriptionStatus: "ACTIVE",
            subscriptionStartedAt: now,
            subscriptionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            billingProvider: "manual",
          }
        : {
            ...(planCode ? { subscriptionPlan: planCode } : {}),
            subscriptionStatus: body.status === "expired" ? "EXPIRED" : "CANCELLED",
            ...(body.status === "expired" ? { subscriptionEndsAt: now } : {}),
          },
      select: {
        id: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionStartedAt: true,
        subscriptionEndsAt: true,
        billingProvider: true,
      },
    }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
        throw new NotFoundException({ code: "not_found", message: "Organization not found" });
      }
      throw error;
    });

    await this.audit?.record({
      actorUserId: request?.userId ?? null,
      actorEmail: null,
      action: body.status === "active" ? "subscription.activate" : body.status === "cancelled" ? "subscription.cancel" : "subscription.expire",
      targetType: "organization",
      targetId: organization.id,
      reason: typeof body.reason === "string" ? body.reason : null,
      metadata: { status: organization.subscriptionStatus.toLowerCase(), planCode: organization.subscriptionPlan },
    }).catch(() => undefined);

    return {
      data: {
        id: organization.id,
        planCode: organization.subscriptionPlan,
        status: organization.subscriptionStatus.toLowerCase(),
        startsAt: organization.subscriptionStartedAt,
        endsAt: organization.subscriptionEndsAt,
        provider: organization.billingProvider,
      },
    };
  }
  @Get("audit-logs")
  async listAuditLogs(@Query("limit") limit?: string) {
    const parsed = limit === undefined ? 100 : Number(limit);
    const safeLimit = Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
    const logs = await this.audit?.list(safeLimit);
    return { data: logs ?? [] };
  }


  @Get("organizations/:organizationId/members")
  async listOrganizationMembers(@Param("organizationId") organizationId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
      throw new BadRequestException({ code: "validation_error", message: "A valid organization ID is required" });
    }

    const memberships = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      },
      select: {
        userId: true,
        role: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: [{ user: { name: "asc" } }, { userId: "asc" }],
    });

    return {
      data: memberships.map(({ userId, role, user }) => ({
        id: userId,
        name: user.name,
        email: user.email,
        role: role.toLowerCase(),
      })),
    };
  }


}
