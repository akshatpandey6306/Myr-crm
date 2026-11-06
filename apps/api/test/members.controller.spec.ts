import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, ForbiddenException } from "@nestjs/common";
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
  it("lists active members only within the selected organization", async () => {
    let args: Record<string, unknown> | undefined;
    const controller = new MembersController({
      membership: {
        findMany: async (value: Record<string, unknown>) => {
          args = value;
          return [{
            userId: "member-a",
            role: "SALES_REP",
            createdAt: new Date("2026-10-30T12:00:00.000Z"),
            user: { name: "Riley", email: "riley@example.com", emailVerifiedAt: null },
          }];
        },
      },
    } as never);

    const result = await controller.listMembers(request());
    assert.deepEqual(args?.where, { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } });
    assert.equal(result.data[0].role, "sales_rep");
    assert.equal(result.data[0].emailVerified, false);
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
      membership: {
        findUnique: async () => null,
        upsert: async (args: Record<string, unknown>) => { membershipData = args; return {}; },
        findMany: async () => [{ userId: "admin-a" }],
      },
      user: { findUnique: async () => ({ name: "Riley", email: "riley@example.com" }) },
      notification: { createMany: async (args: { data: Record<string, unknown>[] }) => { notificationData = args.data; } },
    };
    const controller = new MembersController({
      organization: { findFirst: async () => ({ id: organizationId, name: "Acme" }) },
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
      subscriptionPlan: { findUnique: async () => ({ employeeLimit: 10 }) },
      membership: {
        count: async () => 1,
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
    assert.deepEqual(updateArgs?.data, { status: "ACTIVE", role: "ADMIN" });
    assert.equal(auditData?.resourceType, "membership_request");
    assert.equal(notificationQuery?.resourceId, "22222222-2222-4222-8222-222222222222");
    assert.equal(result.data.decision, "approve");
    assert.equal(result.data.role, "admin");
  });

  it("enforces the two-total-member trial limit before approving a join request", async () => {
    let updated = false;
    const transaction = {
      organization: { findUnique: async () => ({ subscriptionStatus: "TRIAL", subscriptionEndsAt: new Date(Date.now() + 60_000), subscriptionPlan: "growth" }) },
      subscriptionPlan: { findUnique: async () => ({ employeeLimit: 10 }) },
      membership: {
        count: async () => 2,
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
