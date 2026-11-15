import { createHash, randomBytes, scryptSync } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Optional,
  PayloadTooLargeException,
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
import { DemoDataService } from "../demo-data/demo-data.controller.js";
import { TenantProvisioningService } from "../provisioning/tenant-provisioning.service.js";
import { AuthEmailService } from "../auth/email.service.js";

const MODULES = ["leads", "contacts", "companies", "deals", "activities", "vendors", "billing-invoicing", "team", "automation", "email", "reports", "audit-logs", "settings"];
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
  maxDevicesPerUser: number;
  deviceRestrictionEnabled: boolean;
  usageLimits: Record<string, number>;
  modules: string[];
  isActive: boolean;
};

const PLAN_MODULES = ["leads", "contacts", "companies", "deals", "activities", "vendors", "billing-invoicing", "team", "automation", "email", "reports", "audit-logs", "settings"];
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeAuditDetails(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return value.slice(0, 2_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeAuditDetails(item, depth + 1));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(password|secret|token|credential|authorization|cookie|session|otp|hash)/i.test(key))
      .slice(0, 100)
      .map(([key, item]) => [key, safeAuditDetails(item, depth + 1)]),
  );
}

function safeAuditReason(value: string | null) {
  return value?.replace(/\b(password|secret|token|credential|authorization|cookie|session|otp|hash)\b\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 500) ?? null;
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
  const maxDevicesPerUser = body.maxDevicesPerUser === undefined ? current?.maxDevicesPerUser ?? 1 : body.maxDevicesPerUser;
  const deviceRestrictionEnabled = body.deviceRestrictionEnabled === undefined ? current?.deviceRestrictionEnabled ?? true : body.deviceRestrictionEnabled;
  const usageLimits = body.usageLimits ?? current?.usageLimits ?? {};
  const modules = body.modules ?? current?.modules ?? PLAN_MODULES;
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
  if (!Number.isInteger(maxDevicesPerUser) || (maxDevicesPerUser as number) < 1 || (maxDevicesPerUser as number) > 100) {
    throw new BadRequestException({ code: "validation_error", message: "Device limit must be between 1 and 100" });
  }
  if (typeof deviceRestrictionEnabled !== "boolean") throw new BadRequestException({ code: "validation_error", message: "Device restriction setting must be true or false" });
  if (!isRecord(usageLimits) || Object.entries(usageLimits).some(([key, value]) =>
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(key) || !Number.isInteger(value) || (value as number) < 0,
  )) {
    throw new BadRequestException({ code: "validation_error", message: "Usage limits must be an object with non-negative whole-number values" });
  }
  if (!Array.isArray(modules) || modules.some((module) => typeof module !== "string" || !PLAN_MODULES.includes(module))) {
    throw new BadRequestException({ code: "validation_error", message: "Choose valid CRM modules for this plan" });
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
    maxDevicesPerUser: maxDevicesPerUser as number,
    deviceRestrictionEnabled,
    usageLimits: usageLimits as Record<string, number>,
    modules: [...new Set(modules as string[])],
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
  private readonly logger = new Logger(ControlPanelController.name);
  private readonly tenantProvisioning: TenantProvisioningService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DemoDataService) private readonly demoData: DemoDataService,
    @Optional() @Inject(AuthEmailService) private readonly authEmail?: AuthEmailService,
    @Optional() @Inject(TenantProvisioningService) tenantProvisioning?: TenantProvisioningService,
  ) {
    this.tenantProvisioning = tenantProvisioning ?? new TenantProvisioningService();
  }

  @Get("access")
  access() {
    return { data: { isPlatformAdmin: true } };
  }

  @Get("security-settings")
  async getSecuritySettings() {
    const [settings, sessions] = await Promise.all([
      this.prisma.globalSecuritySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
      this.prisma.session.findMany({
        where: { revokedAt: null, expiresAt: { gt: new Date() }, user: { status: "ACTIVE" } },
        select: {
          id: true, userId: true, deviceHash: true, deviceLabel: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true,
          user: { select: { email: true, name: true, memberships: { where: { status: "ACTIVE" }, select: { organization: { select: { id: true, name: true, subscriptionPlan: true } } }, take: 1 } } },
        },
        orderBy: { lastSeenAt: "desc" }, take: 500,
      }),
    ]);
    const planCodes = [...new Set(sessions.map((session) => session.user.memberships[0]?.organization.subscriptionPlan).filter((value): value is string => Boolean(value)))];
    const plans = await this.prisma.subscriptionPlan.findMany({ where: { code: { in: planCodes } }, select: { code: true, maxDevicesPerUser: true, deviceRestrictionEnabled: true } });
    const planMap = new Map(plans.map((plan) => [plan.code, plan]));
    const groups = new Map<string, { userId: string; user: { email: string; name: string }; organization: { id: string; name: string } | null; devices: Set<string>; sessionCount: number }>();
    for (const session of sessions) {
      const membership = session.user.memberships[0];
      const organization = membership?.organization ?? null;
      const code = organization?.subscriptionPlan;
      const plan = code ? planMap.get(code) : null;
      const limit = plan?.maxDevicesPerUser ?? 0;
      const group = groups.get(session.userId) ?? { userId: session.userId, user: session.user, organization, devices: new Set<string>(), sessionCount: 0 };
      // Pre-device-tracking sessions have no device hash. Count that legacy
      // set as one unknown device instead of treating every session as a device.
      group.devices.add(session.deviceHash ?? "legacy-unknown-device");
      group.sessionCount += 1;
      groups.set(session.userId, group);
    }
    return { data: {
      settings,
      usage: [...groups.values()].map((group) => {
        const code = group.organization?.id ? sessions.find((item) => item.userId === group.userId)?.user.memberships[0]?.organization.subscriptionPlan : null;
        const plan = code ? planMap.get(code) : null;
        const limit = plan?.maxDevicesPerUser ?? null;
        const enforced = settings.deviceRestrictionsEnabled && plan?.deviceRestrictionEnabled === true && limit !== null;
        return { userId: group.userId, user: group.user, organization: group.organization, activeDevices: group.devices.size, activeSessions: group.sessionCount, deviceLimit: limit, overLimit: Boolean(enforced && group.devices.size > limit!) };
      }),
      sessions: sessions.map(({ deviceHash: _deviceHash, ...session }) => ({
        id: session.id, userId: session.userId, user: session.user,
        organization: session.user.memberships[0]?.organization ?? null,
        deviceLabel: session.deviceLabel ?? "Unknown device", userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(), lastSeenAt: session.lastSeenAt.toISOString(), expiresAt: session.expiresAt.toISOString(),
      })),
    } };
  }

  @Patch("security-settings")
  async updateSecuritySettings(@Body() body: unknown, @Req() request: HttpRequest) {
    if (!isRecord(body)) throw new BadRequestException({ code: "validation_error", message: "Security settings are required" });
    const before = await this.prisma.globalSecuritySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const next = {
      failedLoginLockoutEnabled: body.failedLoginLockoutEnabled ?? before.failedLoginLockoutEnabled,
      maxFailedLoginAttempts: body.maxFailedLoginAttempts ?? before.maxFailedLoginAttempts,
      lockoutDurationMinutes: body.lockoutDurationMinutes ?? before.lockoutDurationMinutes,
      sessionLifetimeMinutes: body.sessionLifetimeMinutes ?? before.sessionLifetimeMinutes,
      deviceRestrictionsEnabled: body.deviceRestrictionsEnabled ?? before.deviceRestrictionsEnabled,
    };
    if (typeof next.failedLoginLockoutEnabled !== "boolean" || typeof next.deviceRestrictionsEnabled !== "boolean" ||
      !Number.isInteger(next.maxFailedLoginAttempts) || Number(next.maxFailedLoginAttempts) < 1 || Number(next.maxFailedLoginAttempts) > 10 ||
      !Number.isInteger(next.lockoutDurationMinutes) || Number(next.lockoutDurationMinutes) < 1 || Number(next.lockoutDurationMinutes) > 1440 ||
      !Number.isInteger(next.sessionLifetimeMinutes) || Number(next.sessionLifetimeMinutes) < 5 || Number(next.sessionLifetimeMinutes) > 43200) {
      throw new BadRequestException({ code: "validation_error", message: "Set attempts to 1–10, lockout to 1–1440 minutes, and session lifetime to 5–43200 minutes" });
    }
    const updated = await this.prisma.globalSecuritySettings.update({ where: { id: 1 }, data: { ...next, updatedByUserId: request.userId ?? null } });
    await this.recordAudit(request, "security.settings.update", "global_security_settings", "1", { before, after: updated });
    return { data: updated };
  }

  @Post("sessions/:sessionId/revoke")
  async revokeSession(@Param("sessionId") sessionId: string, @Req() request: HttpRequest) {
    if (!UUID.test(sessionId)) throw new BadRequestException({ code: "validation_error", message: "A valid session ID is required" });
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, userId: true, revokedAt: true, user: { select: { email: true } } } });
    if (!session || session.revokedAt) throw new NotFoundException({ code: "not_found", message: "Active session not found" });
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await this.recordAudit(request, "security.session.revoke", "session", session.id, { userId: session.userId, email: session.user.email });
    return { data: { sessionId, revoked: true } };
  }

  @Get("plans")
  async listPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({ orderBy: [{ isActive: "desc" }, { price: "asc" }, { code: "asc" }] });
    return { data: plans };
  }

  @Get("plans/:code")
  async getPlan(@Param("code") code: string, @Query("organizationId") organizationId?: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { code } });
    if (!plan) throw new NotFoundException({ code: "not_found", message: "Subscription plan not found" });
    if (!organizationId) return { data: plan };
    this.validateOrganizationId(organizationId);
    const override = await this.prisma.organizationSubscriptionPlanOverride?.findUnique?.({
      where: { organizationId_planCode: { organizationId, planCode: code } },
    }) ?? null;
    return { data: override ?? plan };
  }

  @Get("provisioning-requests")
  async listProvisioningRequests(@Query("status") status?: string) {
    const allowed = ["RUNNING", "SUCCEEDED", "FAILED"];
    const rows = await this.prisma.provisioningRequest.findMany({
      where: status && allowed.includes(status) ? { status: status as "RUNNING" | "SUCCEEDED" | "FAILED" } : undefined,
      orderBy: { createdAt: "desc" }, take: 100,
    });
    return { data: rows.map(({ id, requestId, orderId, product, status: state, organizationId, ownerUserId, planCode, failureCode, activationEmailSent, createdAt, updatedAt }) => ({
      id, requestId, orderId, product, status: state, organizationId, ownerUserId, planCode, failureCode,
      activationEmailSent, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(),
    })) };
  }

  @Post("provisioning-requests/:requestId/retry-activation-email")
  async retryProvisioningActivationEmail(@Param("requestId") requestId: string, @Req() request: HttpRequest) {
    if (!requestId || requestId.length > 128) throw new BadRequestException({ code: "validation_error", message: "A valid provisioning request ID is required" });
    if (!this.authEmail) throw new ConflictException({ code: "email_delivery_unavailable", message: "Activation email delivery is unavailable" });
    const provisioning = await this.prisma.provisioningRequest.findUnique({ where: { requestId } });
    if (!provisioning || !provisioning.ownerUserId || provisioning.status !== "SUCCEEDED") throw new NotFoundException({ code: "not_found", message: "Completed provisioning request not found" });
    if (provisioning.activationEmailSent) return { data: { requestId, activationEmailSent: true } };
    const user = await this.prisma.user.findUnique({ where: { id: provisioning.ownerUserId }, select: { email: true, status: true } });
    if (!user || user.status !== "PENDING") throw new ConflictException({ code: "account_already_active", message: "The owner account is already active or unavailable" });
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.emailToken.updateMany({ where: { userId: provisioning.ownerUserId!, purpose: "ACCOUNT_ACTIVATION", consumedAt: null }, data: { consumedAt: now } });
      await tx.emailToken.create({ data: { userId: provisioning.ownerUserId!, tokenHash: createHash("sha256").update(token).digest("hex"), purpose: "ACCOUNT_ACTIVATION", expiresAt: new Date(now.getTime() + 60 * 60 * 1000) } });
    });
    let sent = false;
    try {
      await this.authEmail.sendAccountActivation(token, user.email);
      sent = true;
    } catch {
      sent = false;
    }
    await this.prisma.provisioningRequest.update({ where: { id: provisioning.id }, data: { activationEmailSent: sent } });
    await this.recordAudit(request, "provisioning.activation_email.retry", "provisioning_request", provisioning.id, { requestId, sent });
    return { data: { requestId, activationEmailSent: sent } };
  }

  @Get("subscription-activation-requests")
  async listSubscriptionActivationRequests() {
    const requests = await this.prisma.subscriptionActivationRequest.findMany({
      where: { status: "PENDING" },
      select: {
        id: true,
        planCode: true,
        requestType: true,
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
        requestType: request.requestType.toLowerCase(),
        requestedAt: request.createdAt.toISOString(),
        organization: request.organization,
        requestedBy: request.requestedBy,
      })),
    };
  }

  @Post("subscription-activation-requests/:requestId/review")
  async reviewSubscriptionRequest(
    @Param("requestId") requestId: string,
    @Body() body: { decision?: unknown; reason?: unknown },
    @Req() request: HttpRequest,
  ) {
    if (!UUID.test(requestId)) throw new BadRequestException({ code: "validation_error", message: "A valid subscription request ID is required" });
    if (body?.decision !== "approve" && body?.decision !== "decline") {
      throw new BadRequestException({ code: "validation_error", message: "Choose approve or decline" });
    }
    const subscriptionRequest = await this.prisma.subscriptionActivationRequest.findFirst({
      where: { id: requestId, status: "PENDING" },
      select: {
        id: true,
        organizationId: true,
        requestedById: true,
        planCode: true,
        requestType: true,
      },
    });
    if (!subscriptionRequest) throw new NotFoundException({ code: "not_found", message: "Pending subscription request not found" });

    const approved = body.decision === "approve";
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    await this.prisma.$transaction(async (transaction) => {
      const currentOrganization = await transaction.organization.findUnique({
        where: { id: subscriptionRequest.organizationId },
        select: { subscriptionStatus: true, subscriptionEndsAt: true },
      });
      if (!currentOrganization) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });

      if (approved) {
        const basePlan = await transaction.subscriptionPlan.findFirst({
          where: { code: subscriptionRequest.planCode, isActive: true },
          select: { code: true, billingInterval: true, modules: true },
        });
        const override = await transaction.organizationSubscriptionPlanOverride?.findUnique?.({
          where: { organizationId_planCode: { organizationId: subscriptionRequest.organizationId, planCode: subscriptionRequest.planCode } },
          select: { planCode: true, billingInterval: true, modules: true, isActive: true },
        }) ?? null;
        const plan = !basePlan ? null : override?.isActive ? { ...override, code: override.planCode } : override ? null : basePlan;
        if (!plan) throw new ConflictException({ code: "plan_unavailable", message: "The requested plan is no longer available" });

        const now = new Date();
        if (subscriptionRequest.requestType === "TRIAL") {
          if (currentOrganization.subscriptionStatus !== "PENDING") {
            throw new ConflictException({ code: "subscription_exists", message: "This workspace is no longer awaiting trial approval" });
          }
          await transaction.organization.update({
            where: { id: subscriptionRequest.organizationId },
            data: {
              subscriptionPlan: plan.code,
              subscriptionStatus: "TRIAL",
              subscriptionStartedAt: now,
              subscriptionEndsAt: new Date(now.getTime() + 2 * DAY_MS),
              billingProvider: "trial",
              enabledModules: plan.modules,
            },
          });
        } else {
          const currentStatus = effectiveSubscriptionStatus(currentOrganization.subscriptionStatus, currentOrganization.subscriptionEndsAt);
          const currentEnd = currentOrganization.subscriptionEndsAt;
          const renewalWindowOpen = ["active", "trial"].includes(currentStatus) &&
            currentEnd !== null && currentEnd > now &&
            currentEnd.getTime() <= now.getTime() + 10 * DAY_MS;
          if (!["expired", "cancelled"].includes(currentStatus) && !renewalWindowOpen) {
            throw new ConflictException({ code: "subscription_not_ended", message: "Workspace subscription is not awaiting activation" });
          }
          const renewalStart = renewalWindowOpen && currentEnd ? currentEnd : now;
          await transaction.organization.update({
            where: { id: subscriptionRequest.organizationId },
            data: {
              subscriptionPlan: plan.code,
              subscriptionStatus: "ACTIVE",
              ...(!renewalWindowOpen ? { subscriptionStartedAt: now } : {}),
              subscriptionEndsAt: intervalEnd(renewalStart, plan.billingInterval as PlanDraft["billingInterval"]),
              billingProvider: "manual",
              enabledModules: plan.modules,
            },
          });
        }
      }

      const updated = await transaction.subscriptionActivationRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: approved ? "ACTIVATED" : "DECLINED" },
      });
      if (updated.count !== 1) throw new ConflictException({ code: "conflict", message: "This subscription request has already been reviewed" });
    });

    await this.recordAudit(request, `subscription_request.${subscriptionRequest.requestType.toLowerCase()}.${body.decision}`, "organization", subscriptionRequest.organizationId, {
      requestId,
      planCode: subscriptionRequest.planCode,
      reason,
      paymentProvider: "not_integrated",
    });
    if (approved && subscriptionRequest.requestType === "TRIAL") {
      try {
        await this.demoData.load(subscriptionRequest.organizationId, subscriptionRequest.requestedById);
      } catch (error) {
        this.logger.error("The trial was approved, but sample workspace data could not be loaded", error instanceof Error ? error.stack : undefined);
      }
    }
    return { data: { id: requestId, decision: body.decision, requestType: subscriptionRequest.requestType.toLowerCase() } };
  }

  @Get("workspace-signups")
  async listWorkspaceSignupRequests() {
    const requests = await this.prisma.membership.findMany({
      where: {
        role: "OWNER",
        status: "PENDING",
        user: {
          status: "PENDING",
          emailTokens: { none: { purpose: "EMAIL_VERIFICATION", consumedAt: null } },
        },
      },
      select: {
        userId: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      data: requests.map((request) => ({
        userId: request.userId,
        requestedAt: request.createdAt.toISOString(),
        user: request.user,
        organization: request.organization,
      })),
    };
  }

  @Post("workspace-signups/:userId/review")
  async reviewWorkspaceSignup(
    @Param("userId") userId: string,
    @Body() body: { decision?: unknown },
    @Req() request: HttpRequest,
  ) {
    if (!UUID.test(userId)) throw new BadRequestException({ code: "validation_error", message: "A valid user ID is required" });
    if (body?.decision !== "approve" && body?.decision !== "decline") {
      throw new BadRequestException({ code: "validation_error", message: "Choose approve or decline" });
    }

    const signup = await this.prisma.membership.findFirst({
      where: {
        userId,
        role: "OWNER",
        status: "PENDING",
        user: {
          status: "PENDING",
          emailTokens: { none: { purpose: "EMAIL_VERIFICATION", consumedAt: null } },
        },
      },
      select: { organizationId: true, userId: true },
    });
    if (!signup) throw new NotFoundException({ code: "not_found", message: "Pending workspace signup not found" });

    const approved = body.decision === "approve";
    await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.updateMany({
        where: { id: signup.userId, status: "PENDING" },
        data: { status: approved ? "ACTIVE" : "DISABLED" },
      });
      const membership = await transaction.membership.updateMany({
        where: { organizationId: signup.organizationId, userId: signup.userId, role: "OWNER", status: "PENDING" },
        data: { status: approved ? "ACTIVE" : "REMOVED" },
      });
      if (user.count !== 1 || membership.count !== 1) {
        throw new ConflictException({ code: "conflict", message: "This workspace signup has already been reviewed" });
      }
      if (!approved) {
        await transaction.organization.updateMany({
          where: { id: signup.organizationId },
          data: { status: "SUSPENDED" },
        });
        await transaction.session.updateMany({
          where: { userId: signup.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    await this.recordAudit(request, `workspace_signup.${body.decision}`, "organization", signup.organizationId, {
      userId: signup.userId,
    });
    return { data: { userId: signup.userId, decision: body.decision } };
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
      maxDevicesPerUser: existing.maxDevicesPerUser,
      deviceRestrictionEnabled: existing.deviceRestrictionEnabled,
      usageLimits: existing.usageLimits as Record<string, number>,
      modules: existing.modules,
      isActive: existing.isActive,
    };
    const plan = parsePlanDraft(body, current);
    if (isRecord(body) && body.applyTo !== undefined && body.applyTo !== "all" && body.applyTo !== "organization") {
      throw new BadRequestException({ code: "validation_error", message: "Plan changes must target all workspaces or one workspace" });
    }
    const applyTo = isRecord(body) && body.applyTo === "organization" ? "organization" : "all";
    const organizationId = isRecord(body) && typeof body.organizationId === "string" ? body.organizationId : "";
    if (applyTo === "organization") {
      this.validateOrganizationId(organizationId);
      const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
      if (!organization) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });
      const { updated, updatedActiveWorkspaces } = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.organizationSubscriptionPlanOverride.upsert({
          where: { organizationId_planCode: { organizationId, planCode: code } },
          create: {
            organizationId,
            planCode: code,
            name: plan.name,
            price: plan.price,
            currency: plan.currency,
            billingInterval: plan.billingInterval,
            trialDays: plan.trialDays,
            features: plan.features,
            employeeLimit: plan.employeeLimit,
            maxDevicesPerUser: plan.maxDevicesPerUser,
            deviceRestrictionEnabled: plan.deviceRestrictionEnabled,
            usageLimits: plan.usageLimits,
            modules: plan.modules,
            isActive: plan.isActive,
          },
          update: {
            name: plan.name,
            price: plan.price,
            currency: plan.currency,
            billingInterval: plan.billingInterval,
            trialDays: plan.trialDays,
            features: plan.features,
            employeeLimit: plan.employeeLimit,
            maxDevicesPerUser: plan.maxDevicesPerUser,
            deviceRestrictionEnabled: plan.deviceRestrictionEnabled,
            usageLimits: plan.usageLimits,
            modules: plan.modules,
            isActive: plan.isActive,
          },
        });
        const organizations = await transaction.organization.updateMany({
          where: { id: organizationId, subscriptionPlan: code, subscriptionStatus: "ACTIVE", subscriptionEndsAt: { gt: new Date() } },
          data: { enabledModules: plan.modules },
        });
        return { updated, updatedActiveWorkspaces: organizations.count };
      });
      await this.recordAudit(request, "plan.update.workspace", "organization", organizationId, {
        planCode: code,
        workspaceName: organization.name,
        before: current,
        after: plan,
        updatedActiveWorkspaces,
      });
      return { data: updated, appliedTo: { organizationId, organizationName: organization.name } };
    }
    const { updated, updatedWorkspaceOverrides, updatedActiveWorkspaces } = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.subscriptionPlan.update({
        where: { code },
        data: {
          name: plan.name,
          price: plan.price,
          currency: plan.currency,
          billingInterval: plan.billingInterval,
          trialDays: plan.trialDays,
          features: plan.features,
          employeeLimit: plan.employeeLimit,
          maxDevicesPerUser: plan.maxDevicesPerUser,
          deviceRestrictionEnabled: plan.deviceRestrictionEnabled,
          usageLimits: plan.usageLimits,
          modules: plan.modules,
          isActive: plan.isActive,
        },
      });
      const overrides = await transaction.organizationSubscriptionPlanOverride.updateMany({
        where: { planCode: code },
        data: {
          name: plan.name,
          price: plan.price,
          currency: plan.currency,
          billingInterval: plan.billingInterval,
          trialDays: plan.trialDays,
          features: plan.features,
          employeeLimit: plan.employeeLimit,
          maxDevicesPerUser: plan.maxDevicesPerUser,
          deviceRestrictionEnabled: plan.deviceRestrictionEnabled,
          usageLimits: plan.usageLimits,
          modules: plan.modules,
          isActive: plan.isActive,
        },
      });
      const organizations = await transaction.organization.updateMany({
        where: { subscriptionPlan: code, subscriptionStatus: "ACTIVE", subscriptionEndsAt: { gt: new Date() } },
        data: { enabledModules: plan.modules },
      });
      return { updated, updatedWorkspaceOverrides: overrides.count, updatedActiveWorkspaces: organizations.count };
    });
    await this.recordAudit(request, "plan.update", "subscription_plan", code, {
      before: current,
      after: plan,
      appliedTo: "all_workspaces",
      updatedWorkspaceOverrides,
      updatedActiveWorkspaces,
    });
    return { data: updated };
  }

  @Get("organizations")
  async listOrganizations() {
    const [organizations, memberCounts, pendingJoinRequestCounts, dealTotals] = await Promise.all([
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
          subscriptionPayments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { transactionId: true, paymentType: true, amount: true, currency: true, status: true, payuId: true, verifiedAt: true, createdAt: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      this.prisma.membership.groupBy({
        by: ["organizationId"],
        where: { status: "ACTIVE", user: { status: "ACTIVE" } },
        _count: { _all: true },
      }),
      this.prisma.membership.groupBy({
        by: ["organizationId"],
        where: { status: "PENDING", user: { status: "ACTIVE" } },
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
    const pendingJoinRequestsByOrganization = new Map(
      pendingJoinRequestCounts.map((entry) => [entry.organizationId, entry._count._all]),
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
        pendingMemberRequestCount: pendingJoinRequestsByOrganization.get(organization.id) ?? 0,
        dealCount: dealTotalsByOrganization.get(organization.id)?.count ?? 0,
        openPipelineValue: dealTotalsByOrganization.get(organization.id)?.openPipelineValue ?? 0,
        wonRevenue: dealTotalsByOrganization.get(organization.id)?.wonRevenue ?? 0,
        currency: organization.settings?.currency.trim() ?? "USD",
        createdAt: organization.createdAt,
        owner: organization.memberships[0]?.user ?? null,
        enabledModules: organization.enabledModules,
        lastPayment: organization.subscriptionPayments?.[0] ? {
          transactionId: organization.subscriptionPayments[0].transactionId,
          paymentType: organization.subscriptionPayments[0].paymentType.toLowerCase(),
          amount: organization.subscriptionPayments[0].amount.toString(),
          currency: organization.subscriptionPayments[0].currency.trim(),
          status: organization.subscriptionPayments[0].status.toLowerCase(),
          payuId: organization.subscriptionPayments[0].payuId,
          paidAt: organization.subscriptionPayments[0].verifiedAt?.toISOString() ?? null,
          createdAt: organization.subscriptionPayments[0].createdAt.toISOString(),
        } : null,
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
    const { owner, createdOrganization } = await this.prisma.$transaction(async (tx) => {
      const owner = await tx.user.create({ data: { email: ownerEmail, name: ownerName, passwordHash } });
      const createdOrganization = await this.tenantProvisioning.createWorkspace(tx, {
        ownerUserId: owner.id,
        name: organizationName,
        membershipStatus: "ACTIVE",
        subscriptionPlan: plan?.code ?? null,
        subscriptionStatus: plan ? (plan.trialDays > 0 ? "TRIAL" : "ACTIVE") : "PENDING",
        subscriptionStartedAt: plan ? now : null,
        subscriptionEndsAt,
        billingProvider: plan ? "manual" : null,
        ...(plan ? { enabledModules: plan.modules } : {}),
      });
      return { owner, createdOrganization };
    });
    if ((plan?.trialDays ?? 0) > 0) {
      try {
        await this.demoData.load(createdOrganization.id, owner.id);
      } catch (error) {
        this.logger.error("The trial workspace was created, but sample data could not be loaded", error instanceof Error ? error.stack : undefined);
      }
    }
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
    @Body() body: { status?: unknown; planCode?: unknown; endsAt?: unknown; extend?: unknown; trialDays?: unknown; reason?: unknown },
    @Req() request: HttpRequest,
  ) {
    this.validateOrganizationId(organizationId);
    if (body?.status !== "active" && body?.status !== "trial" && body?.status !== "expired" && body?.status !== "cancelled") {
      throw new BadRequestException({ code: "validation_error", message: "Subscription status must be active, trial, expired, or cancelled" });
    }
    const reason = parseAuditReason(body.reason);
    const planCode = typeof body.planCode === "string" ? body.planCode : undefined;
    const basePlan = (body.status === "active" || body.status === "trial") && planCode
      ? await this.prisma.subscriptionPlan.findFirst({ where: { code: planCode, isActive: true } })
      : null;
    if ((body.status === "active" || body.status === "trial") && planCode && !basePlan) {
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
    const override = (body.status === "active" || body.status === "trial") && planCode
      ? await this.prisma.organizationSubscriptionPlanOverride?.findUnique?.({
          where: { organizationId_planCode: { organizationId, planCode } },
        }) ?? null
      : null;
    const plan = override ? { ...override, code: override.planCode } : basePlan;
    if ((body.status === "active" || body.status === "trial") && (!basePlan || !plan || (override && !override.isActive))) {
      throw new BadRequestException({ code: "validation_error", message: "Choose a valid active plan before activating the subscription" });
    }

    const now = new Date();
    let endsAt: Date | undefined;
    let startsAt = now;
    if (body.status === "trial") {
      const trialDays = body.trialDays === undefined ? 2 : body.trialDays;
      if (!Number.isInteger(trialDays) || (trialDays as number) < 1 || (trialDays as number) > 30) {
        throw new BadRequestException({ code: "validation_error", message: "Trial extension must be between 1 and 30 days" });
      }
      const base = current.subscriptionEndsAt && current.subscriptionEndsAt > now ? current.subscriptionEndsAt : now;
      startsAt = current.subscriptionStartedAt ?? now;
      endsAt = new Date(base.getTime() + (trialDays as number) * DAY_MS);
    }
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
      data: body.status === "active" || body.status === "trial"
        ? {
            subscriptionPlan: plan!.code,
            subscriptionStatus: body.status === "trial" ? "TRIAL" : "ACTIVE",
            subscriptionStartedAt: startsAt,
            subscriptionEndsAt: endsAt,
            billingProvider: "manual",
            enabledModules: plan!.modules,
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
      data: { status: body.status === "active" || body.status === "trial" ? "ACTIVATED" : "DECLINED" },
    });
    await this.recordAudit(request, body.status === "active" ? "subscription.activate" : body.status === "trial" ? "subscription.trial.extend" : body.status === "cancelled" ? "subscription.cancel" : "subscription.expire", "organization", organization.id, {
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
      select: { enabledModules: true, subscriptionStatus: true, subscriptionEndsAt: true },
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

  @Get("audit-logs/export")
  async exportAuditLogs(@Req() request: HttpRequest, @Query("action") action?: string) {
    const filter = action?.trim();
    if (filter && filter.length > 120) {
      throw new BadRequestException({ code: "validation_error", message: "action must be at most 120 characters" });
    }
    const where = filter ? { action: filter } : {};
    const total = await this.prisma.platformAuditLog.count({ where });
    if (total > 10_000) {
      throw new PayloadTooLargeException({ code: "export_too_large", message: "Filter the audit history to export no more than 10,000 entries at a time" });
    }
    const logs = await this.prisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10_000,
    });
    const actorIds = [...new Set(logs.flatMap((log) => log.actorUserId ? [log.actorUserId] : []))];
    const users = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
      : [];
    const actors = new Map(users.map((user) => [user.id, user]));
    await this.recordAudit(request, "audit_log.export", "platform_audit_log", "", {
      action: filter ?? "all",
      exportedCount: logs.length,
    });
    return {
      data: logs.map((log) => ({
        createdAt: log.createdAt.toISOString(),
        actorName: log.actorUserId ? actors.get(log.actorUserId)?.name ?? null : null,
        actorEmail: log.actorEmail ?? (log.actorUserId ? actors.get(log.actorUserId)?.email ?? null : null),
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        reason: safeAuditReason(log.reason),
        details: safeAuditDetails(log.metadata),
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
