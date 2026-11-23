import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { MembersController } from "../src/organizations/members.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const joinCode = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function request(role: "owner" | "admin" | "sales_manager" | "sales_rep" = "owner") {
  return {
    userId,
    orgId: organizationId,
    organizationRole: role,
    headers: {},
    params: {},
    path: "/api/v1/organizations/members",
  };
}

describe("MembersController", () => {
  it("lists active members and pending invitations only within the selected organization", async () => {
    let args: Record<string, unknown> | undefined;
    const controller = new MembersController({
      membership: {
        findMany: async (value: Record<string, unknown>) => {
          args = value;
          return [{
            userId: "member-a",
            role: "SALES_REP",
            status: "ACTIVE",
            enabledModules: ["leads", "contacts", "companies", "deals", "activities"],
            createdAt: new Date("2026-10-30T12:00:00.000Z"),
            user: { name: "Riley", email: "riley@example.com", emailVerifiedAt: null },
          }];
        },
      },
    } as never);

    const result = await controller.listMembers(request());
    assert.deepEqual(args?.where, {
      organizationId,
      status: { in: ["ACTIVE", "PENDING"] },
      userId: { not: userId },
      user: { status: { in: ["ACTIVE", "PENDING"] } },
    });
    assert.equal(result.data[0].role, "sales_rep");
    assert.equal(result.data[0].status, "active");
    assert.deepEqual(result.data[0].enabledModules, ["leads", "contacts", "companies", "deals", "activities"]);
    assert.equal(result.data[0].emailVerified, false);
  });

  it("creates a pending employee and emails a one-time password setup link", async () => {
    let userData: Record<string, unknown> | undefined;
    let membershipData: Record<string, unknown> | undefined;
    let tokenData: Record<string, unknown> | undefined;
    let sentToken = "";
    let recipient = "";
    const transaction = {
      organization: { findUnique: async () => ({ subscriptionPlan: null }) },
      membership: { count: async () => 1 },
      user: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          userData = data;
          membershipData = (data.memberships as { create: Record<string, unknown> }).create;
          return { id: "employee-a", email: "riley@example.com", name: "Riley Jones" };
        },
      },
      auditLog: { create: async () => undefined },
      emailToken: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }: { data: Record<string, unknown> }) => { tokenData = data; },
      },
    };
    const prisma = {
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    };
    const email = {
      isConfigured: () => true,
      sendAccountActivation: async (token: string, to: string) => { sentToken = token; recipient = to; },
    };

    const result = await new MembersController(prisma as never, email as never).createMember(request("admin"), {
      name: "Riley Jones",
      email: "RILEY@Example.com",
      role: "sales_rep",
    });

    assert.equal(result.data.userId, "employee-a");
    assert.equal(result.data.status, "pending");
    assert.equal(result.data.emailVerified, false);
    assert.equal(userData?.status, "PENDING");
    assert.equal(typeof userData?.passwordHash, "string");
    assert.equal(membershipData?.status, "PENDING");
    assert.equal(tokenData?.purpose, "ACCOUNT_ACTIVATION");
    assert.equal(tokenData?.tokenHash, createHash("sha256").update(sentToken).digest("hex"));
    assert.notEqual(tokenData?.tokenHash, sentToken);
    assert.equal(recipient, "riley@example.com");
  });

  it("does not create employee accounts when invitation email is unavailable", async () => {
    let transactionStarted = false;
    const controller = new MembersController({
      $transaction: async () => { transactionStarted = true; },
    } as never, { isConfigured: () => false } as never);

    await assert.rejects(
      controller.createMember(request("admin"), { name: "Riley Jones", email: "riley@example.com" }),
      ServiceUnavailableException,
    );
    assert.equal(transactionStarted, false);
  });

  it("denies member administration to sales managers", async () => {
    const controller = new MembersController({} as never);
    await assert.rejects(controller.listMembers(request("sales_manager")), ForbiddenException);
  });

  it("provides a minimal organization-scoped assignee directory to sales managers", async () => {
    let args: Record<string, unknown> | undefined;
    const controller = new MembersController({
      membership: {
        findMany: async (value: Record<string, unknown>) => {
          args = value;
          return [{ userId: "member-a", user: { name: "Riley" } }];
        },
      },
    } as never);

    const result = await controller.listAssignees(request("sales_manager"));
    assert.deepEqual(args?.where, { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } });
    assert.deepEqual(result.data, [{ id: "member-a", name: "Riley" }]);
  });

  it("previews employee imports with workspace seat checks without returning passwords", async () => {
    const controller = new MembersController({
      organization: {
        findUnique: async () => ({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null, subscriptionPlan: "growth" }),
      },
      subscriptionPlan: { findUnique: async () => ({ employeeLimit: 2 }) },
      organizationSubscriptionPlanOverride: { findUnique: async () => null },
      additionalSeatPurchase: { aggregate: async () => ({ _sum: { quantity: 0 } }) },
      user: { findMany: async () => [] },
      membership: { count: async () => 1 },
    } as never);

    const result = await controller.validateMemberImport(request("admin"), {
      rows: [
        { name: "Riley One", email: "riley@example.com" },
        { name: "Riley Two", email: "riley2@example.com" },
      ],
    });

    assert.equal(result.data.canImport, false);
    assert.equal(result.data.rows[0]?.errors.length, 0);
    assert.deepEqual(result.data.rows[1]?.errors, ["Workspace seat limit would be exceeded."]);
    assert.equal("password" in (result.data.rows[0] ?? {}), false);
  });

  it("creates imported employees with hashed passwords in the active workspace", async () => {
    let createdUser: Record<string, unknown> | undefined;
    const transaction = {
        organization: {
          findUnique: async () => ({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null, subscriptionPlan: "growth" }),
        },
        subscriptionPlan: { findUnique: async () => ({ employeeLimit: 10 }) },
        organizationSubscriptionPlanOverride: { findUnique: async () => null },
        additionalSeatPurchase: { aggregate: async () => ({ _sum: { quantity: 0 } }) },
        membership: { count: async () => 1 },
        user: {
          findMany: async () => [],
          create: async ({ data }: { data: Record<string, unknown> }) => {
            createdUser = data;
            return { id: "created-user" };
          },
        },
      };
    const prisma = {
      ...transaction,
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    };

    const result = await new MembersController(prisma as never).importMembers(request("owner"), {
      rows: [{ name: "Riley", email: "RILEY@example.com", password: "temporary-pass-123" }],
    });

    assert.equal(result.data.createdCount, 1);
    assert.equal(createdUser?.email, "riley@example.com");
    assert.equal(createdUser?.passwordHash?.toString().startsWith("scrypt$"), true);
    assert.equal(createdUser?.passwordHash?.toString().includes("temporary-pass-123"), false);
    assert.deepEqual(
      ((createdUser?.memberships as { create: { enabledModules: string[] } }).create.enabledModules),
      [],
    );
    assert.equal("password" in result.data.rows[0]!, false);
  });

  it("denies employee CSV imports to non-administrators", async () => {
    const controller = new MembersController({} as never);
    await assert.rejects(
      controller.validateMemberImport(request("sales_rep"), { rows: [{ name: "Riley", email: "riley@example.com" }] }),
      ForbiddenException,
    );
    await assert.rejects(
      controller.importMembers(request("sales_rep"), { rows: [{ name: "Riley", email: "riley@example.com", password: "password123" }] }),
      ForbiddenException,
    );
  });

  it("updates only non-admin employee module access within the workspace and audits it", async () => {
    let update: Record<string, unknown> | undefined;
    let audit: Record<string, unknown> | undefined;
    const controller = new MembersController({
      membership: {
        findFirst: async () => ({ enabledModules: ["leads", "contacts"] }),
        update: async (value: Record<string, unknown>) => { update = value; },
      },
      auditLog: { create: async (value: Record<string, unknown>) => { audit = value.data; } },
    } as never);
    const result = await controller.updateMemberModules(
      { ...request("admin"), workspaceEnabledModules: ["leads", "contacts", "activities"] },
      "employee-a",
      { enabledModules: ["contacts", "activities", "contacts"] },
    );

    assert.deepEqual(update?.data, { enabledModules: ["contacts", "activities"] });
    assert.deepEqual(result.data.enabledModules, ["contacts", "activities"]);
    assert.deepEqual(audit, {
      organizationId,
      actorUserId: userId,
      action: "UPDATE",
      resourceType: "membership_modules",
      resourceId: "employee-a",
    });
  });

  it("rejects employee module assignments outside the workspace and never enables Team", async () => {
    const controller = new MembersController({
      membership: {
        findFirst: async () => ({ enabledModules: ["leads"] }),
        update: async () => assert.fail("Should not update modules"),
      },
    } as never);
    const adminRequest = { ...request(), enabledModules: ["leads"] };
    await assert.rejects(
      controller.updateMemberModules(adminRequest, "employee-a", { enabledModules: ["contacts"] }),
      BadRequestException,
    );
    await assert.rejects(
      controller.updateMemberModules(adminRequest, "employee-a", { enabledModules: ["team"] }),
      BadRequestException,
    );
  });

  it("exports only active members in the workspace and audits the export", async () => {
    let query: Record<string, unknown> | undefined;
    let audit: Record<string, unknown> | undefined;
    const controller = new MembersController({
      membership: {
        findMany: async (value: Record<string, unknown>) => {
          query = value;
          return [{
            role: "SALES_REP",
            createdAt: new Date("2026-10-30T12:00:00.000Z"),
            user: { name: "Riley", email: "riley@example.com" },
          }];
        },
      },
      auditLog: { create: async (value: Record<string, unknown>) => { audit = value.data; } },
    } as never);

    const result = await controller.exportMembers(request("admin"));
    assert.deepEqual(query?.where, { organizationId, status: "ACTIVE", userId: { not: userId }, user: { status: "ACTIVE" } });
    assert.equal(result.data[0]?.email, "riley@example.com");
    assert.deepEqual(audit, {
      organizationId,
      actorUserId: userId,
      action: "CREATE",
      resourceType: "member_export",
    });
  });

  it("rejects empty or malformed employee imports without account creation", async () => {
    let accountCreated = false;
    const transaction = {
        organization: {
          findUnique: async () => ({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null, subscriptionPlan: "growth" }),
        },
        subscriptionPlan: { findUnique: async () => ({ employeeLimit: 10 }) },
        organizationSubscriptionPlanOverride: { findUnique: async () => null },
        additionalSeatPurchase: { aggregate: async () => ({ _sum: { quantity: 0 } }) },
        membership: { count: async () => 0 },
        user: {
          findMany: async () => [],
          create: async () => { accountCreated = true; return { id: "created-user" }; },
        },
      };
    const controller = new MembersController({
      ...transaction,
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never);
    await assert.rejects(controller.validateMemberImport(request("admin"), { rows: [] }), BadRequestException);
    await assert.rejects(
      controller.importMembers(request("admin"), { rows: [{ name: "Riley", email: "bad", password: "password123" }] }),
      ConflictException,
    );
    assert.equal(accountCreated, false);
  });

  it("does not allow changing the current Owner through ordinary role assignment", async () => {
    const controller = new MembersController({
      membership: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async () => ({ role: "OWNER" }),
      },
    } as never);
    await assert.rejects(
      controller.updateMemberRole(request(), "owner-a", { role: "admin" }),
      ForbiddenException,
    );
  });

  it("creates a pending membership and notifies workspace administrators", async () => {
    let membershipData: Record<string, unknown> | undefined;
    let notificationData: Record<string, unknown>[] | undefined;
    const transaction = {
      organization: { findUnique: async () => ({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null, subscriptionPlan: null }) },
      subscriptionPlan: { findUnique: async () => null },
      organizationSubscriptionPlanOverride: { findUnique: async () => null },
      additionalSeatPurchase: { aggregate: async () => ({ _sum: { quantity: 0 } }) },
      membership: {
        findUnique: async () => null,
        findFirst: async () => null,
        count: async () => 0,
        upsert: async (args: Record<string, unknown>) => { membershipData = args; return {}; },
        findMany: async () => [{ userId: "admin-a" }],
      },
      user: { findUnique: async () => ({ name: "Riley", email: "riley@example.com" }) },
      notification: { createMany: async (args: { data: Record<string, unknown>[] }) => { notificationData = args.data; } },
    };
    const controller = new MembersController({
      organization: { findFirst: async () => ({ id: organizationId, name: "Acme" }) },
      membership: { findUnique: async () => null, findFirst: async () => null },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never);

    const result = await controller.requestToJoin(
      { ...request(), orgId: undefined, userId },
      { joinCode },
    );

    assert.deepEqual(membershipData?.create, {
      organizationId,
      userId,
      role: "SALES_REP",
      status: "PENDING",
      enabledModules: [],
    });
    assert.equal(notificationData?.[0]?.recipientUserId, "admin-a");
    assert.equal(notificationData?.[0]?.resourceId, userId);
    assert.equal(notificationData?.[0]?.type, "MEMBER_JOIN_REQUEST");
    assert.deepEqual(result.data.organization, { id: organizationId, name: "Acme" });
    assert.equal(result.data.status, "pending");
  });

  it("lets a workspace administrator approve a pending join request", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    let auditData: Record<string, unknown> | undefined;
    let notificationQuery: Record<string, unknown> | undefined;
    const transaction = {
      organization: { findUnique: async () => ({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null, subscriptionPlan: "growth" }) },
      subscriptionPlan: { findUnique: async () => ({ employeeLimit: 2 }) },
      organizationSubscriptionPlanOverride: { findUnique: async () => null },
      additionalSeatPurchase: { aggregate: async () => ({ _sum: { quantity: 0 } }) },
      membership: {
        count: async () => 1,
        findFirst: async () => null,
        updateMany: async (args: Record<string, unknown>) => { updateArgs = args; return { count: 1 }; },
      },
    };
    const controller = new MembersController({
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
      auditLog: { create: async (args: { data: Record<string, unknown> }) => { auditData = args.data; } },
      notification: {
        updateMany: async (args: { where: Record<string, unknown> }) => { notificationQuery = args.where; return { count: 1 }; },
      },
    } as never);

    const result = await controller.reviewMembershipRequest(
      request("admin"),
      "22222222-2222-4222-8222-222222222222",
      { decision: "approve", role: "admin" },
    );

    assert.deepEqual(updateArgs?.where, {
      organizationId,
      userId: "22222222-2222-4222-8222-222222222222",
      status: "PENDING",
      user: { status: "ACTIVE" },
    });
    assert.deepEqual(updateArgs?.data, { status: "ACTIVE", role: "ADMIN", enabledModules: [] });
    assert.equal(auditData?.resourceType, "membership_request");
    assert.equal(notificationQuery?.resourceId, "22222222-2222-4222-8222-222222222222");
    assert.equal(result.data.decision, "approve");
    assert.equal(result.data.role, "admin");
  });

  it("enforces the plan member limit before approving a join request", async () => {
    let updated = false;
    const transaction = {
      organization: { findUnique: async () => ({ subscriptionStatus: "TRIAL", subscriptionEndsAt: new Date(Date.now() + 60_000), subscriptionPlan: "growth" }) },
      subscriptionPlan: { findUnique: async () => ({ employeeLimit: 2 }) },
      organizationSubscriptionPlanOverride: { findUnique: async () => null },
      additionalSeatPurchase: { aggregate: async () => ({ _sum: { quantity: 0 } }) },
      membership: {
        count: async () => 3,
        findFirst: async () => null,
        updateMany: async () => { updated = true; return { count: 1 }; },
      },
    };
    const controller = new MembersController({
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never);

    await assert.rejects(
      controller.reviewMembershipRequest(
        request("admin"),
        "22222222-2222-4222-8222-222222222222",
        { decision: "approve" },
      ),
      ConflictException,
    );
    assert.equal(updated, false);
  });
});
