import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, Logger, NotFoundException, Param, Patch, Post, Body, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { Public, SkipOrganizationContext } from "../auth/public.decorator.js";
import { PlatformAdminGuard } from "../auth/platform-admin.guard.js";
import { TenantProvisioningService } from "../provisioning/tenant-provisioning.service.js";
import { AuthEmailService } from "../auth/email.service.js";
import { hashPassword } from "../auth/password.js";
import { HttpRequest } from "../common/http.types.js";
import { billingPeriodEnd } from "../billing/billing-period.js";

const allowedPermissions = ["provision", "customers:read", "subscriptions:write"];
const bodyObject = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : "";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function encryptionKey() {
  const value = process.env.PARTNER_SECRET_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("PARTNER_SECRET_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters");
  return Buffer.from(value, "hex");
}
function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decryptSecret(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted partner secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
function newApiKey() {
  const secret = `crm_partner_${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 22), hash: sha(secret) };
}

@Public()
@SkipOrganizationContext()
@Controller("partner/v1")
export class PartnerIntegrationController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthEmailService) private readonly email: AuthEmailService,
    @Inject(TenantProvisioningService) private readonly provisioning: TenantProvisioningService) {}

  @Get("health") async health(@Headers("authorization") auth: string | undefined) {
    const { partner } = await this.authenticate(auth, undefined, "health");
    return { status: "ok", partner: { id: partner.id, name: partner.name } };
  }

  @Get("summary") async summary(@Headers("authorization") auth: string | undefined) {
    const { partner } = await this.authenticate(auth, "customers:read", "partner.summary");
    const [accounts, events] = await Promise.all([
      this.prisma.partnerCustomerMapping.findMany({ where: { partnerId: partner.id }, select: { organization: { select: { subscriptionStatus: true } } } }),
      this.prisma.partnerWebhookEvent.groupBy({ by: ["eventType"], where: { partnerId: partner.id }, _count: { _all: true } }),
    ]);
    const byStatus = accounts.reduce<Record<string, number>>((counts, account) => {
      const status = account.organization.subscriptionStatus.toLowerCase();
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {});
    const eventCounts = Object.fromEntries(events.map((event) => [event.eventType, event._count._all]));
    return { data: {
      accounts: { total: accounts.length, bySubscriptionStatus: byStatus },
      payments: {
        verified: eventCounts["subscription.activated"] ?? 0,
        failed: eventCounts["payment.failed"] ?? 0,
      },
    } };
  }

  @Post("provision")
  async provision(@Headers("authorization") auth: string | undefined, @Headers("idempotency-key") idempotency: string | undefined, @Body() raw: unknown) {
    const { partner } = await this.authenticate(auth, "provision", "provision");
    const body = bodyObject(raw); const owner = bodyObject(body.owner); const organization = bodyObject(body.organization); const planInput = bodyObject(body.plan);
    const credentialResponse = typeof body.email === "string";
    const email = text(credentialResponse ? body.email : owner.email, 254).toLowerCase();
    const ownerName = text(credentialResponse ? body.name : owner.name, 120);
    const name = text(credentialResponse ? (typeof body.organization === "string" ? body.organization : organization.name) : organization.name, 160);
    const requestedPlan = text(credentialResponse ? (typeof body.plan === "string" ? body.plan : planInput.code) : planInput.code, 80);
    const requestedPlanId = text(body.planId, 64);
    const product = (text(body.product, 32) || "crm").toLowerCase();
    const purchaseType = credentialResponse ? "paid" : body.purchaseType === "paid" ? "paid" : "";
    const validityDays = body.validityDays === undefined ? 30 : body.validityDays;
    if (!Number.isSafeInteger(validityDays) || (validityDays as number) < 1 || (validityDays as number) > 3650)
      throw new BadRequestException({ code: "validation_error", message: "validityDays must be a whole number from 1 to 3650" });
    const rawRequestId = text(body.requestId, 128);
    const requestedRequestId = rawRequestId ? (rawRequestId.length <= 75 ? rawRequestId : `req-${sha(rawRequestId).slice(0, 64)}`) : "";
    const stableCustomerRef = email.length <= 160 ? email : `email-${sha(email).slice(0, 48)}`;
    const externalCustomerRef = text(body.externalCustomerRef, 160) || stableCustomerRef;
    const externalSubscriptionRef = text(body.externalSubscriptionRef, 160) || null;
    const stableSuffix = sha(`${partner.id}:${email}`).slice(0, 40);
    const rawOrderId = text(body.externalOrderRef, 128) || text(body.orderId, 128);
    const orderId = rawOrderId ? (rawOrderId.length <= 80 ? rawOrderId : `ref-${sha(rawOrderId).slice(0, 64)}`) : `ord-${stableSuffix}`;
    const requestId = requestedRequestId || (credentialResponse ? `req-${stableSuffix}` : randomUUID());
    const rawIdempotencyKey = text(idempotency, 200);
    const idempotencyKey = rawIdempotencyKey ? (rawIdempotencyKey.length <= 150 ? rawIdempotencyKey : `key-${sha(rawIdempotencyKey)}`) : (credentialResponse ? `partner:${partner.id}:email:${stableSuffix}` : "");
    if (product !== "crm" || !name || !ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !requestedPlan || !purchaseType || !externalCustomerRef || !orderId || !idempotencyKey)
      throw new BadRequestException({ code: "validation_error", message: "A valid CRM product, email, name, organization, plan, and Idempotency-Key are required" });
    if (credentialResponse) {
      try { encryptionKey(); }
      catch { throw new ServiceUnavailableException({ code: "partner_encryption_not_configured", message: "Partner credential encryption is not configured on the API. Set PARTNER_SECRET_ENCRYPTION_KEY to 64 hexadecimal characters and restart the API." }); }
    }

    const uuidPlanId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedPlanId) ? requestedPlanId : "";
    const plan = await this.prisma.subscriptionPlan.findFirst({ where: {
      isActive: true,
      OR: [
        { code: requestedPlan },
        { name: { equals: requestedPlan, mode: "insensitive" } },
        ...(uuidPlanId ? [{ id: uuidPlanId }] : []),
      ],
    } });
    if (!plan) throw new BadRequestException({ code: "plan_not_found", message: "The selected plan is unavailable" });
    if (uuidPlanId && (plan.id !== uuidPlanId || (requestedPlan.toLowerCase() !== plan.code.toLowerCase() && requestedPlan.toLowerCase() !== plan.name.toLowerCase())))
      throw new BadRequestException({ code: "plan_mismatch", message: "plan and planId must identify the same active CRM plan" });
    const planCode = plan.code;
    const existing = await this.prisma.provisioningRequest.findFirst({ where: { OR: [{ idempotencyKey: `partner:${partner.id}:${idempotencyKey}` }, { orderId: `partner:${partner.id}:${orderId}` }, { requestId: `partner:${partner.id}:${requestId}` }] } });
    if (existing) {
      if (existing.idempotencyKey !== `partner:${partner.id}:${idempotencyKey}` || existing.orderId !== `partner:${partner.id}:${orderId}` ||
        (requestedRequestId && existing.requestId !== `partner:${partner.id}:${requestedRequestId}`) ||
        existing.externalCustomerRef !== externalCustomerRef || existing.purchaseType !== purchaseType || existing.planCode !== planCode)
        throw new ConflictException({ code: "idempotency_conflict", message: "The idempotency key or order reference was already used with different customer details" });
      return this.provisioningResponse(existing);
    }
    const mapped = await this.prisma.partnerCustomerMapping.findUnique({ where: { partnerId_externalCustomerRef: { partnerId: partner.id, externalCustomerRef } } });
    if (mapped) throw new ConflictException({ code: "customer_exists", message: "This external customer is already linked to a CRM workspace" });
    const existingUser = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) throw new ConflictException({ code: "customer_exists", message: "An account already exists for this email. Contact the platform administrator to link it." });
    const now = new Date();
    const subscriptionEndsAt = credentialResponse ? new Date(now.getTime() + (validityDays as number) * 24 * 60 * 60 * 1000) : null;
    const slugCandidate = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace"}-${randomBytes(3).toString("hex")}`;
    const slug = text(organization.slug, 63).toLowerCase() || slugCandidate;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) throw new BadRequestException({ code: "validation_error", message: "Organization slug is invalid" });
    const password = credentialResponse ? randomBytes(24).toString("base64url") : "";
    const activationToken = credentialResponse ? "" : randomBytes(32).toString("base64url");
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const request = await tx.provisioningRequest.create({ data: {
          requestId: `partner:${partner.id}:${requestId}`, idempotencyKey: `partner:${partner.id}:${idempotencyKey}`, orderId: `partner:${partner.id}:${orderId}`,
          product, planCode, partnerId: partner.id, externalCustomerRef, purchaseType,
          tenantSlug: slug, status: "RUNNING", credentialsEnc: credentialResponse ? encryptSecret(JSON.stringify({ username: email, password, validUntil: subscriptionEndsAt?.toISOString() ?? null })) : null,
        } });
        const user = await tx.user.create({ data: { email, name: ownerName, passwordHash: hashPassword(credentialResponse ? password : randomBytes(32).toString("base64url")), status: credentialResponse ? "ACTIVE" : "PENDING" } });
        const workspace = await this.provisioning.createWorkspace(tx, {
          ownerUserId: user.id, name, slug, timezone: text(organization.timezone, 64) || "UTC", subscriptionPlan: plan.code,
          subscriptionStatus: credentialResponse ? "ACTIVE" : "PENDING", subscriptionStartedAt: credentialResponse ? now : null,
          subscriptionEndsAt, billingProvider: "partner", enabledModules: credentialResponse ? plan.modules : [],
        });
        if (!credentialResponse) await tx.emailToken.create({ data: { userId: user.id, tokenHash: sha(activationToken), purpose: "ACCOUNT_ACTIVATION", expiresAt: new Date(now.getTime() + 60 * 60 * 1000) } });
        await tx.partnerCustomerMapping.create({ data: { partnerId: partner.id, organizationId: workspace.id, externalCustomerRef, externalSubscriptionRef, email } });
        await tx.provisioningRequest.update({ where: { id: request.id }, data: { status: "SUCCEEDED", organizationId: workspace.id, ownerUserId: user.id, activationEmailSent: false } });
        return { request, user, workspace };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002")
        throw new ConflictException({ code: "external_reference_conflict", message: "The external customer, subscription, or idempotency reference is already in use" });
      throw error;
    }
    let activationEmailSent = false;
    if (!credentialResponse) {
      try { await this.email.sendAccountActivation(activationToken, email); activationEmailSent = true; }
      catch { /* platform can retry delivery from provisioning controls */ }
    }
    const row = await this.prisma.provisioningRequest.update({ where: { id: created.request.id }, data: { activationEmailSent } });
    await this.prisma.platformAuditLog.create({ data: { action: "partner.provision", targetType: "organization", targetId: created.workspace.id, reason: `Partner ${partner.name} provisioned external customer ${externalCustomerRef}`, metadata: { partnerId: partner.id, requestId: row.requestId, externalCustomerRef, purchaseType } } });
    return this.provisioningResponse(row);
  }

  @Get("customers/:externalCustomerRef")
  async customer(@Headers("authorization") auth: string | undefined, @Param("externalCustomerRef") ref: string) {
    const { partner } = await this.authenticate(auth, "customers:read", "customer.lookup");
    const mapping = await this.prisma.partnerCustomerMapping.findUnique({ where: { partnerId_externalCustomerRef: { partnerId: partner.id, externalCustomerRef: ref } }, include: { organization: { select: { id: true, name: true, slug: true, subscriptionPlan: true, subscriptionStatus: true, subscriptionStartedAt: true, subscriptionEndsAt: true } } } });
    if (!mapping) throw new NotFoundException({ code: "customer_not_found", message: "Customer mapping was not found" });
    return { externalCustomerRef: ref, externalSubscriptionRef: mapping.externalSubscriptionRef, organization: mapping.organization, subscription: { status: mapping.organization.subscriptionStatus.toLowerCase(), planCode: mapping.organization.subscriptionPlan, startsAt: mapping.organization.subscriptionStartedAt?.toISOString() ?? null, endsAt: mapping.organization.subscriptionEndsAt?.toISOString() ?? null } };
  }

  @Post("webhooks/subscription")
  async webhook(@Headers("x-crm-partner") partnerId: string | undefined, @Headers("x-crm-timestamp") timestamp: string | undefined, @Headers("x-crm-signature") signature: string | undefined, @Req() req: HttpRequest & { rawBody?: Buffer }, @Body() raw: unknown) {
    const partner = partnerId ? await this.prisma.integrationPartner.findFirst({ where: { id: partnerId, enabled: true } }) : null;
    if (!partner?.webhookSecretEnc || !timestamp || !signature || !req.rawBody) { await this.recordFailedPartnerAuth(`webhook_headers:${partnerId ?? "missing_partner"}`); throw new UnauthorizedException({ code: "invalid_signature", message: "Signed webhook headers or raw request body are missing" }); }
    const sentAt = Number(timestamp); if (!Number.isSafeInteger(sentAt) || Math.abs(Date.now() - sentAt * 1000) > 5 * 60 * 1000) { await this.recordFailedPartnerAuth(`webhook_stale:${partnerId}`); throw new UnauthorizedException({ code: "stale_webhook", message: "Webhook timestamp is outside the allowed five-minute window" }); }
    const expected = createHmac("sha256", decryptSecret(partner.webhookSecretEnc)).update(`${timestamp}.`).update(req.rawBody).digest("hex");
    const a = Buffer.from(signature.replace(/^sha256=/, ""), "hex"); const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) { await this.recordFailedPartnerAuth(`webhook_signature:${partnerId}`); throw new UnauthorizedException({ code: "invalid_signature", message: "Webhook signature verification failed" }); }
    const body = bodyObject(raw); const eventId = text(body.eventId, 160); const eventType = text(body.type, 48).toLowerCase(); const customerRef = text(body.externalCustomerRef, 160); const externalSubscriptionRef = text(body.externalSubscriptionRef, 160);
    if (!eventId || !customerRef || !externalSubscriptionRef || !["subscription.activated", "subscription.renewed", "subscription.upgraded", "subscription.downgraded", "subscription.cancelled", "subscription.expired", "subscription.suspended", "payment.failed"].includes(eventType)) throw new BadRequestException({ code: "validation_error", message: "A supported eventId, event type, externalCustomerRef, and externalSubscriptionRef are required" });
    const payloadHash = sha(req.rawBody.toString("utf8"));
    const prior = await this.prisma.partnerWebhookEvent.findUnique({ where: { partnerId_externalEventId: { partnerId: partner.id, externalEventId: eventId } } });
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw new ConflictException({ code: "event_id_conflict", message: "This eventId was already used with a different webhook payload" });
      return { received: true, duplicate: true, outcome: prior.outcome };
    }
    const mapping = await this.prisma.partnerCustomerMapping.findUnique({ where: { partnerId_externalCustomerRef: { partnerId: partner.id, externalCustomerRef: customerRef } }, include: { organization: true } });
    if (!mapping) throw new NotFoundException({ code: "customer_not_found", message: "No organization is linked to this external customer" });
    if (mapping.externalSubscriptionRef && mapping.externalSubscriptionRef !== externalSubscriptionRef) throw new ConflictException({ code: "subscription_reference_mismatch", message: "The event subscription reference does not match the mapped customer subscription" });
    const now = new Date(); const statuses: Record<string, "ACTIVE" | "PENDING" | "CANCELLED" | "EXPIRED"> = {
      "subscription.activated": "ACTIVE", "subscription.renewed": "ACTIVE", "subscription.upgraded": "ACTIVE", "subscription.downgraded": "ACTIVE",
      "subscription.cancelled": "CANCELLED", "subscription.expired": "EXPIRED", "subscription.suspended": "PENDING", "payment.failed": "PENDING",
    };
    const nextStatus = statuses[eventType]!; const planCode = text(body.planCode, 32) || mapping.organization.subscriptionPlan;
    const basePlan = await this.prisma.subscriptionPlan.findFirst({ where: { code: planCode ?? "", isActive: true } });
    const override = await this.prisma.organizationSubscriptionPlanOverride.findUnique({ where: { organizationId_planCode: { organizationId: mapping.organizationId, planCode: planCode ?? "" } } });
    const plan = override?.isActive ? { ...override, code: override.planCode } : basePlan;
    if (nextStatus === "ACTIVE" && !plan) throw new BadRequestException({ code: "plan_not_found", message: "A valid active planCode is required to activate a subscription" });
    const periodEndText = text(body.periodEndsAt, 40); const periodEnd = periodEndText ? new Date(periodEndText) : null;
    if (periodEndText && (!periodEnd || !Number.isFinite(periodEnd.getTime()) || periodEnd <= now)) throw new BadRequestException({ code: "validation_error", message: "periodEndsAt must be a future ISO-8601 timestamp" });
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id: mapping.organizationId }, data: {
          subscriptionStatus: nextStatus, ...(nextStatus === "ACTIVE" ? { subscriptionPlan: planCode!, subscriptionStartedAt: now, subscriptionEndsAt: periodEnd ?? this.intervalEnd(now, plan!.billingInterval), enabledModules: plan!.modules, billingProvider: "partner" } : {}),
          ...(nextStatus === "CANCELLED" || nextStatus === "EXPIRED" ? { subscriptionEndsAt: now } : {}),
        } });
        if (!mapping.externalSubscriptionRef) await tx.partnerCustomerMapping.update({ where: { id: mapping.id }, data: { externalSubscriptionRef } });
        await tx.partnerWebhookEvent.create({ data: { partnerId: partner.id, externalEventId: eventId, eventType, organizationId: mapping.organizationId, payloadHash, outcome: "processed" } });
        await tx.platformAuditLog.create({ data: { action: "partner.subscription_event", targetType: "organization", targetId: mapping.organizationId, reason: eventType, metadata: { partnerId: partner.id, eventId, payloadHash } } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const duplicate = await this.prisma.partnerWebhookEvent.findUnique({ where: { partnerId_externalEventId: { partnerId: partner.id, externalEventId: eventId } } });
      if (duplicate) return { received: true, duplicate: true, outcome: duplicate.outcome };
      throw error;
    }
    return { received: true, duplicate: false, outcome: "processed", subscriptionStatus: nextStatus.toLowerCase() };
  }

  private async authenticate(header: string | undefined, permission?: string, operation = "api.request") {
    const supplied = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!supplied) {
      await this.recordFailedPartnerAuth("missing_key");
      throw new UnauthorizedException({ code: "partner_auth_failed", message: "Partner API key is required" });
    }
    const key = await this.prisma.partnerApiKey.findUnique({ where: { keyHash: sha(supplied) }, include: { partner: true } });
    if (!key || !key.active || key.revokedAt || !key.partner.enabled) {
      await this.recordFailedPartnerAuth(`key_prefix:${supplied.slice(0, 14)}`);
      throw new UnauthorizedException({ code: "partner_auth_failed", message: "Partner API key is invalid or inactive" });
    }
    if (permission && (!key.permissions.includes(permission) || !key.partner.permissions.includes(permission))) throw new ForbiddenException({ code: "partner_permission_denied", message: "This partner key does not have permission for this operation" });
    await Promise.all([
      this.prisma.partnerApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }),
      this.prisma.partnerApiUsageLog.create({ data: { partnerId: key.partnerId, apiKeyId: key.id, operation } }),
    ]);
    return { partner: key.partner, key };
  }
  private provisioningResponse(row: { requestId: string; status: string; organizationId: string | null; ownerUserId: string | null; planCode: string; tenantSlug: string | null; activationEmailSent: boolean; purchaseType?: string | null; externalCustomerRef?: string | null; credentialsEnc?: string | null }) {
    const loginUrl = `${process.env.WEB_ORIGIN?.replace(/\/$/, "") || "http://localhost:3000"}/sign-in`;
    if (row.status === "SUCCEEDED" && row.credentialsEnc) {
      const credentials = JSON.parse(decryptSecret(row.credentialsEnc)) as { username: string; password: string; validUntil?: string | null };
      return { requestId: row.requestId, status: row.status, username: credentials.username, password: credentials.password, login_url: loginUrl, externalCustomerRef: row.externalCustomerRef, organization: { id: row.organizationId, tenantId: row.organizationId, slug: row.tenantSlug }, subscription: { status: "ACTIVE", planCode: row.planCode, validUntil: credentials.validUntil ?? null } };
    }
    return { requestId: row.requestId, status: row.status, externalCustomerRef: row.externalCustomerRef, ...(row.status === "SUCCEEDED" ? { organization: { id: row.organizationId, tenantId: row.organizationId, slug: row.tenantSlug, loginUrl }, owner: { userId: row.ownerUserId, activationRequired: true }, subscription: { status: "PENDING", planCode: row.planCode }, activationEmailSent: row.activationEmailSent } : {}) };
  }
  private intervalEnd(from: Date, rawInterval: number) { const end = billingPeriodEnd(from, rawInterval); if (!end) throw new BadRequestException({ code: "invalid_plan_interval", message: "Unsupported plan duration" }); return end; }
  private async recordFailedPartnerAuth(reason: string) {
    try { await this.prisma.platformAuditLog.create({ data: { action: "partner.auth.failed", targetType: "partner_api_key", reason: reason.slice(0, 120) } }); } catch { /* auth rejection must not depend on audit storage */ }
  }
}

@SkipOrganizationContext()
@Controller("control-panel/partners")
@UseGuards(PlatformAdminGuard)
export class PartnerAdminController {
  private readonly logger = new Logger(PartnerAdminController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get() async list() {
    const partners = await this.prisma.integrationPartner.findMany({ include: { apiKeys: { select: { id: true, keyPrefix: true, permissions: true, active: true, lastUsedAt: true, revokedAt: true, createdAt: true } }, _count: { select: { mappings: true, webhookEvents: true, usageLogs: true } } }, orderBy: { createdAt: "desc" } });
    return { data: partners.map(({ webhookSecretEnc, ...partner }) => ({ ...partner, hasWebhookSecret: Boolean(webhookSecretEnc) })) };
  }
  @Get(":partnerId/credentials") async revealCredentials(@Param("partnerId") partnerId: string, @Req() req: HttpRequest) {
    const partner = await this.prisma.integrationPartner.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        webhookSecretEnc: true,
        apiKeys: { where: { active: true }, select: { id: true, keyPrefix: true, keySecretEnc: true } },
      },
    });
    if (!partner) throw new NotFoundException({ code: "not_found", message: "Partner not found" });
    const credentials = {
      webhookSigningSecret: partner.webhookSecretEnc ? decryptSecret(partner.webhookSecretEnc) : null,
      apiKeys: partner.apiKeys.map((key) => ({
        id: key.id,
        keyPrefix: key.keyPrefix,
        apiKey: key.keySecretEnc ? decryptSecret(key.keySecretEnc) : null,
        requiresRotation: !key.keySecretEnc,
      })),
    };
    await this.audit(req.userId, "partner.credentials.reveal", partnerId, "Revealed integration partner credentials to a platform administrator");
    return { data: credentials };
  }
  @Get("metrics") async metrics() {
    const [partnerCustomers, adminAudit, payments, partnerEvents, customersByPartner] = await Promise.all([
      this.prisma.partnerCustomerMapping.count(),
      this.prisma.platformAuditLog.findMany({ where: { action: "organization.create", targetType: "organization", targetId: { not: null } }, select: { targetId: true } }),
      this.prisma.subscriptionPayment.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.partnerWebhookEvent.groupBy({ by: ["eventType"], _count: { _all: true } }),
      this.prisma.partnerCustomerMapping.groupBy({ by: ["partnerId"], _count: { _all: true } }),
    ]);
    const platformAdminOrganizationIds = new Set(adminAudit.flatMap((entry) => entry.targetId ? [entry.targetId] : []));
    const paymentCounts = Object.fromEntries(payments.map((entry) => [entry.status.toLowerCase(), {
      count: entry._count._all,
      amount: Number(entry._sum.amount ?? 0),
    }]));
    const eventCounts = Object.fromEntries(partnerEvents.map((entry) => [entry.eventType, entry._count._all]));
    return { data: {
      onboarded: { partners: partnerCustomers, platformAdmin: platformAdminOrganizationIds.size },
      payments: paymentCounts,
      partnerPaymentEvents: {
        succeeded: (eventCounts["payment.succeeded"] ?? 0) + (eventCounts["subscription.activated"] ?? 0),
        failed: eventCounts["payment.failed"] ?? 0,
      },
      customersByPartner: Object.fromEntries(customersByPartner.map((entry) => [entry.partnerId, entry._count._all])),
    } };
  }
  @Post() async create(@Body() raw: unknown, @Req() req: HttpRequest) {
    const body = bodyObject(raw); const name = text(body.name, 120); const permissions = Array.isArray(body.permissions) ? body.permissions.filter((item): item is string => typeof item === "string") : allowedPermissions;
    if (!name || permissions.some((item) => !allowedPermissions.includes(item))) throw new BadRequestException({ code: "validation_error", message: "Partner name and supported permissions are required" });
    const webhookUrl = body.webhookUrl == null ? null : text(body.webhookUrl, 2048); const plansUrl = body.plansUrl == null ? null : text(body.plansUrl, 2048);
    for (const url of [webhookUrl, plansUrl]) if (url && (!/^https:\/\//i.test(url) || url.length > 2048)) throw new BadRequestException({ code: "validation_error", message: "Partner URLs must use HTTPS" });
    const key = newApiKey(); const webhookSecret = randomBytes(32).toString("base64url");
    let partner;
    try {
      partner = await this.prisma.$transaction(async (tx) => {
        const created = await tx.integrationPartner.create({ data: { name, permissions: [...new Set(permissions)], webhookUrl, plansUrl, webhookSecretEnc: encryptSecret(webhookSecret), apiKeys: { create: { keyPrefix: key.prefix, keyHash: key.hash, keySecretEnc: encryptSecret(key.secret), permissions: [...new Set(permissions)] } } }, include: { apiKeys: { select: { id: true, keyPrefix: true, permissions: true, active: true } } } });
        await tx.platformAuditLog.create({ data: { actorUserId: req.userId ?? null, action: "partner.create", targetType: "integration_partner", targetId: created.id, reason: `Created integration partner ${name}` } });
        return created;
      });
    } catch (error) {
      const prismaCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
      const message = error instanceof Error ? error.message : "";
      if (message.includes("PARTNER_SECRET_ENCRYPTION_KEY")) {
        throw new ServiceUnavailableException({ code: "partner_encryption_not_configured", message: "Partner secret encryption is not configured on the API. Set PARTNER_SECRET_ENCRYPTION_KEY to 64 hexadecimal characters and restart the API." });
      }
      if (["P2021", "P2022"].includes(prismaCode)) {
        throw new ServiceUnavailableException({ code: "partner_schema_not_ready", message: "Partner integration database tables are missing. Run the API database migrations, then restart the API." });
      }
      if (["P1001", "P1002", "P1017"].includes(prismaCode)) {
        throw new ServiceUnavailableException({ code: "database_unavailable", message: "The CRM database is unavailable. Start or reconnect PostgreSQL, then try again." });
      }
      this.logger.error(`Partner creation failed (${prismaCode || "unknown database or transaction error"})`);
      throw error;
    }
    return { data: { ...partner, webhookSecretEnc: undefined, apiKey: key.secret, webhookSigningSecret: webhookSecret, secretsShownOnce: true } };
  }
  @Post(":partnerId/keys/rotate") async rotate(@Param("partnerId") partnerId: string, @Req() req: HttpRequest) {
    const partner = await this.prisma.integrationPartner.findUnique({ where: { id: partnerId } }); if (!partner) throw new NotFoundException({ code: "not_found", message: "Partner not found" });
    const key = newApiKey();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.partnerApiKey.updateMany({ where: { partnerId, active: true }, data: { active: false, revokedAt: new Date() } });
      const next = await tx.partnerApiKey.create({ data: { partnerId, keyPrefix: key.prefix, keyHash: key.hash, keySecretEnc: encryptSecret(key.secret), permissions: partner.permissions } });
      await tx.platformAuditLog.create({ data: { actorUserId: req.userId ?? null, action: "partner.key.rotate", targetType: "integration_partner", targetId: partnerId, reason: "Rotated partner API key" } });
      return next;
    });
    return { data: { id: created.id, keyPrefix: created.keyPrefix, apiKey: key.secret, secretsShownOnce: true } };
  }
  @Post(":partnerId/webhook-secret/rotate") async rotateWebhookSecret(@Param("partnerId") partnerId: string, @Req() req: HttpRequest) {
    const secret = randomBytes(32).toString("base64url");
    const result = await this.prisma.integrationPartner.updateMany({ where: { id: partnerId }, data: { webhookSecretEnc: encryptSecret(secret) } });
    if (!result.count) throw new NotFoundException({ code: "not_found", message: "Partner not found" });
    await this.audit(req.userId, "partner.webhook_secret.rotate", partnerId, "Rotated partner webhook signing secret");
    return { data: { webhookSigningSecret: secret, secretsShownOnce: true } };
  }
  @Post(":partnerId/status") async status(@Param("partnerId") partnerId: string, @Body() raw: unknown, @Req() req: HttpRequest) {
    const enabled = bodyObject(raw).enabled; if (typeof enabled !== "boolean") throw new BadRequestException({ code: "validation_error", message: "enabled must be a boolean" });
    const result = await this.prisma.integrationPartner.updateMany({ where: { id: partnerId }, data: { enabled } }); if (!result.count) throw new NotFoundException({ code: "not_found", message: "Partner not found" }); await this.audit(req.userId, "partner.status", partnerId, enabled ? "Enabled integration partner" : "Disabled integration partner"); return { data: { id: partnerId, enabled } };
  }
  @Patch(":partnerId") async updatePartner(@Param("partnerId") partnerId: string, @Body() raw: unknown, @Req() req: HttpRequest) {
    const body = bodyObject(raw); const data: { name?: string; permissions?: string[]; webhookUrl?: string | null; plansUrl?: string | null } = {};
    if (body.name !== undefined) { const name = text(body.name, 120); if (!name) throw new BadRequestException({ code: "validation_error", message: "Partner name is required" }); data.name = name; }
    if (body.permissions !== undefined) {
      if (!Array.isArray(body.permissions) || body.permissions.length === 0 || body.permissions.some((item) => typeof item !== "string" || !allowedPermissions.includes(item))) throw new BadRequestException({ code: "validation_error", message: "At least one supported permission is required" });
      data.permissions = [...new Set(body.permissions as string[])];
    }
    for (const field of ["webhookUrl", "plansUrl"] as const) if (body[field] !== undefined) {
      const value = body[field] === null || body[field] === "" ? null : text(body[field], 2048);
      if (value && !/^https:\/\//i.test(value)) throw new BadRequestException({ code: "validation_error", message: `${field} must use HTTPS` });
      data[field] = value;
    }
    const updated = await this.prisma.integrationPartner.update({ where: { id: partnerId }, data, select: { id: true, name: true, enabled: true, permissions: true, webhookUrl: true, plansUrl: true } }).catch(() => null);
    if (!updated) throw new NotFoundException({ code: "not_found", message: "Partner not found" });
    if (data.permissions) await this.prisma.partnerApiKey.updateMany({ where: { partnerId, active: true }, data: { permissions: data.permissions } });
    await this.audit(req.userId, "partner.update", partnerId, "Updated partner integration settings");
    return { data: updated };
  }
  @Post(":partnerId/keys/:keyId/revoke") async revoke(@Param("partnerId") partnerId: string, @Param("keyId") keyId: string, @Req() req: HttpRequest) {
    const result = await this.prisma.partnerApiKey.updateMany({ where: { id: keyId, partnerId, active: true }, data: { active: false, revokedAt: new Date() } }); if (!result.count) throw new NotFoundException({ code: "key_not_found", message: "Active partner key not found" }); await this.audit(req.userId, "partner.key.revoke", partnerId, "Revoked partner API key"); return { data: { revoked: true } };
  }
  @Get("customers") async customers() {
    const rows = await this.prisma.partnerCustomerMapping.findMany({ include: { partner: { select: { id: true, name: true } }, organization: { select: { id: true, name: true, slug: true, status: true, subscriptionStatus: true, subscriptionPlan: true, subscriptionStartedAt: true, subscriptionEndsAt: true, memberships: { where: { role: "OWNER" }, include: { user: { select: { id: true, name: true, email: true } } }, take: 1 } } } }, orderBy: { createdAt: "desc" }, take: 500 });
    return { data: rows.map((row) => ({ partner: row.partner, externalCustomerRef: row.externalCustomerRef, email: row.email, organization: row.organization, owner: row.organization.memberships[0]?.user ?? null, createdAt: row.createdAt })) };
  }
  @Get("events") async events() { return { data: await this.prisma.partnerWebhookEvent.findMany({ orderBy: { createdAt: "desc" }, take: 500, select: { id: true, partnerId: true, externalEventId: true, eventType: true, organizationId: true, payloadHash: true, outcome: true, createdAt: true } }) }; }
  @Get("usage") async usage() { return { data: await this.prisma.partnerApiUsageLog.findMany({ orderBy: { createdAt: "desc" }, take: 500, select: { id: true, partnerId: true, apiKeyId: true, operation: true, createdAt: true } }) }; }
  private audit(actorUserId: string | undefined, action: string, targetId: string, reason: string) {
    return this.prisma.platformAuditLog.create({ data: { actorUserId: actorUserId ?? null, action, targetType: "integration_partner", targetId, reason } });
  }
}
