import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { BillingController } from "../src/billing/billing.controller.js";

function makeMembership(status = "PENDING", role = "OWNER") {
  return {
    role,
    organization: {
      id: "org-a",
      name: "Acme",
      status: "ACTIVE",
      subscriptionPlan: null,
      subscriptionStatus: status,
      subscriptionStartedAt: null,
      subscriptionEndsAt: null,
      billingProvider: null,
    },
  };
}

describe("BillingController", () => {
  it("returns selected workspace details, plans, and subscription status", async () => {
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findMany: async () => [
        { code: "starter", name: "Starter", price: 999, currency: "INR", billingInterval: "monthly", trialDays: 0, employeeLimit: 3, features: [] },
        { code: "growth", name: "Growth", price: 2499, currency: "INR", billingInterval: "monthly", trialDays: 0, employeeLimit: 10, features: [] },
        { code: "business", name: "Business", price: 4999, currency: "INR", billingInterval: "monthly", trialDays: 0, employeeLimit: 25, features: [] },
      ] },
      subscriptionActivationRequest: { findFirst: async () => null },
    } as never);

    const result = await controller.current({
      userId: "user-a",
      headers: { "x-organization-id": "org-a" },
    } as never);

    assert.equal(result.data.organization.id, "org-a");
    assert.equal(result.data.subscription.status, "pending");
    assert.equal(result.data.canManageBilling, true);
    assert.equal(result.data.organizationRole, "owner");
    assert.equal(result.data.plans.length, 3);
  });

  it("returns the activation request ID required by the subscription page", async () => {
    const requestedAt = new Date();
    const controller = new BillingController({
      membership: { findFirst: async () => ({
        ...makeMembership("EXPIRED"),
        organization: { ...makeMembership("EXPIRED").organization, subscriptionEndsAt: new Date(Date.now() - 60_000) },
      }) },
      subscriptionPlan: { findMany: async () => [] },
      subscriptionActivationRequest: { findFirst: async () => ({ id: "request-a", planCode: "growth", requestType: "TRIAL", createdAt: requestedAt }) },
    } as never);

    const result = await controller.current({ userId: "user-a", headers: { "x-organization-id": "org-a" } } as never);

    assert.deepEqual(result.data.activationRequest, {
      id: "request-a",
      planCode: "growth",
      requestType: "trial",
      requestedAt: requestedAt.toISOString(),
    });
  });

  it("does not grant any trial through the legacy unpaid endpoint", async () => {
    const controller = new BillingController({} as never);
    await assert.rejects(
      controller.startTrial({ userId: "user-a", headers: {} } as never, { planCode: "growth" }),
      ConflictException,
    );
  });

  it("creates a PayU trial order for exactly INR 49 regardless of client amount", async () => {
    let orderData: Record<string, unknown> | undefined;
    let checkoutInput: Record<string, unknown> | undefined;
    const membership = {
      ...makeMembership(),
      user: { name: "Maya Chen", email: "maya@example.com" },
    };
    const payu = {
      isConfigured: () => true,
      createCheckout: (input: Record<string, unknown>) => {
        checkoutInput = input;
        return { checkoutUrl: "https://test.payu.in/_payment", fields: { key: "test-key", hash: "signed" } };
      },
    };
    const controller = new BillingController({
      membership: { findFirst: async () => membership },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", name: "Growth", price: 2499, currency: "INR", billingInterval: "monthly" }) },
      subscriptionPayment: { create: async ({ data }: { data: Record<string, unknown> }) => { orderData = data; } },
    } as never, {} as never, payu as never);

    const result = await controller.createCheckout({
      userId: "user-a",
      orgId: "org-a",
      organizationRole: "owner",
      headers: { "x-organization-id": "org-a" },
    } as never, { planCode: "growth", purchaseType: "trial", phone: "+919876543210", amount: "1.00" } as never);

    assert.equal(orderData?.amount, "49.00");
    assert.equal(orderData?.paymentType, "TRIAL");
    assert.equal(orderData?.organizationId, "org-a");
    assert.equal(checkoutInput?.amount, "49.00");
    assert.equal(checkoutInput?.email, "maya@example.com");
    assert.equal(result.data.checkoutUrl, "https://test.payu.in/_payment");
  });

  it("uses INR 1 for a sandbox trial only when the explicit test override is set", async () => {
    const previousMode = process.env.PAYU_MODE;
    const previousTestAmount = process.env.PAYU_TEST_TRIAL_AMOUNT;
    process.env.PAYU_MODE = "test";
    process.env.PAYU_TEST_TRIAL_AMOUNT = "1.00";
    let orderData: Record<string, unknown> | undefined;
    let checkoutInput: Record<string, unknown> | undefined;
    const controller = new BillingController({
      membership: { findFirst: async () => ({
        ...makeMembership(),
        user: { name: "Maya Chen", email: "maya@example.com" },
      }) },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", name: "Growth", price: 2499, currency: "INR", billingInterval: "monthly" }) },
      subscriptionPayment: { create: async ({ data }: { data: Record<string, unknown> }) => { orderData = data; } },
    } as never, {} as never, {
      isConfigured: () => true,
      createCheckout: (input: Record<string, unknown>) => {
        checkoutInput = input;
        return { checkoutUrl: "https://test.payu.in/_payment", fields: { key: "test-key", hash: "signed" } };
      },
    } as never);

    try {
      await controller.createCheckout({ userId: "user-a", headers: { "x-organization-id": "org-a" } } as never,
        { planCode: "growth", purchaseType: "trial", phone: "+919876543210", amount: "0.01" } as never);
      assert.equal(orderData?.amount, "1.00");
      assert.equal(checkoutInput?.amount, "1.00");
    } finally {
      if (previousMode === undefined) delete process.env.PAYU_MODE;
      else process.env.PAYU_MODE = previousMode;
      if (previousTestAmount === undefined) delete process.env.PAYU_TEST_TRIAL_AMOUNT;
      else process.env.PAYU_TEST_TRIAL_AMOUNT = previousTestAmount;
    }
  });

  it("allows an active workspace to purchase a different plan through PayU", async () => {
    const membership = makeMembership("ACTIVE");
    membership.organization.subscriptionPlan = "starter";
    Object.assign(membership, { user: { name: "Maya Chen", email: "maya@example.com" } });
    let payment: Record<string, unknown> | undefined;
    const controller = new BillingController({
      membership: { findFirst: async () => membership },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", name: "Growth", price: 2499, currency: "INR", billingInterval: "monthly" }) },
      subscriptionPayment: { create: async ({ data }: { data: Record<string, unknown> }) => { payment = data; } },
    } as never, {} as never, {
      isConfigured: () => true,
      createCheckout: () => ({ checkoutUrl: "https://secure.payu.in/_payment", fields: { key: "live-key", hash: "signed" } }),
    } as never);

    await controller.createCheckout({ userId: "user-a", headers: { "x-organization-id": "org-a" } } as never,
      { planCode: "growth", purchaseType: "plan", phone: "+919876543210" } as never);

    assert.equal(payment?.paymentType, "PLAN");
    assert.equal(payment?.planCode, "growth");
    assert.equal(payment?.amount, "2499.00");
  });

  it("rechecks a pending payment only in the authenticated owner's workspace", async () => {
    let verifiedTransaction = "";
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership("ACTIVE") },
      subscriptionPayment: { findFirst: async ({ where }: { where: { organizationId: string; transactionId: string } }) => {
        assert.equal(where.organizationId, "org-a");
        return { id: "payment-a", organizationId: "org-a", requestedByUserId: "user-a", planCode: "growth", paymentType: "PLAN", transactionId: where.transactionId, amount: "2499.00", status: "PENDING", failureReason: null, renewalBaseEndsAt: null };
      } },
    } as never, {} as never, {
      verifyPayment: async (transactionId: string) => { verifiedTransaction = transactionId; return { status: "pending", transactionId: null, amount: null, payuId: null, bankReference: null }; },
    } as never);

    const result = await controller.paymentStatus({ userId: "user-a", headers: { "x-organization-id": "org-a" } } as never, "0123456789abcdef01234567");
    assert.equal(verifiedTransaction, "0123456789abcdef01234567");
    assert.equal(result.data.status, "pending");
    assert.equal(result.data.planCode, "growth");
  });

  it("creates an activation request for an expired workspace", async () => {
    let requestData: Record<string, unknown> | undefined;
    const requestedAt = new Date();
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership("TRIAL") },
      subscriptionPlan: { findFirst: async () => ({ code: "growth" }) },
      subscriptionActivationRequest: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          requestData = data;
          return { id: "request-a", planCode: "growth", requestType: "ACTIVATION", createdAt: requestedAt };
        },
      },
    } as never);

    const result = await controller.requestActivation(
      { userId: "user-a", headers: { "x-organization-id": "org-a" } } as never,
      { planCode: "growth" },
    );

    assert.deepEqual(requestData, { organizationId: "org-a", requestedById: "user-a", planCode: "growth", requestType: "ACTIVATION" });
    assert.equal(result.data.planCode, "growth");
    assert.equal(result.data.requestType, "activation");
    assert.equal(result.data.requestedAt, requestedAt.toISOString());
  });

  it("allows a paused workspace to request renewal more than ten days after expiry", async () => {
    let requestData: Record<string, unknown> | undefined;
    const requestedAt = new Date();
    const membership = makeMembership("PAUSED");
    membership.organization.subscriptionEndsAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const controller = new BillingController({
      membership: { findFirst: async () => membership },
      subscriptionPlan: { findFirst: async () => ({ code: "growth" }) },
      subscriptionActivationRequest: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          requestData = data;
          return { id: "request-paused", planCode: "growth", requestType: "ACTIVATION", createdAt: requestedAt };
        },
      },
    } as never);

    const result = await controller.requestActivation(
      { userId: "user-a", headers: { "x-organization-id": "org-a" } } as never,
      { planCode: "growth" },
    );

    assert.equal(requestData?.organizationId, "org-a");
    assert.equal(result.data.requestType, "activation");
  });

  it("allows an owner to request renewal during the final ten days", async () => {
    let requestData: Record<string, unknown> | undefined;
    const requestedAt = new Date();
    const membership = makeMembership("ACTIVE");
    membership.organization.subscriptionEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const controller = new BillingController({
      membership: { findFirst: async () => membership },
      subscriptionPlan: { findFirst: async () => ({ code: "growth" }) },
      subscriptionActivationRequest: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          requestData = data;
          return { id: "request-renewal", planCode: "growth", requestType: "ACTIVATION", createdAt: requestedAt };
        },
      },
    } as never);

    const result = await controller.requestActivation(
      { userId: "user-a", headers: { "x-organization-id": "org-a" } } as never,
      { planCode: "growth" },
    );

    assert.equal(requestData?.organizationId, "org-a");
    assert.equal(result.data.requestType, "activation");
  });

  it("does not allow renewal requests more than ten days before expiry", async () => {
    const membership = makeMembership("ACTIVE");
    membership.organization.subscriptionEndsAt = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
    const controller = new BillingController({
      membership: { findFirst: async () => membership },
      subscriptionPlan: { findFirst: async () => ({ code: "growth" }) },
    } as never);

    await assert.rejects(
      controller.requestActivation(
        { userId: "user-a", headers: { "x-organization-id": "org-a" } } as never,
        { planCode: "growth" },
      ),
      ConflictException,
    );
  });
});
