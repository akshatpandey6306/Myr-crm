import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ControlPanelController } from "../src/control-panel/control-panel.controller.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorRequest = { userId: "admin-a" } as never;

function createController(prisma: Record<string, unknown>, audit = { record: async () => undefined, list: async () => [] }, authEmail = { isConfigured: () => false, sendWorkspaceWelcome: async () => undefined }) {
  return new ControlPanelController({
    user: { findUnique: async () => ({ email: "admin@example.com" }) },
    subscriptionActivationRequest: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    deal: { groupBy: async () => [], findMany: async () => [], count: async () => 0 },
    ...prisma,
  } as never, audit as never, { load: async () => ({}) } as never, authEmail as never);
}

describe("ControlPanelController", () => {
  it("extends an existing trial from its current expiry and audits the change", async () => {
    const startedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    let updateData: Record<string, unknown> | undefined;
    const controller = createController({
      subscriptionPlan: { findFirst: async () => ({ code: "growth", billingInterval: "monthly", modules: ["leads"] }) },
      organizationSubscriptionPlanOverride: { findUnique: async () => null },
      organization: {
        findUnique: async () => ({ subscriptionPlan: "growth", subscriptionStartedAt: startedAt, subscriptionEndsAt: expiresAt }),
        update: async ({ data }: { data: Record<string, unknown> }) => { updateData = data; return { id: organizationId, subscriptionStatus: "TRIAL", subscriptionPlan: "growth", subscriptionStartedAt: data.subscriptionStartedAt, subscriptionEndsAt: data.subscriptionEndsAt, billingProvider: "manual" }; },
      },
    });

    const result = await controller.updateOrganizationSubscription(organizationId, { status: "trial", planCode: "growth", trialDays: 2, reason: "Approved 48-hour extension" }, actorRequest);
    assert.equal(result.data.status, "trial");
    assert.equal((updateData?.subscriptionEndsAt as Date).getTime(), expiresAt.getTime() + 48 * 60 * 60 * 1000);
    assert.deepEqual(updateData?.enabledModules, ["leads"]);
  });

  it("lists tenant owners, active member counts, subscriptions, and enabled modules", async () => {
    let pendingRequestQuery: Record<string, unknown> | undefined;
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
          settings: { currency: "INR" },
          memberships: [{ user: { name: "Maya Chen", email: "maya@example.com" } }],
        }],
      },
      membership: {
        groupBy: async (args: Record<string, unknown>) => {
          if ((args.where as { status?: string }).status === "PENDING") {
            pendingRequestQuery = args;
            return [{ organizationId: "org-a", _count: { _all: 1 } }];
          }
          return [{ organizationId: "org-a", _count: { _all: 2 } }];
        },
      },
      deal: {
        groupBy: async () => [
          { organizationId: "org-a", status: "OPEN", _count: { _all: 2 }, _sum: { value: 1500 } },
          { organizationId: "org-a", status: "WON", _count: { _all: 1 }, _sum: { value: 500 } },
        ],
      },
    });

    const result = await controller.listOrganizations();
    assert.equal(result.data[0]?.memberCount, 2);
    assert.equal(result.data[0]?.pendingMemberRequestCount, 1);
    assert.equal(result.data[0]?.dealCount, 3);
    assert.equal(result.data[0]?.openPipelineValue, 1500);
    assert.equal(result.data[0]?.wonRevenue, 500);
    assert.equal(result.data[0]?.currency, "INR");
    assert.deepEqual(pendingRequestQuery?.where, { status: "PENDING", user: { status: "ACTIVE" } });
    assert.deepEqual(result.data[0]?.enabledModules, ["leads", "team"]);
    assert.deepEqual(result.data[0]?.owner, { name: "Maya Chen", email: "maya@example.com" });
    assert.equal(result.data[0]?.subscription.status, "trial");
  });

  it("exports filtered platform audit entries with sensitive metadata redacted", async () => {
    let where: Record<string, unknown> | undefined;
    let recordedAudit: Record<string, unknown> | undefined;
    const auditLog = {
      id: "log-a",
      actorUserId: "admin-a",
      actorEmail: null,
      action: "organization.create",
      targetType: "organization",
      targetId: organizationId,
      reason: "password=do-not-export",
      metadata: {
        workspaceName: "Acme",
        password: "do-not-export",
        nested: { sessionToken: "do-not-export", modules: ["leads"] },
      },
      createdAt: new Date("2026-11-12T10:00:00.000Z"),
    };
    const controller = createController({
      platformAuditLog: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 1; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return [auditLog]; },
      },
      user: {
        findUnique: async () => ({ email: "admin@example.com" }),
        findMany: async () => [{ id: "admin-a", name: "Platform Admin", email: "admin@example.com" }],
      },
    }, {
      record: async (value: Record<string, unknown>) => { recordedAudit = value; },
      list: async () => [],
    });

    const result = await controller.exportAuditLogs(actorRequest, "organization.create");

    assert.deepEqual(where, { action: "organization.create" });
    assert.equal(result.data[0]?.actorName, "Platform Admin");
    assert.deepEqual(result.data[0]?.details, {
      workspaceName: "Acme",
      nested: { modules: ["leads"] },
    });
    assert.equal(result.data[0]?.reason, "password=[redacted]");
    assert.equal(JSON.stringify(result).includes("do-not-export"), false);
    assert.equal(recordedAudit?.action, "audit_log.export");
  });

  it("lists pending trial and activation requests for platform review", async () => {
    const controller = createController({
      subscriptionActivationRequest: {
        findMany: async () => [{
          id: "request-a",
          planCode: "growth",
          requestType: "TRIAL",
          createdAt: new Date("2026-11-05T12:00:00.000Z"),
          organization: { id: organizationId, name: "Acme", subscriptionPlan: null, subscriptionStatus: "PENDING", subscriptionEndsAt: null },
          requestedBy: { name: "Maya Chen", email: "maya@example.com" },
        }],
      },
    });

    const result = await controller.listSubscriptionActivationRequests();

    assert.equal(result.data[0]?.organization.name, "Acme");
    assert.equal(result.data[0]?.requestedBy.email, "maya@example.com");
    assert.equal(result.data[0]?.requestType, "trial");
    assert.equal(result.data[0]?.requestedAt, "2026-11-05T12:00:00.000Z");
  });

  it("hides stale activation requests for workspaces with an active plan outside the renewal window", async () => {
    const createdAt = new Date();
    const requests = [
      { id: "stale", planCode: "growth", requestType: "ACTIVATION", createdAt, organization: { id: organizationId, name: "Already active", subscriptionPlan: "starter", subscriptionStatus: "ACTIVE", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, requestedBy: { name: "Maya", email: "maya@example.com" } },
      { id: "renewal", planCode: "growth", requestType: "ACTIVATION", createdAt, organization: { id: organizationId, name: "Renewing", subscriptionPlan: "growth", subscriptionStatus: "ACTIVE", subscriptionEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }, requestedBy: { name: "Maya", email: "maya@example.com" } },
    ];
    const controller = createController({ subscriptionActivationRequest: { findMany: async () => requests } });

    const result = await controller.listSubscriptionActivationRequests();

    assert.deepEqual(result.data.map(({ id }) => id), ["renewal"]);
  });

  it("starts a two-day limited trial only after platform approval", async () => {
    let organizationUpdate: Record<string, unknown> | undefined;
    let requestUpdate: Record<string, unknown> | undefined;
    const transaction = {
      organization: {
        findUnique: async () => ({ subscriptionStatus: "PENDING", subscriptionEndsAt: null }),
        update: async (args: Record<string, unknown>) => { organizationUpdate = args; },
      },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", billingInterval: "monthly", modules: ["leads", "email"] }) },
      subscriptionActivationRequest: {
        updateMany: async (args: Record<string, unknown>) => { requestUpdate = args; return { count: 1 }; },
      },
    };
    const controller = createController({
      subscriptionActivationRequest: {
        findFirst: async () => ({
          id: "request-a",
          organizationId,
          planCode: "growth",
          requestType: "TRIAL",
        }),
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    });

    const result = await controller.reviewSubscriptionRequest(
      "22222222-2222-4222-8222-222222222222",
      { decision: "approve" },
      actorRequest,
    );
    const updatedOrganization = organizationUpdate?.data as Record<string, unknown>;
    assert.equal(updatedOrganization.subscriptionStatus, "TRIAL");
    assert.equal(updatedOrganization.billingProvider, "trial");
    assert.deepEqual(updatedOrganization.enabledModules, ["leads", "email"]);
    assert.equal(
      new Date(updatedOrganization.subscriptionEndsAt as Date).getTime() -
        new Date(updatedOrganization.subscriptionStartedAt as Date).getTime(),
      2 * 24 * 60 * 60 * 1000,
    );
    assert.deepEqual(requestUpdate?.where, { id: "22222222-2222-4222-8222-222222222222", status: "PENDING" });
    assert.deepEqual(requestUpdate?.data, { status: "ACTIVATED" });
    assert.equal(result.data.requestType, "trial");
  });

  it("extends an approved renewal from the current expiry date", async () => {
    let organizationUpdate: Record<string, unknown> | undefined;
    const currentEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const transaction = {
      organization: {
        findUnique: async () => ({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: currentEnd }),
        update: async (args: Record<string, unknown>) => { organizationUpdate = args; },
      },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", billingInterval: "monthly", modules: ["leads"] }) },
      subscriptionActivationRequest: { updateMany: async () => ({ count: 1 }) },
    };
    const controller = createController({
      subscriptionActivationRequest: {
        findFirst: async () => ({
          id: "request-renewal",
          organizationId,
          planCode: "growth",
          requestType: "ACTIVATION",
        }),
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    });

    const result = await controller.reviewSubscriptionRequest(
      "22222222-2222-4222-8222-222222222222",
      { decision: "approve" },
      actorRequest,
    );

    const updateData = organizationUpdate?.data as Record<string, unknown>;
    assert.equal(updateData.subscriptionStatus, "ACTIVE");
    assert.equal(updateData.subscriptionStartedAt, undefined);
    assert.equal(new Date(updateData.subscriptionEndsAt as Date).getTime() > currentEnd.getTime(), true);
    assert.equal(result.data.requestType, "activation");
  });

  it("clears a stale activation request when the workspace is already active on that plan", async () => {
    let organizationUpdated = false;
    let requestUpdate: Record<string, unknown> | undefined;
    const transaction = {
      organization: {
        findUnique: async () => ({
          subscriptionPlan: "growth",
          subscriptionStatus: "ACTIVE",
          subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
        update: async () => { organizationUpdated = true; },
      },
      subscriptionPlan: { findFirst: async () => ({ code: "growth", billingInterval: "monthly", modules: ["leads"] }) },
      subscriptionActivationRequest: {
        updateMany: async (args: Record<string, unknown>) => { requestUpdate = args; return { count: 1 }; },
      },
    };
    const controller = createController({
      subscriptionActivationRequest: {
        findFirst: async () => ({ id: "request-stale", organizationId, planCode: "growth", requestType: "ACTIVATION" }),
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    });

    const result = await controller.reviewSubscriptionRequest(
      "22222222-2222-4222-8222-222222222222",
      { decision: "approve" },
      actorRequest,
    );

    assert.equal(result.data.alreadyActive, true);
    assert.equal(organizationUpdated, false);
    assert.deepEqual(requestUpdate?.data, { status: "ACTIVATED" });
  });

  it("lists tenant deals with owner and pipeline details using the requested workspace scope", async () => {
    let dealQuery: Record<string, unknown> | undefined;
    let countQuery: Record<string, unknown> | undefined;
    const controller = createController({
      organization: { findUnique: async () => ({ id: organizationId }) },
      deal: {
        findMany: async (args: Record<string, unknown>) => {
          dealQuery = args;
          return [{
            id: "deal-a",
            name: "Annual contract",
            value: 1250,
            status: "WON",
            closeDate: new Date("2026-11-05T00:00:00.000Z"),
            company: { name: "Acme" },
            pipeline: { name: "Sales" },
            stage: { name: "Closed won" },
            owner: { user: { name: "Maya Chen", email: "maya@example.com" } },
          }];
        },
        count: async (args: Record<string, unknown>) => {
          countQuery = args;
          return 31;
        },
      },
    });

    const result = await controller.listOrganizationDeals(organizationId, "2", "10");

    assert.deepEqual(dealQuery?.where, { organizationId, archivedAt: null });
    assert.equal(dealQuery?.skip, 10);
    assert.equal(dealQuery?.take, 10);
    assert.deepEqual(countQuery?.where, { organizationId, archivedAt: null });
    assert.equal(result.data[0]?.owner.email, "maya@example.com");
    assert.equal(result.data[0]?.value, 1250);
    assert.equal(result.meta.total, 31);
    assert.equal(result.meta.totalPages, 4);
  });

  it("lists pending workspace signups for platform-admin approval", async () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    const controller = createController({
      membership: {
        findMany: async (args: Record<string, unknown>) => {
          assert.deepEqual(args.where, {
            role: "OWNER",
            status: "PENDING",
            user: {
              status: "PENDING",
              emailTokens: { none: { purpose: "EMAIL_VERIFICATION", consumedAt: null } },
            },
          });
          return [{
            userId,
            createdAt: new Date("2026-11-06T12:00:00.000Z"),
            user: { name: "Maya Chen", email: "maya@example.com" },
            organization: { id: organizationId, name: "Acme" },
          }];
        },
      },
    });

    const result = await controller.listWorkspaceSignupRequests();
    assert.equal(result.data[0]?.user.email, "maya@example.com");
    assert.equal(result.data[0]?.organization.name, "Acme");
    assert.equal(result.data[0]?.requestedAt, "2026-11-06T12:00:00.000Z");
  });

  it("approves a pending workspace signup transactionally", async () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    const updates: Array<[string, Record<string, unknown>]> = [];
    const transaction = {
      user: { updateMany: async (args: Record<string, unknown>) => { updates.push(["user", args]); return { count: 1 }; } },
      membership: { updateMany: async (args: Record<string, unknown>) => { updates.push(["membership", args]); return { count: 1 }; } },
      organization: { updateMany: async (args: Record<string, unknown>) => { updates.push(["organization", args]); return { count: 1 }; } },
      session: { updateMany: async (args: Record<string, unknown>) => { updates.push(["session", args]); return { count: 0 }; } },
    };
    const controller = createController({
      membership: {
        findFirst: async (args: Record<string, unknown>) => {
          assert.deepEqual(args.where, {
            userId,
            role: "OWNER",
            status: "PENDING",
            user: {
              status: "PENDING",
              emailTokens: { none: { purpose: "EMAIL_VERIFICATION", consumedAt: null } },
            },
          });
          return { organizationId, userId };
        },
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    });

    const result = await controller.reviewWorkspaceSignup(userId, { decision: "approve" }, actorRequest);
    assert.deepEqual(updates, [
      ["user", { where: { id: userId, status: "PENDING" }, data: { status: "ACTIVE" } }],
      ["membership", { where: { organizationId, userId, role: "OWNER", status: "PENDING" }, data: { status: "ACTIVE" } }],
    ]);
    assert.equal(result.data.decision, "approve");
  });

  it("does not let platform admins approve a signup that is waiting for its OTP", async () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    const controller = createController({
      membership: {
        findFirst: async (args: Record<string, unknown>) => {
          assert.deepEqual(args.where, {
            userId,
            role: "OWNER",
            status: "PENDING",
            user: {
              status: "PENDING",
              emailTokens: { none: { purpose: "EMAIL_VERIFICATION", consumedAt: null } },
            },
          });
          return null;
        },
      },
    });

    await assert.rejects(
      controller.reviewWorkspaceSignup(userId, { decision: "approve" }, actorRequest),
      NotFoundException,
    );
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

  it("emails the new workspace owner their onboarding credentials and sign-in link", async () => {
    let welcome: Record<string, unknown> | undefined;
    const controller = createController({
      user: {
        findUnique: async ({ where }: { where: { email?: string; id?: string } }) => where.email
          ? null
          : { email: "admin@example.com" },
      },
      $transaction: async (work: (tx: Record<string, unknown>) => Promise<unknown>) => work({
        user: { create: async () => ({ id: "owner-a" }) },
        organization: { create: async ({ data }: { data: { name: string } }) => ({ id: organizationId, name: data.name }) },
      }),
    }, undefined, {
      isConfigured: () => true,
      sendWorkspaceWelcome: async (input: Record<string, unknown>) => { welcome = input; },
    });

    const result = await controller.createOrganization({
      organizationName: "Acme Workspace",
      ownerName: "Maya Chen",
      ownerEmail: "Maya@example.com",
      ownerPassword: "initial-pass-123",
    }, actorRequest);

    assert.equal(result.data.welcomeEmailSent, true);
    assert.deepEqual(welcome && { to: welcome.to, ownerName: welcome.ownerName, organizationName: welcome.organizationName }, {
      to: "maya@example.com", ownerName: "Maya Chen", organizationName: "Acme Workspace",
    });
    assert.equal(welcome?.password, "initial-pass-123");
    assert.equal(JSON.stringify(result).includes("initial-pass-123"), false);
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
    let activationRequestUpdate: Record<string, unknown> | undefined;
    let auditReason = "";
    const now = new Date();
    const currentEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const controller = createController({
      subscriptionPlan: {
        findFirst: async () => ({ code: "growth", billingInterval: "monthly", modules: ["leads", "deals"] }),
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
      subscriptionActivationRequest: {
        updateMany: async (args: Record<string, unknown>) => {
          activationRequestUpdate = args;
          return { count: 1 };
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
    assert.deepEqual(data.enabledModules, ["leads", "deals"]);
    assert.deepEqual(activationRequestUpdate?.where, { organizationId, status: "PENDING" });
    assert.deepEqual(activationRequestUpdate?.data, { status: "ACTIVATED" });
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
        findUnique: async () => ({ enabledModules: ["leads", "team"], subscriptionStatus: "ACTIVE", subscriptionEndsAt: null }),
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
      { modules: ["leads", "deals", "email", "audit-logs", "settings", "leads"], reason: "Enable the sales team workflow" },
      actorRequest,
    );
    assert.deepEqual(updatedModules, ["leads", "deals", "email", "audit-logs", "settings"]);
    assert.deepEqual(result.data.enabledModules, ["leads", "deals", "email", "audit-logs", "settings"]);
    assert.equal(auditAction, "organization.modules.update");
    assert.equal(auditReason, "Enable the sales team workflow");
  });

  it("allows platform admins to grant extra modules to trial workspaces", async () => {
    let updatedModules: string[] | undefined;
    const controller = createController({
      organization: {
        findUnique: async () => ({
          enabledModules: ["leads", "team"],
          subscriptionStatus: "TRIAL",
          subscriptionEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
        update: async ({ data }: { data: { enabledModules: string[] } }) => {
          updatedModules = data.enabledModules;
          return { id: organizationId, enabledModules: data.enabledModules };
        },
      },
    });

    const result = await controller.updateOrganizationModules(
      organizationId,
      { modules: ["leads", "team", "automation", "reports"], reason: "Grant additional trial access" },
      actorRequest,
    );

    assert.deepEqual(updatedModules, ["leads", "team", "automation", "reports"]);
    assert.deepEqual(result.data.enabledModules, ["leads", "team", "automation", "reports"]);
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
