import assert from "node:assert/strict";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { PartnerIntegrationController } from "../src/partners/partner-integration.controller.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function encryptForTest(secret: string, key: Buffer) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

describe("PartnerIntegrationController", () => {
  it("rejects invalid partner API keys", async () => {
    const prisma = {
      partnerApiKey: { findUnique: async () => null },
      platformAuditLog: { create: async () => ({}) },
    };
    const controller = new PartnerIntegrationController(prisma as never, {} as never, {} as never);
    await assert.rejects(controller.customer("Bearer invalid", "external-1"), UnauthorizedException);
  });

  it("provisions a paid customer with credentials and returns an idempotent replay", async () => {
    const previousEncryptionKey = process.env.PARTNER_SECRET_ENCRYPTION_KEY;
    const encryptionKey = randomBytes(32);
    process.env.PARTNER_SECRET_ENCRYPTION_KEY = encryptionKey.toString("hex");
    const expectedValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const apiKey = "partner-api-secret";
    const partner = { id: "partner-1", name: "Partner", enabled: true, permissions: ["provision", "customers:read", "subscriptions:write"] };
    const storedRequest = {
      id: "provision-1", requestId: "partner:partner-1:req-1", idempotencyKey: "partner:partner-1:once-1", orderId: "partner:partner-1:order-1", status: "SUCCEEDED", organizationId: "org-1", ownerUserId: "user-1", planCode: "starter", tenantSlug: "acme-abc123", activationEmailSent: true,
      purchaseType: "paid", externalCustomerRef: "cust-1", credentialsEnc: encryptForTest(JSON.stringify({ username: "owner@example.com", password: "generated-secret", validUntil: expectedValidUntil }), encryptionKey),
    };
    let replay = false;
    const api = {
      partnerApiKey: {
        findUnique: async () => ({ id: "key-1", keyHash: digest(apiKey), active: true, revokedAt: null, permissions: ["provision"], partner }),
        update: async () => ({}),
      },
      partnerApiUsageLog: { create: async () => ({}) },
      provisioningRequest: {
        findFirst: async () => replay ? storedRequest : null,
        update: async () => ({ ...storedRequest, activationEmailSent: true }),
      },
      partnerCustomerMapping: { findUnique: async () => null, create: async () => ({}) },
      subscriptionPlan: { findFirst: async () => ({ code: "starter", modules: ["leads", "contacts"] }) },
      user: { findUnique: async () => null, create: async () => ({ id: "user-1" }) },
      provisioning: { create: async () => ({ id: "provision-1" }) },
      platformAuditLog: { create: async () => ({}) },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
        provisioningRequest: { create: async () => ({ id: "provision-1" }), update: async () => storedRequest },
        user: { create: async () => ({ id: "user-1" }) },
        partnerCustomerMapping: { create: async () => ({}) },
      }),
    };
    const controller = new PartnerIntegrationController(api as never, {} as never, { createWorkspace: async () => ({ id: "org-1" }) } as never);
    const body = { requestId: "req-1", product: "crm", email: "Owner@Example.com", name: "Owner", organization: "Acme", plan: "starter", validityDays: 30, externalCustomerRef: "cust-1", externalOrderRef: "order-1" };
    try {
      const response = await controller.provision("Bearer partner-api-secret", "once-1", body);
      assert.equal(response.status, "SUCCEEDED");
      assert.equal(response.username, "owner@example.com");
      assert.equal(response.password, "generated-secret");
      assert.equal(response.subscription.status, "ACTIVE");
      assert.equal(response.subscription.validUntil, expectedValidUntil);

      replay = true;
      const duplicate = await controller.provision("Bearer partner-api-secret", "once-1", body);
      assert.equal(duplicate.organization.id, "org-1");
      assert.equal(duplicate.password, "generated-secret");
    } finally {
      if (previousEncryptionKey === undefined) delete process.env.PARTNER_SECRET_ENCRYPTION_KEY;
      else process.env.PARTNER_SECRET_ENCRYPTION_KEY = previousEncryptionKey;
    }
  });

  it("rejects a different payload reusing an existing idempotency key", async () => {
    const previousEncryptionKey = process.env.PARTNER_SECRET_ENCRYPTION_KEY;
    process.env.PARTNER_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    const key = "partner-api-secret";
    const partner = { id: "partner-1", enabled: true, permissions: ["provision"] };
    const prisma = {
      partnerApiKey: { findUnique: async () => ({ id: "key-1", active: true, revokedAt: null, permissions: ["provision"], partner }), update: async () => ({}) },
      partnerApiUsageLog: { create: async () => ({}) },
      subscriptionPlan: { findFirst: async () => ({ code: "starter", isActive: true }) },
      provisioningRequest: { findFirst: async () => ({ requestId: "partner:partner-1:request", orderId: "partner:partner-1:order", idempotencyKey: "partner:partner-1:once", externalCustomerRef: "different", planCode: "starter", purchaseType: "paid" }) },
    };
    const controller = new PartnerIntegrationController(prisma as never, {} as never, {} as never);
    try {
      await assert.rejects(controller.provision(`Bearer ${key}`, "once", {
        requestId: "request", product: "crm", email: "owner@example.com", name: "Owner", organization: "Acme", plan: "starter", validityDays: 30, externalCustomerRef: "customer", externalOrderRef: "order",
      }), ConflictException);
    } finally {
      if (previousEncryptionKey === undefined) delete process.env.PARTNER_SECRET_ENCRYPTION_KEY;
      else process.env.PARTNER_SECRET_ENCRYPTION_KEY = previousEncryptionKey;
    }
  });

  it("rejects an invalid subscription webhook signature", async () => {
    const key = randomBytes(32); const previous = process.env.PARTNER_SECRET_ENCRYPTION_KEY;
    process.env.PARTNER_SECRET_ENCRYPTION_KEY = key.toString("hex");
    try {
      const secret = "partner-webhook-secret";
      const controller = new PartnerIntegrationController({ integrationPartner: { findFirst: async () => ({ id: "partner-1", webhookSecretEnc: encryptForTest(secret, key) }) } } as never, {} as never, {} as never);
      const timestamp = Math.floor(Date.now() / 1000).toString(); const body = { eventId: "evt-1", type: "subscription.activated", externalCustomerRef: "cust-1", externalSubscriptionRef: "sub-1", planCode: "starter" };
      const rawBody = Buffer.from(JSON.stringify(body));
      await assert.rejects(controller.webhook("partner-1", timestamp, "sha256=bad", { rawBody } as never, body), UnauthorizedException);
    } finally {
      if (previous === undefined) delete process.env.PARTNER_SECRET_ENCRYPTION_KEY;
      else process.env.PARTNER_SECRET_ENCRYPTION_KEY = previous;
    }
  });

  it("returns the prior outcome for a correctly signed duplicate webhook event", async () => {
    const key = randomBytes(32); const previous = process.env.PARTNER_SECRET_ENCRYPTION_KEY;
    process.env.PARTNER_SECRET_ENCRYPTION_KEY = key.toString("hex");
    try {
      const secret = "partner-webhook-secret"; const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = { eventId: "evt-repeat", type: "subscription.activated", externalCustomerRef: "cust-1", externalSubscriptionRef: "sub-1", planCode: "starter" };
      const rawBody = Buffer.from(JSON.stringify(body)); const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
      const controller = new PartnerIntegrationController({
        integrationPartner: { findFirst: async () => ({ id: "partner-1", webhookSecretEnc: encryptForTest(secret, key) }) },
        partnerWebhookEvent: { findUnique: async () => ({ outcome: "processed", payloadHash: digest(rawBody.toString("utf8")) }) },
      } as never, {} as never, {} as never);
      const result = await controller.webhook("partner-1", timestamp, `sha256=${signature}`, { rawBody } as never, body);
      assert.deepEqual(result, { received: true, duplicate: true, outcome: "processed" });
    } finally {
      if (previous === undefined) delete process.env.PARTNER_SECRET_ENCRYPTION_KEY;
      else process.env.PARTNER_SECRET_ENCRYPTION_KEY = previous;
    }
  });

  it("activates a mapped subscription only after a valid signed event", async () => {
    const key = randomBytes(32); const previous = process.env.PARTNER_SECRET_ENCRYPTION_KEY;
    process.env.PARTNER_SECRET_ENCRYPTION_KEY = key.toString("hex");
    try {
      const secret = "partner-webhook-secret"; const timestamp = Math.floor(Date.now() / 1000).toString();
      const periodEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const body = { eventId: "evt-activate", type: "subscription.activated", externalCustomerRef: "cust-1", externalSubscriptionRef: "sub-1", planCode: "starter", periodEndsAt };
      const rawBody = Buffer.from(JSON.stringify(body)); const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
      let organizationUpdate: Record<string, unknown> | undefined;
      const controller = new PartnerIntegrationController({
        integrationPartner: { findFirst: async () => ({ id: "partner-1", webhookSecretEnc: encryptForTest(secret, key) }) },
        partnerWebhookEvent: { findUnique: async () => null },
        partnerCustomerMapping: { findUnique: async () => ({ id: "mapping-1", externalSubscriptionRef: "sub-1", organizationId: "org-1", organization: { id: "org-1", subscriptionStartedAt: null } }) },
        organizationSubscriptionPlanOverride: { findUnique: async () => null },
        subscriptionPlan: { findFirst: async () => ({ code: "starter", modules: ["leads"], billingInterval: "monthly" }) },
        $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
          organization: { update: async ({ data }: { data: Record<string, unknown> }) => { organizationUpdate = data; } },
          partnerWebhookEvent: { create: async () => ({}) },
          partnerCustomerMapping: { update: async () => ({}) },
          platformAuditLog: { create: async () => ({}) },
        }),
      } as never, {} as never, {} as never);
      const result = await controller.webhook("partner-1", timestamp, `sha256=${signature}`, { rawBody } as never, body);
      assert.equal(result.subscriptionStatus, "active");
      assert.equal(organizationUpdate?.subscriptionStatus, "ACTIVE");
      assert.equal(new Date(organizationUpdate?.subscriptionEndsAt as Date).toISOString(), periodEndsAt);
      assert.deepEqual(organizationUpdate?.enabledModules, ["leads"]);
    } finally {
      if (previous === undefined) delete process.env.PARTNER_SECRET_ENCRYPTION_KEY;
      else process.env.PARTNER_SECRET_ENCRYPTION_KEY = previous;
    }
  });
});
