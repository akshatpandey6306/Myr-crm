import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { OrganizationsController } from "../src/organizations/organizations.controller.js";

function createController(prisma?: Record<string, unknown>) {
  return new OrganizationsController(prisma as never, { record: async () => undefined } as never);
}

describe("OrganizationsController", () => {
  describe("listMembers", () => {
    it("returns active members for only the verified organization", async () => {
      let findManyArgs: Record<string, unknown> | undefined;
      const prisma = {
        membership: {
          findMany: async (args: Record<string, unknown>) => {
            findManyArgs = args;
            return [
              { id: "membership-a", userId: "user-a", role: "OWNER", user: { name: "Maya Chen", email: "maya@example.com" } },
              { id: "membership-b", userId: "user-b", role: "SALES_REP", user: { name: "Sam Lee", email: "sam@example.com" } },
            ];
          },
        },
      };
      const controller = createController(prisma);

      const response = await controller.listMembers({ orgId: "org-a", userId: "user-a" } as never);

      assert.deepEqual(findManyArgs?.where, {
        organizationId: "org-a",
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      });
      assert.deepEqual(response, {
        data: [
          { id: "membership-a", name: "Maya Chen", email: "maya@example.com", role: "owner", isCurrentUser: true },
          { id: "membership-b", name: "Sam Lee", email: "sam@example.com", role: "sales_rep", isCurrentUser: false },
        ],
      });
    });

    it("requires a verified organization context", async () => {
      const controller = createController();

      await assert.rejects(controller.listMembers({} as never), UnauthorizedException);
    });
  });

  describe("createInvitation", () => {
    it("rejects a non-owner, non-admin requester", async () => {
      const controller = createController();

      await assert.rejects(
        controller.createInvitation({ orgId: "org-a" } as never, { email: "teammate@example.com", role: "sales_rep" } as never),
        ForbiddenException,
      );
    });

    it("rejects invitations past the seat limit", async () => {
      const controller = createController({
        organization: {
          findUnique: async () => ({
            subscriptionPlan: "starter",
            subscriptionStatus: "ACTIVE",
            subscriptionEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }),
        },
        subscriptionPlan: { findUnique: async () => ({ employeeLimit: 3 }) },
        membership: {
          count: async () => 3,
          findFirst: async () => undefined,
        },
        invitation: {
          count: async () => 0,
        },
      });

      await assert.rejects(
        controller.createInvitation({ orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never, { email: "teammate@example.com", role: "sales_rep" } as never),
        ConflictException,
      );
    });

    it("creates an invitation when seats are available", async () => {
      const controller = createController({
        organization: {
          findUnique: async () => ({
            subscriptionPlan: "growth",
            subscriptionStatus: "ACTIVE",
            subscriptionEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }),
        },
        subscriptionPlan: { findUnique: async () => ({ employeeLimit: 10 }) },
        membership: {
          findFirst: async () => undefined,
          count: async () => 0,
        },
        invitation: {
          create: async (args: Record<string, unknown>) => args,
          count: async () => 0,
        },
      });

      const result = await controller.createInvitation({ orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never, { email: "teammate@example.com", role: "sales_rep" } as never);

      assert.equal(result.data.role, "sales_rep");
    });

    it("does not allow sales managers to invite members", async () => {
      const controller = createController();

      await assert.rejects(
        controller.createInvitation({ orgId: "org-a", organizationRole: "sales_manager" } as never, { email: "teammate@example.com", role: "sales_rep" } as never),
        ForbiddenException,
      );
    });
  });

  describe("updateMemberRole", () => {
    it("updates a tenant-scoped member role and audits the change", async () => {
      let lookup: Record<string, unknown> | undefined;
      let update: Record<string, unknown> | undefined;
      let audit: Record<string, unknown> | undefined;
      const controller = new OrganizationsController({
        membership: {
          findFirst: async (args: Record<string, unknown>) => {
            lookup = args;
            return { id: "membership-b", userId: "user-b", role: "SALES_REP" };
          },
          updateMany: async (args: Record<string, unknown>) => { update = args; return { count: 1 }; },
        },
      } as never, { record: async (entry: Record<string, unknown>) => { audit = entry; } } as never);

      const result = await controller.updateMemberRole(
        { orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never,
        "membership-b",
        { role: "read_only" },
      );

      assert.deepEqual(lookup?.where, {
        id: "membership-b",
        organizationId: "org-a",
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      });
      assert.deepEqual(update?.data, { role: "READ_ONLY" });
      assert.equal(result.data.role, "read_only");
      assert.equal(audit?.action, "organization.member.role.update");
    });

    it("does not allow administrators to change their own role", async () => {
      const controller = createController({
        membership: {
          findFirst: async () => ({ id: "membership-a", userId: "user-a", role: "ADMIN" }),
        },
      });

      await assert.rejects(
        controller.updateMemberRole({ orgId: "org-a", userId: "user-a", organizationRole: "admin" } as never, "membership-a", { role: "sales_rep" }),
        ForbiddenException,
      );
    });

    it("requires ownership transfer before changing the owner's role", async () => {
      const controller = createController({
        membership: {
          findFirst: async () => ({ id: "membership-owner", userId: "user-a", role: "OWNER" }),
        },
      });

      await assert.rejects(
        controller.updateMemberRole({ orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never, "membership-owner", { role: "admin" }),
        ForbiddenException,
      );
    });
  });

  describe("transferOwnership", () => {
    it("transfers ownership atomically and audits both users", async () => {
      const updates: Record<string, unknown>[] = [];
      let audit: Record<string, unknown> | undefined;
      const controller = new OrganizationsController({
        membership: {
          findFirst: async (args: Record<string, unknown>) => {
            const where = args.where as Record<string, unknown>;
            return where.role === "OWNER"
              ? { id: "membership-a", userId: "user-a" }
              : { id: "membership-b", userId: "user-b" };
          },
        },
        $transaction: async (operation: (tx: never) => Promise<void>) => operation({
          membership: { updateMany: async (args: Record<string, unknown>) => { updates.push(args); return { count: 1 }; } },
        } as never),
      } as never, { record: async (entry: Record<string, unknown>) => { audit = entry; } } as never);

      const result = await controller.transferOwnership(
        { orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never,
        { membershipId: "membership-b" },
      );

      assert.deepEqual(updates, [
        { where: { id: "membership-b", organizationId: "org-a", status: "ACTIVE", role: { not: "OWNER" } }, data: { role: "OWNER" } },
        { where: { id: "membership-a", organizationId: "org-a", status: "ACTIVE", role: "OWNER" }, data: { role: "ADMIN" } },
      ]);
      assert.equal(result.data.newOwnerMembershipId, "membership-b");
      assert.deepEqual(audit?.metadata, { previousOwnerUserId: "user-a", newOwnerUserId: "user-b" });
    });

    it("allows only the active owner to transfer ownership", async () => {
      const controller = createController();

      await assert.rejects(
        controller.transferOwnership({ orgId: "org-a", userId: "user-a", organizationRole: "admin" } as never, { membershipId: "membership-b" }),
        ForbiddenException,
      );
    });
  });

  describe("acceptInvitation", () => {
    it("blocks invitations when the Team module has been disabled for its tenant", async () => {
      const controller = createController({
        user: { findUnique: async () => ({ email: "teammate@example.com" }) },
        invitation: {
          findUnique: async () => ({
            acceptedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            email: "teammate@example.com",
            organization: { enabledModules: ["leads"] },
          }),
        },
      });

      await assert.rejects(
        controller.acceptInvitation({ userId: "user-a" } as never, "invitation-token"),
        (error: unknown) => error instanceof ForbiddenException && error.message.includes("Team module is not enabled"),
      );
    });
  });

  describe("removeMember", () => {
    it("rejects a non-owner, non-admin requester", async () => {
      const controller = createController();

      await assert.rejects(
        controller.removeMember({ orgId: "org-a", params: { id: "membership-1" } } as never, "membership-1"),
        ForbiddenException,
      );
    });

    it("rejects removing the last active member", async () => {
      const controller = createController({
        membership: {
          findUnique: async () => ({ id: "membership-1", organizationId: "org-a", userId: "user-b", role: "SALES_REP" }),
          findFirst: async () => ({ userId: "user-a", role: "OWNER" }),
        },
        $transaction: async (operation: (tx: never) => Promise<void>) => operation({
          membership: { count: async () => 1 },
        } as never),
      });

      await assert.rejects(
        controller.removeMember({ orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never, "membership-1"),
        ForbiddenException,
      );
    });

    it("rejects removing the current owner without transferring ownership", async () => {
      const controller = createController({
        membership: {
          findUnique: async () => ({ id: "membership-1", organizationId: "org-a", userId: "user-a", role: "OWNER" }),
        },
      });

      await assert.rejects(
        controller.removeMember({ orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never, "membership-1"),
        ForbiddenException,
      );
    });

    it("removes a member when the workspace still has active members", async () => {
      const controller = createController({
        membership: {
          findUnique: async () => ({ id: "membership-1", organizationId: "org-a", userId: "user-b", role: "SALES_REP" }),
          findFirst: async () => ({ userId: "user-a", role: "OWNER" }),
        },
        $transaction: async (operation: (tx: never) => Promise<void>) => operation({
          membership: {
            count: async () => 2,
            updateMany: async () => ({ count: 1 }),
          },
        } as never),
      });

      const result = await controller.removeMember({ orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never, "membership-1");

      assert.equal(result.ok, true);
    });
  });
});
