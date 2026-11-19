import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
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
  it("calculates a workspace seat add-on from server plan pricing and scopes its purchase ledger", async () => {
    let checkoutData: Record<string, unknown> | undefined;
    let paymentData: Record<string, unknown> | undefined;
    let addonQuery: Record<string, unknown> | undefined;
    const org = {
      ...makeMembership("ACTIVE"),
      organization: { ...makeMembership("ACTIVE").organization, subscriptionPlan: "growth", subscriptionEndsAt: new Date(Date.now() + 86_400_000) },
      user: { name: "Workspace owner", email: "owner@example.test" },
    };
    const controller = new BillingController({
      membership: { findFirst: async () => org },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", name: "Growth", price: 2499, currency: "INR", billingInterval: 30, additionalSeatsEnabled: true, additionalSeatPrice: 100 }) },
      additionalSeatPurchase: { findMany: async (query: Record<string, unknown>) => { addonQuery = query; return []; } },
      subscriptionPayment: { create: async ({ data }: { data: Record<string, unknown> }) => { paymentData = data; } },
    } as never, {
      isConfigured: () => true,
      createCheckout: (input: Record<string, unknown>) => { checkoutData = input; return { checkoutUrl: "https://test.payu.in/_payment", fields: { key: "server-key" } }; },
    } as never);

    await controller.createCheckout({ userId: "owner-a", headers: { "x-organization-id": "org-a" } } as never,
      { planCode: "growth", purchaseType: "seats", seatQuantity: 3, phone: "+919876543210", amount: "1" } as never);

    assert.equal(paymentData?.organizationId, "org-a");
    assert.equal(paymentData?.paymentType, "SEAT_ADDON");
    assert.equal(paymentData?.seatQuantity, 3);
    assert.equal(paymentData?.seatUnitPrice, 100);
    assert.equal(paymentData?.seatAmount, "300.00");
    assert.equal(paymentData?.amount, "300.00");
    assert.equal(checkoutData?.amount, "300.00");
    assert.deepEqual((addonQuery?.where as Record<string, unknown>).organizationId, "org-a");
  });

  it("grants additional seats only on a verified activation and is idempotent on payment replay", async () => {
    let paymentStatus = "PENDING";
    let purchaseCreates = 0;
    let purchaseData: Record<string, unknown> | undefined;
    const payment = { id: "pay-a", organizationId: "org-a", requestedByUserId: "owner-a", planCode: "growth", paymentType: "SEAT_ADDON", seatQuantity: 2, seatUnitPrice: 150, renewalBaseEndsAt: null, createdAt: new Date() };
    const transaction = {
      subscriptionPayment: {
        findUnique: async () => ({ ...payment, status: paymentStatus, failureReason: null }),
        update: async ({ data }: { data: Record<string, unknown> }) => { paymentStatus = data.status as string; },
      },
      organization: { findUnique: async () => ({ id: "org-a", status: "ACTIVE", subscriptionStatus: "ACTIVE", subscriptionPlan: "growth", subscriptionStartedAt: new Date(), subscriptionEndsAt: new Date(Date.now() + 15 * 86_400_000) }) },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", billingInterval: 30, modules: ["leads", "team"] }) },
      additionalSeatPurchase: { create: async ({ data }: { data: Record<string, unknown> }) => { purchaseCreates += 1; purchaseData = data; } },
      subscriptionActivationRequest: { updateMany: async () => ({ count: 0 }) },
    };
    const controller = new BillingController({ $transaction: async (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction) } as never);
    const activate = (controller as unknown as { activateVerifiedPayment: (paymentData: typeof payment, verification: { status: "success"; transactionId: string; amount: string; payuId: string; bankReference: string | null }) => Promise<{ result: string; activated: boolean }> }).activateVerifiedPayment.bind(controller);
    const verification = { status: "success" as const, transactionId: "txn-a", amount: "300.00", payuId: "payu-a", bankReference: null };

    const first = await activate(payment, verification);
    const replay = await activate(payment, verification);

    assert.deepEqual(first, { result: "success", activated: true });
    assert.deepEqual(replay, { result: "success", activated: false });
    assert.equal(purchaseCreates, 1);
    assert.equal(purchaseData?.organizationId, "org-a");
    assert.equal(purchaseData?.quantity, 2);
    assert.equal(purchaseData?.unitPrice, 150);
  });

  it("returns selected workspace details, plans, and subscription status", async () => {
    const controller = new BillingController({
      subscriptionPlan: { findMany: async () => [
        { code: "starter", name: "Starter", price: 999, currency: "INR", billingInterval: 30, employeeLimit: 3, features: [], modules: [], additionalSeatsEnabled: false, additionalSeatPrice: 0 },
        { code: "growth", name: "Growth", price: 2499, currency: "INR", billingInterval: 30, employeeLimit: 10, features: [], modules: [], additionalSeatsEnabled: false, additionalSeatPrice: 0 },
        { code: "business", name: "Business", price: 4999, currency: "INR", billingInterval: 30, employeeLimit: 25, features: [], modules: [], additionalSeatsEnabled: false, additionalSeatPrice: 0 },
      ] },
      additionalSeatPurchase: { findMany: async () => [] },
      membership: { findFirst: async () => makeMembership(), count: async () => 1 },
      subscriptionActivationRequest: { findFirst: async () => null },
    } as never, { isConfigured: () => false } as never);

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
      subscriptionPlan: { findMany: async () => [] },
      additionalSeatPurchase: { findMany: async () => [] },
      membership: { findFirst: async () => ({ ...makeMembership("EXPIRED"), userId: "user-a" }), count: async () => 1 },
      subscriptionActivationRequest: { findFirst: async () => ({ id: "request-a", planCode: "growth", requestType: "TRIAL", createdAt: requestedAt }) },
    } as never, { isConfigured: () => false } as never);

    const result = await controller.current({ userId: "user-a", headers: { "x-organization-id": "org-a" } } as never);

    assert.deepEqual(result.data.activationRequest, {
      id: "request-a",
      planCode: "growth",
      requestType: "trial",
      requestedAt: requestedAt.toISOString(),
    });
  });

  it("rejects trial checkouts even when legacy sandbox trial overrides are set", async () => {
    const previousMode = process.env.PAYU_MODE;
    const previousTestAmount = process.env.PAYU_TEST_TRIAL_AMOUNT;
    process.env.PAYU_MODE = "test";
    process.env.PAYU_TEST_TRIAL_AMOUNT = "1.00";
    const controller = new BillingController({} as never, { isConfigured: () => true } as never);

    try {
      await assert.rejects(
        controller.createCheckout({ userId: "user-a", headers: {} } as never, { planCode: "growth", purchaseType: "trial" } as never),
        BadRequestException,
      );
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
    } as never, {
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
    } as never, {
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
