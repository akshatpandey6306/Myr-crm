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
      subscriptionActivationRequest: { findFirst: async () => ({ id: "request-a", planCode: "growth", createdAt: requestedAt }) },
    } as never);

    const result = await controller.current({ userId: "user-a", headers: { "x-organization-id": "org-a" } } as never);

    assert.deepEqual(result.data.activationRequest, {
      id: "request-a",
      planCode: "growth",
      requestedAt: requestedAt.toISOString(),
    });
  });

  it("starts a no-charge two-day trial exactly once", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findFirst: async () => ({ code: "growth" }) },
      organization: {
        updateMany: async (args: Record<string, unknown>) => {
          updateArgs = args;
          return { count: 1 };
        },
      },
    } as never);

    const result = await controller.startFreeTrial({
      userId: "user-a",
      headers: { "x-organization-id": "org-a" },
    } as never, { planCode: "growth" });

    assert.deepEqual(updateArgs?.where, { id: "org-a", subscriptionStatus: "PENDING" });
    assert.equal((updateArgs?.data as Record<string, unknown>).subscriptionPlan, "growth");
    assert.equal(result.data.status, "trial");
    assert.equal(result.data.provider, "trial");
    assert.ok(result.data.endsAt > result.data.startsAt);
    assert.equal(
      new Date(result.data.endsAt).getTime() - new Date(result.data.startsAt).getTime(),
      2 * 24 * 60 * 60 * 1000,
    );
  });

  it("does not grant a trial to a non-owner member", async () => {
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership("PENDING", "SALES_REP") },
      subscriptionPlan: { findFirst: async () => ({ code: "starter" }) },
    } as never);

    await assert.rejects(
      controller.startFreeTrial({ userId: "user-a", headers: {} } as never, { planCode: "starter" }),
      ForbiddenException,
    );
  });

  it("rejects duplicate trial activation", async () => {
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findFirst: async () => ({ code: "starter" }) },
      organization: { updateMany: async () => ({ count: 0 }) },
    } as never);

    await assert.rejects(
      controller.startFreeTrial({ userId: "user-a", headers: {} } as never, { planCode: "starter" }),
      ConflictException,
    );
  });

  it("allows a free trial in production without requiring test billing mode", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findFirst: async () => ({ code: "starter" }) },
      organization: { updateMany: async () => ({ count: 1 }) },
    } as never);

    try {
      const result = await controller.startFreeTrial(
        { userId: "user-a", headers: {} } as never,
        { planCode: "starter" },
      );
      assert.equal(result.data.status, "trial");
      assert.equal(result.data.provider, "trial");
      assert.equal(new Date(result.data.endsAt).getTime() - new Date(result.data.startsAt).getTime(), 2 * 24 * 60 * 60 * 1000);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
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
          return { id: "request-a", planCode: "growth", createdAt: requestedAt };
        },
      },
    } as never);

    const result = await controller.requestActivation(
      { userId: "user-a", headers: { "x-organization-id": "org-a" } } as never,
      { planCode: "growth" },
    );

    assert.deepEqual(requestData, { organizationId: "org-a", requestedById: "user-a", planCode: "growth" });
    assert.equal(result.data.planCode, "growth");
    assert.equal(result.data.requestedAt, requestedAt.toISOString());
  });
});
