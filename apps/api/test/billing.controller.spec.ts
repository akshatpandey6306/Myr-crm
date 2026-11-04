import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { BillingController } from "../src/billing/billing.controller.js";

const originalTestMode = process.env.BILLING_TEST_MODE;

afterEach(() => {
  if (originalTestMode === undefined) delete process.env.BILLING_TEST_MODE;
  else process.env.BILLING_TEST_MODE = originalTestMode;
});

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

  it("starts a no-charge two-day test subscription exactly once", async () => {
    process.env.BILLING_TEST_MODE = "true";
    let updateArgs: Record<string, unknown> | undefined;
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", trialDays: 0 }) },
      organization: {
        updateMany: async (args: Record<string, unknown>) => {
          updateArgs = args;
          return { count: 1 };
        },
      },
    } as never);

    const result = await controller.startTestSubscription({
      userId: "user-a",
      headers: { "x-organization-id": "org-a" },
    } as never, { planCode: "growth" });

    assert.deepEqual(updateArgs?.where, { id: "org-a", subscriptionStatus: "PENDING" });
    assert.equal((updateArgs?.data as Record<string, unknown>).subscriptionPlan, "growth");
    assert.equal(result.data.status, "trial");
    assert.equal(result.data.provider, "test");
    assert.ok(result.data.endsAt > result.data.startsAt);
    assert.equal(
      new Date(result.data.endsAt).getTime() - new Date(result.data.startsAt).getTime(),
      2 * 24 * 60 * 60 * 1000,
    );
  });

  it("does not grant a test trial to a non-owner member", async () => {
    process.env.BILLING_TEST_MODE = "true";
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership("PENDING", "SALES_REP") },
      subscriptionPlan: { findFirst: async () => ({ code: "starter", trialDays: 0 }) },
    } as never);

    await assert.rejects(
      controller.startTestSubscription({ userId: "user-a", headers: {} } as never, { planCode: "starter" }),
      ForbiddenException,
    );
  });

  it("rejects duplicate test trial activation", async () => {
    process.env.BILLING_TEST_MODE = "true";
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findFirst: async () => ({ code: "starter", trialDays: 0 }) },
      organization: { updateMany: async () => ({ count: 0 }) },
    } as never);

    await assert.rejects(
      controller.startTestSubscription({ userId: "user-a", headers: {} } as never, { planCode: "starter" }),
      ConflictException,
    );
  });

  it("does not simulate payment when test mode is disabled", async () => {
    process.env.BILLING_TEST_MODE = "false";
    const controller = new BillingController({} as never);

    await assert.rejects(
      controller.startTestSubscription({ userId: "user-a", headers: {} } as never, { planCode: "starter" }),
      ServiceUnavailableException,
    );
  });
});
