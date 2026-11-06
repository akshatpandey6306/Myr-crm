import { randomBytes, scryptSync } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { AuditService } from "../audit/audit.service.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";
import { PlatformAdminGuard } from "../auth/platform-admin.guard.js";
import { effectiveSubscriptionStatus } from "../billing/subscription-status.js";

const MODULES = ["leads", "contacts", "companies", "deals", "activities", "team", "automation", "email", "reports", "audit-logs", "settings"];
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PlanDraft = {
  code: string;
  name: string;
  price: number;
  currency: string;
  billingInterval: "monthly" | "yearly";
  trialDays: number;
  features: string[];
  employeeLimit: number | null;
  usageLimits: Record<string, number>;
  isActive: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlanDraft(body: unknown, current?: PlanDraft): PlanDraft {
  if (!isRecord(body)) throw new BadRequestException({ code: "validation_error", message: "Plan details are required" });
  const code = current?.code ?? (typeof body.code === "string" ? body.code.trim().toLowerCase() : "");
  const name = typeof body.name === "string" ? body.name.trim() : current?.name ?? "";
  const price = body.price === undefined ? current?.price : body.price;
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : current?.currency ?? "INR";
  const billingInterval = body.billingInterval ?? current?.billingInterval ?? "monthly";
  const trialDays = body.trialDays ?? current?.trialDays ?? 0;
  const features = body.features ?? current?.features ?? [];
  const employeeLimit = body.employeeLimit === undefined ? current?.employeeLimit ?? null : body.employeeLimit;
  const usageLimits = body.usageLimits ?? current?.usageLimits ?? {};
  const isActive = body.isActive ?? current?.isActive ?? true;

  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(code)) {
    throw new BadRequestException({ code: "validation_error", message: "Plan code must be a 2–32 character lowercase slug" });
  }
  if (!name || name.length > 80) throw new BadRequestException({ code: "validation_error", message: "Plan name is required and must be at most 80 characters" });
  if (!Number.isInteger(price) || (price as number) < 0 || (price as number) > 100_000_000) {
    throw new BadRequestException({ code: "validation_error", message: "Plan price must be a non-negative whole number" });
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException({ code: "validation_error", message: "Currency must be a three-letter code" });
  if (billingInterval !== "monthly" && billingInterval !== "yearly") {
    throw new BadRequestException({ code: "validation_error", message: "Billing interval must be monthly or yearly" });
  }
  if (!Number.isInteger(trialDays) || (trialDays as number) < 0 || (trialDays as number) > 365) {
    throw new BadRequestException({ code: "validation_error", message: "Trial duration must be between 0 and 365 days" });
  }
  if (!Array.isArray(features) || features.length > 30 || features.some((feature) => typeof feature !== "string" || feature.trim().length > 160)) {
    throw new BadRequestException({ code: "validation_error", message: "Plan features must be a list of at most 30 short text values" });
  }
  if (employeeLimit !== null && (!Number.isInteger(employeeLimit) || (employeeLimit as number) < 1 || (employeeLimit as number) > 100_000)) {
    throw new BadRequestException({ code: "validation_error", message: "Employee limit must be a positive whole number or unlimited" });
  }
  if (!isRecord(usageLimits) || Object.entries(usageLimits).some(([key, value]) =>
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(key) || !Number.isInteger(value) || (value as number) < 0,
  )) {
    throw new BadRequestException({ code: "validation_error", message: "Usage limits must be an object with non-negative whole-number values" });
  }
  if (typeof isActive !== "boolean") throw new BadRequestException({ code: "validation_error", message: "Plan active status must be true or false" });

  return {
    code,
    name,
    price: price as number,
    currency,
    billingInterval,
    trialDays: trialDays as number,
    features: (features as string[]).map((feature) => feature.trim()).filter(Boolean),
    employeeLimit: employeeLimit as number | null,
    usageLimits: usageLimits as Record<string, number>,
    isActive,
  };
}

function parseAuditReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason || reason.length > 500) {
    throw new BadRequestException({
      code: "validation_error",
      message: "A reason is required and must be at most 500 characters",
    });
  }
  return reason;
}

function intervalEnd(from: Date, interval: "monthly" | "yearly") {
  const end = new Date(from);
  const day = end.getUTCDate();
  const targetMonth = end.getUTCMonth() + (interval === "yearly" ? 12 : 1);
  end.setUTCDate(1);
  end.setUTCMonth(targetMonth);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

@SkipOrganizationContext()
@UseGuards(PlatformAdminGuard)
@Controller("control-panel")
export class ControlPanelController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("access")
  access() {
    return { data: { isPlatformAdmin: true } };
  }

  @Get("plans")
  async listPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({ orderBy: [{ isActive: "desc" }, { price: "asc" }, { code: "asc" }] });
    return { data: plans };
  }

  @Get("subscription-activation-requests")
  async listSubscriptionActivationRequests() {
    const requests = await this.prisma.subscriptionActivationRequest.findMany({
      where: { status: "PENDING" },
      select: {
        id: true,
        planCode: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
        requestedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      data: requests.map((request) => ({
        id: request.id,
        planCode: request.planCode,
        requestedAt: request.createdAt.toISOString(),
        organization: request.organization,
        requestedBy: request.requestedBy,
      })),
    };
  }

  @Post("plans")
  async createPlan(@Body() body: unknown, @Req() request: HttpRequest) {
    const plan = parsePlanDraft(body);
    try {
      const created = await this.prisma.subscriptionPlan.create({ data: plan });
      await this.recordAudit(request, "plan.create", "subscription_plan", created.code, { plan });
      return { data: created };
    } catch (error) {
      if (isRecord(error) && error.code === "P2002") {
        throw new ConflictException({ code: "conflict", message: "A plan with this code already exists" });
      }
      throw error;
    }
  }

  @Patch("plans/:code")
  async updatePlan(@Param("code") code: string, @Body() body: unknown, @Req() request: HttpRequest) {
    const existing = await this.prisma.subscriptionPlan.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Subscription plan not found" });
    const current: PlanDraft = {
      code: existing.code,
      name: existing.name,
      price: existing.price,
      currency: existing.currency.trim(),
      billingInterval: existing.billingInterval as PlanDraft["billingInterval"],
      trialDays: existing.trialDays,
      features: existing.features,
      employeeLimit: existing.employeeLimit,
      usageLimits: existing.usageLimits as Record<string, number>,
      isActive: existing.isActive,
    };
    const plan = parsePlanDraft(body, current);
    const updated = await this.prisma.subscriptionPlan.update({
      where: { code },
      data: {
        name: plan.name,
        price: plan.price,
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        trialDays: plan.trialDays,
        features: plan.features,
        employeeLimit: plan.employeeLimit,
        usageLimits: plan.usageLimits,
        isActive: plan.isActive,
      },
    });
    await this.recordAudit(request, "plan.update", "subscription_plan", code, { before: current, after: plan });
    return { data: updated };
  }

  @Get("organizations")
  async listOrganizations() {
    const now = new Date();
    const [organizations, memberCounts, pendingInvitationCounts, dealTotals] = await Promise.all([
      this.prisma.organization.findMany({
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
          enabledModules: true,
          settings: { select: { currency: true } },
          memberships: {
            where: { status: "ACTIVE", role: "OWNER", user: { status: "ACTIVE" } },
            select: { user: { select: { name: true, email: true } } },
            take: 1,
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      this.prisma.membership.groupBy({
        by: ["organizationId"],
        where: { status: "ACTIVE", user: { status: "ACTIVE" } },
        _count: { _all: true },
      }),
      this.prisma.organizationInvitation.groupBy({
        by: ["organizationId"],
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        _count: { _all: true },
      }),
      this.prisma.deal.groupBy({
        by: ["organizationId", "status"],
        where: { archivedAt: null },
        _count: { _all: true },
        _sum: { value: true },
      }),
    ]);
    const countsByOrganization = new Map(memberCounts.map((entry) => [entry.organizationId, entry._count._all]));
    const pendingInvitationsByOrganization = new Map(
      pendingInvitationCounts.map((entry) => [entry.organizationId, entry._count._all]),
    );
    const dealTotalsByOrganization = new Map<string, {
      count: number;
      openPipelineValue: number;
      wonRevenue: number;
    }>();
    for (const entry of dealTotals) {
      const current = dealTotalsByOrganization.get(entry.organizationId) ?? {
        count: 0,
        openPipelineValue: 0,
        wonRevenue: 0,
      };
      current.count += entry._count._all;
      if (entry.status === "OPEN") current.openPipelineValue += Number(entry._sum.value ?? 0);
      if (entry.status === "WON") current.wonRevenue += Number(entry._sum.value ?? 0);
      dealTotalsByOrganization.set(entry.organizationId, current);
    }

    return {
      data: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        status: organization.status.toLowerCase(),
        memberCount: countsByOrganization.get(organization.id) ?? 0,
        pendingInvitationCount: pendingInvitationsByOrganization.get(organization.id) ?? 0,
        dealCount: dealTotalsByOrganization.get(organization.id)?.count ?? 0,
        openPipelineValue: dealTotalsByOrganization.get(organization.id)?.openPipelineValue ?? 0,
        wonRevenue: dealTotalsByOrganization.get(organization.id)?.wonRevenue ?? 0,
        currency: organization.settings?.currency.trim() ?? "USD",
        createdAt: organization.createdAt,
        owner: organization.memberships[0]?.user ?? null,
        enabledModules: organization.enabledModules,
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

  @Get("organizations/admin-search")
  async searchOrganizationAdmins(@Query("q") query?: string) {
    const search = typeof query === "string" ? query.trim() : "";
    if (!search) return { data: [] };
    if (search.length > 254) {
      throw new BadRequestException({ code: "validation_error", message: "Administrator search must be at most 254 characters" });
    }

    const memberships = await this.prisma.membership.findMany({
      where: {
        status: "ACTIVE",
        role: { in: ["OWNER", "ADMIN"] },
        user: {
          status: "ACTIVE",
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        },
      },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    return { data: memberships.map(({ organizationId }) => organizationId) };
  }

  @Post("organizations")
  async createOrganization(
    @Body() body: { organizationName?: unknown; ownerName?: unknown; ownerEmail?: unknown; ownerPassword?: unknown; planCode?: unknown },
    @Req() request: HttpRequest,
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
    if (body.planCode !== undefined && body.planCode !== null && typeof body.planCode !== "string") {
      throw new BadRequestException({ code: "validation_error", message: "Choose an active subscription plan" });
    }
    const plan = planCode
      ? await this.prisma.subscriptionPlan.findFirst({ where: { code: planCode, isActive: true } })
      : null;
    if (planCode && !plan) throw new BadRequestException({ code: "validation_error", message: "Choose an active subscription plan" });

    const existingUser = await this.prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
    if (existingUser) throw new ConflictException({ code: "conflict", message: "An account with this email already exists" });

    const salt = randomBytes(16);
    const derived = scryptSync(ownerPassword, salt, 64);
    const passwordHash = `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
    const now = new Date();
    const subscriptionEndsAt = plan
      ? plan.trialDays > 0
        ? new Date(now.getTime() + plan.trialDays * DAY_MS)
        : intervalEnd(now, plan.billingInterval as PlanDraft["billingInterval"])
      : null;
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
                subscriptionPlan: plan?.code ?? null,
                subscriptionStatus: plan ? (plan.trialDays > 0 ? "TRIAL" : "ACTIVE") : "PENDING",
                subscriptionStartedAt: plan ? now : null,
                subscriptionEndsAt,
                billingProvider: plan ? "manual" : null,
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
    await this.recordAudit(request, "organization.create", "organization", createdOrganization.id, {
      name: createdOrganization.name,
      ownerEmail,
      planCode: plan?.code ?? null,
    });

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
    @Req() request: HttpRequest,
  ) {
    this.validateOrganizationId(organizationId);
    if (body?.status !== "active" && body?.status !== "suspended") {
      throw new BadRequestException({ code: "validation_error", message: "Status must be active or suspended" });
    }
    const reason = parseAuditReason(body.reason);
    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { status: body.status === "active" ? "ACTIVE" : "SUSPENDED" },
      select: { id: true, name: true, status: true },
    }).catch((error: unknown) => this.throwIfNotFound(error, "Organization not found"));
    await this.recordAudit(request, body.status === "suspended" ? "organization.suspend" : "organization.restore", "organization", organization.id, {
      status: organization.status.toLowerCase(),
    }, reason);
    return { data: { ...organization, status: organization.status.toLowerCase() } };
  }

  @Patch("organizations/:organizationId/subscription")
  async updateOrganizationSubscription(
    @Param("organizationId") organizationId: string,
    @Body() body: { status?: unknown; planCode?: unknown; endsAt?: unknown; extend?: unknown; reason?: unknown },
    @Req() request: HttpRequest,
  ) {
    this.validateOrganizationId(organizationId);
    if (body?.status !== "active" && body?.status !== "expired" && body?.status !== "cancelled") {
      throw new BadRequestException({ code: "validation_error", message: "Subscription status must be active, expired, or cancelled" });
    }
    const reason = parseAuditReason(body.reason);
    const planCode = typeof body.planCode === "string" ? body.planCode : undefined;
    const plan = body.status === "active" && planCode
      ? await this.prisma.subscriptionPlan.findFirst({ where: { code: planCode, isActive: true } })
      : null;
    if (body.status === "active" && !plan) {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid active plan before activating the subscription" });
    }
    if (body.planCode !== undefined && !planCode) {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid subscription plan" });
    }
    if (body.extend !== undefined && typeof body.extend !== "boolean") {
      throw new BadRequestException({ code: "validation_error", message: "Extend must be true or false" });
    }
    const current = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionPlan: true, subscriptionStartedAt: true, subscriptionEndsAt: true },
    });
    if (!current) throw new NotFoundException({ code: "not_found", message: "Organization not found" });

    const now = new Date();
    let endsAt: Date | undefined;
    let startsAt = now;
    if (body.status === "active") {
      const interval = plan!.billingInterval as PlanDraft["billingInterval"];
      if (body.endsAt !== undefined) {
        const parsed = typeof body.endsAt === "string" ? new Date(body.endsAt) : new Date(Number.NaN);
        if (!Number.isFinite(parsed.getTime()) || parsed <= now) {
          throw new BadRequestException({ code: "validation_error", message: "Access end date must be a valid future date" });
        }
        endsAt = parsed;
        if (body.extend === true && current.subscriptionPlan === plan!.code && current.subscriptionStartedAt) {
          startsAt = current.subscriptionStartedAt;
        }
      } else if (body.extend === true && current.subscriptionPlan === plan!.code) {
        const extensionStart = current.subscriptionEndsAt && current.subscriptionEndsAt > now ? current.subscriptionEndsAt : now;
        endsAt = intervalEnd(extensionStart, interval);
        startsAt = current.subscriptionStartedAt ?? now;
      } else {
        endsAt = intervalEnd(now, interval);
      }
    }

    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: body.status === "active"
        ? {
            subscriptionPlan: plan!.code,
            subscriptionStatus: "ACTIVE",
            subscriptionStartedAt: startsAt,
            subscriptionEndsAt: endsAt,
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
    }).catch((error: unknown) => this.throwIfNotFound(error, "Organization not found"));
    await this.prisma.subscriptionActivationRequest.updateMany({
      where: { organizationId, status: "PENDING" },
      data: { status: body.status === "active" ? "ACTIVATED" : "DECLINED" },
    });
    await this.recordAudit(request, body.status === "active" ? "subscription.activate" : body.status === "cancelled" ? "subscription.cancel" : "subscription.expire", "organization", organization.id, {
      before: { planCode: current.subscriptionPlan, endsAt: current.subscriptionEndsAt },
      after: { status: organization.subscriptionStatus.toLowerCase(), planCode: organization.subscriptionPlan, endsAt: organization.subscriptionEndsAt },
    }, reason);

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

  @Patch("organizations/:organizationId/modules")
  async updateOrganizationModules(
    @Param("organizationId") organizationId: string,
    @Body() body: { modules?: unknown; reason?: unknown },
    @Req() request: HttpRequest,
  ) {
    this.validateOrganizationId(organizationId);
    if (!Array.isArray(body?.modules) || body.modules.some((module) => typeof module !== "string" || !MODULES.includes(module))) {
      throw new BadRequestException({ code: "validation_error", message: "Choose valid CRM modules" });
    }
    const reason = parseAuditReason(body.reason);
    const modules = [...new Set(body.modules as string[])];
    const current = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { enabledModules: true },
    });
    if (!current) throw new NotFoundException({ code: "not_found", message: "Organization not found" });
    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { enabledModules: modules },
      select: { id: true, enabledModules: true },
    });
    await this.recordAudit(request, "organization.modules.update", "organization", updated.id, {
      before: current.enabledModules,
      after: updated.enabledModules,
    }, reason);
    return { data: updated };
  }

  @Get("audit-logs")
  async listAuditLogs(@Query("limit") limit?: string) {
    const parsed = limit === undefined ? 100 : Number(limit);
    const safeLimit = Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
    const logs = await this.audit.list(safeLimit);
    const actorIds = [...new Set(logs.flatMap((log) => log.actorUserId ? [log.actorUserId] : []))];
    const users = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
      : [];
    const actors = new Map(users.map((user) => [user.id, user]));
    return {
      data: logs.map((log) => ({
        ...log,
        actorName: log.actorUserId ? actors.get(log.actorUserId)?.name ?? null : null,
        actorEmail: log.actorEmail ?? (log.actorUserId ? actors.get(log.actorUserId)?.email ?? null : null),
      })),
    };
  }

  @Get("organizations/:organizationId/members")
  async listOrganizationMembers(@Param("organizationId") organizationId: string) {
    this.validateOrganizationId(organizationId);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
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

  @Get("organizations/:organizationId/deals")
  async listOrganizationDeals(
    @Param("organizationId") organizationId: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
  ) {
    this.validateOrganizationId(organizationId);
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException({ code: "not_found", message: "Organization not found" });

    const where = { organizationId, archivedAt: null };
    const [deals, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          value: true,
          status: true,
          closeDate: true,
          company: { select: { name: true } },
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
          owner: { select: { user: { select: { name: true, email: true } } } },
        },
      }),
      this.prisma.deal.count({ where }),
    ]);
    return {
      data: deals.map((deal) => ({
        id: deal.id,
        name: deal.name,
        value: Number(deal.value),
        status: deal.status.toLowerCase(),
        closeDate: deal.closeDate?.toISOString() ?? null,
        company: deal.company?.name ?? null,
        pipeline: deal.pipeline.name,
        stage: deal.stage.name,
        owner: deal.owner.user,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  private pagination(pageValue?: string, pageSizeValue?: string) {
    const page = pageValue === undefined ? 1 : Number(pageValue);
    const pageSize = pageSizeValue === undefined ? 25 : Number(pageSizeValue);
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException({ code: "validation_error", message: "page must be a positive whole number" });
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException({ code: "validation_error", message: "pageSize must be between 1 and 100" });
    }
    return { page, pageSize };
  }

  private validateOrganizationId(organizationId: string) {
    if (!UUID.test(organizationId)) {
      throw new BadRequestException({ code: "validation_error", message: "A valid organization ID is required" });
    }
  }

  private throwIfNotFound(error: unknown, message: string): never {
    if (isRecord(error) && error.code === "P2025") {
      throw new NotFoundException({ code: "not_found", message });
    }
    throw error;
  }

  private async recordAudit(
    request: HttpRequest,
    action: string,
    targetType: string,
    targetId: string,
    metadata: unknown,
    reason?: string,
  ) {
    const actorUserId = request.userId ?? null;
    const actor = actorUserId
      ? await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true } })
      : null;
    await this.audit.record({
      actorUserId,
      actorEmail: actor?.email ?? null,
      action,
      targetType,
      targetId,
      reason,
      metadata,
    });
  }
}
