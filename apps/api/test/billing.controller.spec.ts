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

  it("starts a two-day trial immediately without creating an approval request", async () => {
    let organizationUpdate: Record<string, unknown> | undefined;
    let pendingRequestUpdate: Record<string, unknown> | undefined;
    const transaction = {
      organization: {
        updateMany: async (args: Record<string, unknown>) => {
          organizationUpdate = args;
          return { count: 1 };
        },
      },
      subscriptionActivationRequest: {
        updateMany: async (args: Record<string, unknown>) => {
          pendingRequestUpdate = args;
          return { count: 0 };
        },
      },
    };
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findFirst: async () => ({ code: "growth" }) },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never);

    const result = await controller.startTrial({
      userId: "user-a",
      headers: { "x-organization-id": "org-a" },
    } as never, { planCode: "growth" });

    const updateData = organizationUpdate?.data as Record<string, unknown>;
    assert.deepEqual(organizationUpdate?.where, { id: "org-a", subscriptionStatus: "PENDING" });
    assert.equal(updateData.subscriptionPlan, "growth");
    assert.equal(updateData.subscriptionStatus, "TRIAL");
    assert.equal(updateData.billingProvider, "trial");
    assert.deepEqual(updateData.enabledModules, ["leads", "contacts", "companies", "deals", "activities", "team", "settings"]);
    assert.equal(
      new Date(updateData.subscriptionEndsAt as Date).getTime() -
        new Date(updateData.subscriptionStartedAt as Date).getTime(),
      2 * 24 * 60 * 60 * 1000,
    );
    assert.deepEqual(pendingRequestUpdate?.where, { organizationId: "org-a", requestType: "TRIAL", status: "PENDING" });
    assert.deepEqual(pendingRequestUpdate?.data, { status: "ACTIVATED" });
    assert.equal(result.data.planCode, "growth");
    assert.equal(result.data.status, "trial");
  });

  it("does not grant a trial to a non-owner member", async () => {
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership("PENDING", "SALES_REP") },
      subscriptionPlan: { findFirst: async () => ({ code: "starter" }) },
    } as never);

    await assert.rejects(
      controller.startTrial({ userId: "user-a", headers: {} } as never, { planCode: "starter" }),
      ForbiddenException,
    );
  });

  it("does not start a second trial after the workspace leaves pending status", async () => {
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership("TRIAL") },
      subscriptionPlan: { findFirst: async () => ({ code: "starter" }) },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
        organization: { updateMany: async () => ({ count: 0 }) },
        subscriptionActivationRequest: { updateMany: async () => ({ count: 0 }) },
      }),
    } as never);

    await assert.rejects(
      controller.startTrial({ userId: "user-a", headers: {} } as never, { planCode: "starter" }),
      ConflictException,
    );
  });

  it("consumes a legacy pending trial request when starting the trial", async () => {
    let updatedRequest = false;
    const transaction = {
      organization: { updateMany: async () => ({ count: 1 }) },
      subscriptionActivationRequest: {
        updateMany: async () => { updatedRequest = true; return { count: 1 }; },
      },
    };
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findFirst: async () => ({ code: "starter" }) },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never);

    const result = await controller.startTrial(
      { userId: "user-a", headers: {} } as never,
      { planCode: "starter" },
    );
    assert.equal(updatedRequest, true);
    assert.equal(result.data.status, "trial");
  });

  it("allows starting a trial in production without requiring test billing mode", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const controller = new BillingController({
      membership: { findFirst: async () => makeMembership() },
      subscriptionPlan: { findFirst: async () => ({ code: "starter" }) },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
        organization: { updateMany: async () => ({ count: 1 }) },
        subscriptionActivationRequest: { updateMany: async () => ({ count: 0 }) },
      }),
    } as never);

    try {
      const result = await controller.startTrial(
        { userId: "user-a", headers: {} } as never,
        { planCode: "starter" },
      );
      assert.equal(result.data.status, "trial");
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
});
