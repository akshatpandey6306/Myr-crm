import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ControlPanelController } from "../src/control-panel/control-panel.controller.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorRequest = { userId: "admin-a" } as never;

function createController(prisma: Record<string, unknown>, audit = { record: async () => undefined, list: async () => [] }) {
  return new ControlPanelController({
    user: { findUnique: async () => ({ email: "admin@example.com" }) },
    ...prisma,
  } as never, audit as never);
}

describe("ControlPanelController", () => {
  it("lists tenant owners, active member counts, subscriptions, and enabled modules", async () => {
    let invitationQuery: Record<string, unknown> | undefined;
    const controller = createController({
      organization: {
        findMany: async () => [{
          id: "org-a",
          name: "Acme",
          status: "ACTIVE",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          subscriptionPlan: "growth",
          subscriptionStatus: "TRIAL",
          subscriptionStartedAt: new Date("2027-01-01T00:00:00.000Z"),
          subscriptionEndsAt: new Date("2027-01-15T00:00:00.000Z"),
          billingProvider: "manual",
          enabledModules: ["leads", "team"],
          memberships: [{ user: { name: "Maya Chen", email: "maya@example.com" } }],
        }],
      },
      membership: {
        groupBy: async () => [{ organizationId: "org-a", _count: { _all: 2 } }],
      },
      organizationInvitation: {
        groupBy: async (args: Record<string, unknown>) => {
          invitationQuery = args;
          return [{ organizationId: "org-a", _count: { _all: 1 } }];
        },
      },
    });

    const result = await controller.listOrganizations();
    assert.equal(result.data[0]?.memberCount, 2);
    assert.equal(result.data[0]?.pendingInvitationCount, 1);
    const invitationWhere = invitationQuery?.where as { acceptedAt?: unknown; expiresAt?: { gt?: unknown } };
    assert.equal(invitationWhere.acceptedAt, null);
    assert.ok(invitationWhere.expiresAt?.gt instanceof Date);
    assert.deepEqual(result.data[0]?.enabledModules, ["leads", "team"]);
    assert.deepEqual(result.data[0]?.owner, { name: "Maya Chen", email: "maya@example.com" });
    assert.equal(result.data[0]?.subscription.status, "trial");
  });

  it("searches workspace administrators without returning their account details", async () => {
    let query: Record<string, unknown> | undefined;
    const controller = createController({
      membership: {
        findMany: async (args: Record<string, unknown>) => {
          query = args;
          return [{ organizationId: "org-a" }];
        },
      },
    });

    const result = await controller.searchOrganizationAdmins(" maya@example.com ");

    assert.deepEqual(result.data, ["org-a"]);
    assert.deepEqual(query?.distinct, ["organizationId"]);
    assert.deepEqual(query?.select, { organizationId: true });
    assert.equal(JSON.stringify(query?.where).includes("maya@example.com"), true);
  });

  it("rejects oversized administrator search terms", async () => {
    const controller = createController({});
    await assert.rejects(
      controller.searchOrganizationAdmins("x".repeat(255)),
      BadRequestException,
    );
  });

  it("rejects unknown plan codes when onboarding a tenant", async () => {
    const controller = createController({ subscriptionPlan: { findFirst: async () => null } });
    await assert.rejects(
      controller.createOrganization({
        organizationName: "Acme",
        ownerName: "Maya",
        ownerEmail: "maya@example.com",
        ownerPassword: "password123",
        planCode: "unknown",
      }, actorRequest),
      BadRequestException,
    );
  });

  it("creates and audits a persisted subscription plan", async () => {
    let created: Record<string, unknown> | undefined;
    let auditAction = "";
    const controller = createController({
      subscriptionPlan: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return data;
        },
      },
    }, { record: async ({ action }: { action: string }) => { auditAction = action; }, list: async () => [] });

    const response = await controller.createPlan({
      code: "team-yearly",
      name: "Team Yearly",
      price: 12000,
      currency: "INR",
      billingInterval: "yearly",
      trialDays: 14,
      features: ["Shared workspace"],
      employeeLimit: 20,
      usageLimits: { records: 10000 },
      isActive: true,
    }, actorRequest);

    assert.equal((created as Record<string, unknown>).billingInterval, "yearly");
    assert.equal((created as Record<string, unknown>).trialDays, 14);
    assert.equal(response.data.code, "team-yearly");
    assert.equal(auditAction, "plan.create");
  });

  it("rejects invalid plan usage limits", async () => {
    const controller = createController({});
    await assert.rejects(
      controller.createPlan({
        code: "bad-plan",
        name: "Bad Plan",
        price: 100,
        billingInterval: "monthly",
        usageLimits: { records: -1 },
      }, actorRequest),
      BadRequestException,
    );
  });

  it("translates duplicate plan codes to a conflict", async () => {
    const controller = createController({
      subscriptionPlan: { create: async () => { throw { code: "P2002" }; } },
    });
    await assert.rejects(
      controller.createPlan({ code: "starter", name: "Starter", price: 999 }, actorRequest),
      ConflictException,
    );
  });

  it("suspends and audits a tenant workspace", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    let auditAction = "";
    let auditReason = "";
    const controller = createController({
      organization: {
        update: async (args: Record<string, unknown>) => {
          updateArgs = args;
          return { id: organizationId, name: "Acme", status: "SUSPENDED" };
        },
      },
    }, {
      record: async ({ action, reason }: { action: string; reason?: string }) => {
        auditAction = action;
        auditReason = reason ?? "";
      },
      list: async () => [],
    });

    const result = await controller.updateOrganizationAccess(
      organizationId,
      { status: "suspended", reason: "Customer requested an access pause" },
      actorRequest,
    );
    assert.equal((updateArgs?.data as Record<string, unknown>).status, "SUSPENDED");
    assert.equal(result.data.status, "suspended");
    assert.equal(auditAction, "organization.suspend");
    assert.equal(auditReason, "Customer requested an access pause");
  });

  it("validates organization IDs and access status", async () => {
    const controller = createController({});
    await assert.rejects(controller.updateOrganizationAccess("invalid", { status: "suspended" }, actorRequest), BadRequestException);
    await assert.rejects(controller.updateOrganizationAccess(organizationId, { status: "paid" }, actorRequest), BadRequestException);
  });

  it("extends a manual subscription by the selected plan billing interval", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    let auditReason = "";
    const now = new Date();
    const currentEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const controller = createController({
      subscriptionPlan: {
        findFirst: async () => ({ code: "growth", billingInterval: "monthly" }),
      },
      organization: {
        findUnique: async () => ({ subscriptionPlan: "growth", subscriptionStartedAt: now, subscriptionEndsAt: currentEnd }),
        update: async (args: Record<string, unknown>) => {
          updateArgs = args;
          const data = args.data as Record<string, unknown>;
          return {
            id: organizationId,
            subscriptionPlan: data.subscriptionPlan,
            subscriptionStatus: data.subscriptionStatus,
            subscriptionStartedAt: data.subscriptionStartedAt,
            subscriptionEndsAt: data.subscriptionEndsAt,
            billingProvider: data.billingProvider,
          };
        },
      },
    }, {
      record: async ({ reason }: { reason?: string }) => { auditReason = reason ?? ""; },
      list: async () => [],
    });

    const result = await controller.updateOrganizationSubscription(
      organizationId,
      { status: "active", planCode: "growth", extend: true, reason: "Approved renewal" },
      actorRequest,
    );
    const data = updateArgs?.data as Record<string, unknown>;
    const expectedEnd = new Date(currentEnd);
    expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
    assert.equal(result.data.status, "active");
    assert.equal(result.data.provider, "manual");
    assert.equal(auditReason, "Approved renewal");
    assert.equal(new Date(data.subscriptionEndsAt as Date).getTime(), expectedEnd.getTime());
  });

  it("rejects activating a subscription with an unavailable plan", async () => {
    const controller = createController({
      subscriptionPlan: { findFirst: async () => null },
    });
    await assert.rejects(
      controller.updateOrganizationSubscription(
        organizationId,
        { status: "active", planCode: "unknown", reason: "Plan is unavailable" },
        actorRequest,
      ),
      BadRequestException,
    );
  });

  it("rejects expired end dates for manual activation", async () => {
    const controller = createController({
      subscriptionPlan: { findFirst: async () => ({ code: "growth", billingInterval: "monthly" }) },
      organization: { findUnique: async () => ({ subscriptionPlan: null, subscriptionStartedAt: null, subscriptionEndsAt: null }) },
    });
    await assert.rejects(
      controller.updateOrganizationSubscription(
        organizationId,
        { status: "active", planCode: "growth", endsAt: "2020-01-01T00:00:00.000Z", reason: "Correct billing period" },
        actorRequest,
      ),
      BadRequestException,
    );
  });

  it("persists and audits tenant module permissions", async () => {
    let updatedModules: string[] | undefined;
    let auditAction = "";
    let auditReason = "";
    const controller = createController({
      organization: {
        findUnique: async () => ({ enabledModules: ["leads", "team"] }),
        update: async ({ data }: { data: { enabledModules: string[] } }) => {
          updatedModules = data.enabledModules;
          return { id: organizationId, enabledModules: data.enabledModules };
        },
      },
    }, {
      record: async ({ action, reason }: { action: string; reason?: string }) => {
        auditAction = action;
        auditReason = reason ?? "";
      },
      list: async () => [],
    });

    const result = await controller.updateOrganizationModules(
      organizationId,
      { modules: ["leads", "deals", "leads"], reason: "Enable the sales team workflow" },
      actorRequest,
    );
    assert.deepEqual(updatedModules, ["leads", "deals"]);
    assert.deepEqual(result.data.enabledModules, ["leads", "deals"]);
    assert.equal(auditAction, "organization.modules.update");
    assert.equal(auditReason, "Enable the sales team workflow");
  });

  it("requires a non-empty reason for sensitive tenant changes", async () => {
    const controller = createController({});
    await assert.rejects(
      controller.updateOrganizationAccess(organizationId, { status: "suspended", reason: "  " }, actorRequest),
      BadRequestException,
    );
    await assert.rejects(
      controller.updateOrganizationSubscription(organizationId, { status: "expired" }, actorRequest),
      BadRequestException,
    );
    await assert.rejects(
      controller.updateOrganizationModules(organizationId, { modules: ["leads"] }, actorRequest),
      BadRequestException,
    );
    await assert.rejects(
      controller.updateOrganizationAccess(organizationId, { status: "active", reason: "x".repeat(501) }, actorRequest),
      BadRequestException,
    );
  });

  it("returns not found when tenant access target does not exist", async () => {
    const controller = createController({
      organization: { update: async () => { throw { code: "P2025" }; } },
    });
    await assert.rejects(
      controller.updateOrganizationAccess(organizationId, { status: "active", reason: "Restore service" }, actorRequest),
      NotFoundException,
    );
  });
});
