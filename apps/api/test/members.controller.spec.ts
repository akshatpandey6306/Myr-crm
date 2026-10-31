import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { MembersController } from "../src/organizations/members.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
    } as never, {} as never);

    const result = await controller.listMembers(request());
    assert.deepEqual(args?.where, { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } });
    assert.equal(result.data[0].role, "sales_rep");
    assert.equal(result.data[0].emailVerified, false);
  });

  it("denies member administration to sales managers", async () => {
    const controller = new MembersController({} as never, {} as never);
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
    } as never, {} as never);

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
    } as never, {} as never);
    await assert.rejects(
      controller.updateMemberRole(request(), "owner-a", { role: "admin" }),
      ForbiddenException,
    );
  });

  it("creates an invitation with a hashed token and never returns the raw link token", async () => {
    let invitationData: Record<string, unknown> | undefined;
    let emailText = "";
    const transaction = {
      organizationInvitation: {
        updateMany: async () => ({ count: 0 }),
        create: async (args: Record<string, unknown>) => {
          invitationData = args.data as Record<string, unknown>;
          return {
            id: "invite-a",
            email: "riley@example.com",
            role: "SALES_REP",
            expiresAt: new Date("2026-11-06T12:00:00.000Z"),
          };
        },
      },
    };
    const controller = new MembersController({
      membership: { findFirst: async () => null },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never, { send: async (_to: string, _subject: string, text: string) => { emailText = text; } } as never);

    const result = await controller.createInvitation(request(), { email: "Riley@Example.com", role: "sales_rep" });
    const rawToken = new URL(emailText.match(/https?:\/\/\S+/)?.[0] ?? "http://localhost").searchParams.get("token");
    assert.equal(invitationData?.organizationId, organizationId);
    assert.equal(invitationData?.invitedByUserId, userId);
    assert.equal(invitationData?.email, "riley@example.com");
    assert.equal(invitationData?.role, "SALES_REP");
    assert.ok(rawToken);
    assert.equal(invitationData?.tokenHash, createHash("sha256").update(rawToken!).digest("hex"));
    assert.equal(result.data.id, "invite-a");
    assert.equal("token" in result.data, false);
  });

  it("accepts an invitation by activating membership and verifying the invited email", async () => {
    const token = "single-use-invitation-secret";
    let membershipData: Record<string, unknown> | undefined;
    let createdUser: Record<string, unknown> | undefined;
    let auditData: Record<string, unknown> | undefined;
    const transaction = {
      organizationInvitation: { updateMany: async () => ({ count: 1 }) },
      user: {
        create: async (args: Record<string, unknown>) => {
          createdUser = args.data as Record<string, unknown>;
          return { id: "new-user", email: "riley@example.com", name: "Riley" };
        },
      },
      membership: {
        findUnique: async () => null,
        upsert: async (args: Record<string, unknown>) => { membershipData = args; return {}; },
      },
      auditLog: { create: async (args: Record<string, unknown>) => { auditData = args.data as Record<string, unknown>; return {}; } },
    };
    const controller = new MembersController({
      organizationInvitation: {
        findFirst: async (args: { where: { tokenHash: string } }) => {
          assert.equal(args.where.tokenHash, createHash("sha256").update(token).digest("hex"));
          return { id: "invite-a", organizationId, email: "riley@example.com", role: "SALES_REP" };
        },
      },
      user: { findUnique: async () => null },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never, {} as never);

    const result = await controller.acceptInvitation({ token, name: "Riley", password: "password123" });
    assert.equal(createdUser?.emailVerifiedAt instanceof Date, true);
    assert.match(String(createdUser?.passwordHash), /^scrypt\$/);
    assert.deepEqual((membershipData?.create as Record<string, unknown>), {
      organizationId,
      userId: "new-user",
      role: "SALES_REP",
    });
    assert.equal(auditData?.resourceType, "invitation");
    assert.equal(result.user.email, "riley@example.com");
  });
});
