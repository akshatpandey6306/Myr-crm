import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, Controller, Inject, Post, Body, Headers, Get, Param, UnauthorizedException, ServiceUnavailableException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { Public, SkipOrganizationContext } from "../auth/public.decorator.js";
import { hashPassword } from "../auth/password.js";
import { AuthEmailService } from "../auth/email.service.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";
import { billingPeriodEnd } from "../billing/billing-period.js";

type ProvisionBody = {
  requestId?: unknown; orderId?: unknown; product?: unknown;
  plan?: { code?: unknown; billingInterval?: unknown; currency?: unknown; amountMinor?: unknown };
  organization?: { name?: unknown; slug?: unknown; timezone?: unknown };
  owner?: { name?: unknown; email?: unknown };
};

@Public()
@SkipOrganizationContext()
@Controller("internal/v1")
export class ProvisioningController {
  private readonly tenantProvisioning: TenantProvisioningService;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthEmailService) private readonly emailService: AuthEmailService,
    @Optional() @Inject(TenantProvisioningService) tenantProvisioning?: TenantProvisioningService) {
    this.tenantProvisioning = tenantProvisioning ?? new TenantProvisioningService();
  }

  @Post("tenants/provision")
  async provision(@Headers("authorization") authorization: string | undefined, @Headers("idempotency-key") key: string | undefined, @Body() body: ProvisionBody) {
    this.authenticate(authorization);
    const requestId = this.text(body?.requestId, 128);
    const orderId = this.text(body?.orderId, 128);
    const idempotencyKey = this.text(key, 200);
    const product = this.text(body?.product, 32);
    const name = this.text(body?.organization?.name, 160);
    const ownerName = this.text(body?.owner?.name, 120);
    const email = this.text(body?.owner?.email, 254).toLowerCase();
    const planCode = this.text(body?.plan?.code, 32);
    if (!requestId || !orderId || !idempotencyKey || product !== "crm" || !name || !ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !planCode) {
      throw new BadRequestException({ code: "validation_error", message: "A valid CRM order, idempotency key, plan, organization, and owner are required" });
    }
    const found = await this.prisma.provisioningRequest.findFirst({ where: { OR: [{ idempotencyKey }, { orderId }, { requestId }] } });
    if (found) {
      if (found.idempotencyKey !== idempotencyKey || found.orderId !== orderId || found.requestId !== requestId) {
        throw new ConflictException({ code: "IDEMPOTENCY_CONFLICT", message: "The order or request ID is already associated with another provisioning request" });
      }
      return this.response(found);
    }

    const plan = await this.prisma.subscriptionPlan.findFirst({ where: { code: planCode, isActive: true } });
    const amountMinor = body.plan?.amountMinor;
    if (!plan || body.plan?.currency !== plan.currency.trim() || body.plan?.billingInterval !== plan.billingInterval ||
      !Number.isSafeInteger(amountMinor) || amountMinor !== plan.price * 100) {
      throw new BadRequestException({ code: "PLAN_NOT_FOUND", message: "The order plan or server-side price does not match an active CRM plan" });
    }
    const requestedSlug = typeof body.organization?.slug === "string" ? body.organization.slug.trim().toLowerCase() : "";
    const organizationSlug = requestedSlug || `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace"}-${randomBytes(3).toString("hex")}`;
    if (organizationSlug && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(organizationSlug)) {
      throw new BadRequestException({ code: "validation_error", message: "Organization slug is invalid" });
    }

    const owner = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (owner) throw new ConflictException({ code: "OWNER_EMAIL_EXISTS", message: "An account already exists for this owner email" });
    const now = new Date();
    const activationToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(activationToken).digest("hex");
    const initialPasswordHash = await hashPassword(randomBytes(32).toString("base64url"));
    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.provisioningRequest.create({ data: { requestId, idempotencyKey, orderId, product, planCode, tenantSlug: organizationSlug, status: "RUNNING" } });
      const user = await tx.user.create({ data: { email, name: ownerName, passwordHash: initialPasswordHash, status: "PENDING" } });
      const organization = await this.tenantProvisioning.createWorkspace(tx, {
        ownerUserId: user.id, name, slug: organizationSlug, timezone: this.text(body.organization?.timezone, 64) || "UTC",
        subscriptionPlan: plan.code, subscriptionStatus: "ACTIVE", subscriptionStartedAt: now,
        subscriptionEndsAt: this.intervalEnd(now, plan.billingInterval), billingProvider: "central",
        enabledModules: plan.modules, membershipStatus: "PENDING",
      });
      await tx.emailToken.create({ data: { userId: user.id, tokenHash, purpose: "ACCOUNT_ACTIVATION", expiresAt: new Date(now.getTime() + 60 * 60 * 1000) } });
      const completed = await tx.provisioningRequest.update({ where: { id: record.id }, data: { status: "SUCCEEDED", organizationId: organization.id, ownerUserId: user.id } });
      return { completed, organization, user };
    });
    let activationEmailSent = true;
    try { await this.emailService.sendAccountActivation(activationToken, email); }
    catch { activationEmailSent = false; }
    await this.prisma.provisioningRequest.update({ where: { id: result.completed.id }, data: { activationEmailSent } });
    return this.response({ ...result.completed, activationEmailSent });
  }

  @Get("provisioning/:requestId")
  async status(@Headers("authorization") authorization: string | undefined, @Param("requestId") requestId: string) {
    this.authenticate(authorization);
    const request = await this.prisma.provisioningRequest.findUnique({ where: { requestId } });
    if (!request) return { requestId, status: "NOT_FOUND" };
    return this.response(request);
  }

  @Post("provisioning/:requestId/activation-email/retry")
  async retryActivationEmail(@Headers("authorization") authorization: string | undefined, @Param("requestId") requestId: string) {
    this.authenticate(authorization);
    const request = await this.prisma.provisioningRequest.findUnique({ where: { requestId } });
    if (!request || !request.ownerUserId || request.status !== "SUCCEEDED") throw new BadRequestException({ code: "PROVISIONING_NOT_READY", message: "No completed provisioning request is available for activation email" });
    if (request.activationEmailSent) return { requestId, activationEmailSent: true };
    const user = await this.prisma.user.findUnique({ where: { id: request.ownerUserId }, select: { email: true, status: true } });
    if (!user || user.status !== "PENDING") throw new ConflictException({ code: "ACCOUNT_ALREADY_ACTIVE", message: "The owner account is already active or unavailable" });
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.emailToken.updateMany({ where: { userId: request.ownerUserId!, purpose: "ACCOUNT_ACTIVATION", consumedAt: null }, data: { consumedAt: now } });
      await tx.emailToken.create({ data: { userId: request.ownerUserId!, tokenHash: createHash("sha256").update(token).digest("hex"), purpose: "ACCOUNT_ACTIVATION", expiresAt: new Date(now.getTime() + 60 * 60 * 1000) } });
    });
    try {
      await this.emailService.sendAccountActivation(token, user.email);
      await this.prisma.provisioningRequest.update({ where: { id: request.id }, data: { activationEmailSent: true } });
      return { requestId, activationEmailSent: true };
    } catch {
      return { requestId, activationEmailSent: false, code: "ACTIVATION_EMAIL_FAILED" };
    }
  }

  private response(row: { requestId: string; status: string; organizationId: string | null; ownerUserId: string | null; planCode: string; tenantSlug?: string | null; activationEmailSent: boolean }) {
    return { requestId: row.requestId, status: row.status, ...(row.status === "SUCCEEDED" ? { tenant: { id: row.organizationId, slug: row.tenantSlug, loginUrl: `${process.env.WEB_ORIGIN?.replace(/\/$/, "") || "http://localhost:3000"}/sign-in` }, owner: { userId: row.ownerUserId, activationRequired: true }, subscription: { status: "ACTIVE", planCode: row.planCode }, activationEmailSent: row.activationEmailSent } : {}) };
  }
  private authenticate(header?: string) {
    const configured = process.env.CRM_PROVISIONING_TOKEN;
    if (!configured) throw new ServiceUnavailableException({ code: "provisioning_unavailable", message: "Provisioning service credentials are not configured" });
    const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const a = Buffer.from(supplied); const b = Buffer.from(configured);
    if (!supplied || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException({ code: "service_auth_failed", message: "Service authentication failed" });
  }
  private text(value: unknown, max: number) { return typeof value === "string" && value.trim().length <= max ? value.trim() : ""; }
  private intervalEnd(from: Date, rawInterval: number) {
    const end = billingPeriodEnd(from, rawInterval);
    if (!end) throw new BadRequestException({ code: "PLAN_NOT_FOUND", message: "Unsupported plan duration" });
    return end;
  }
}
