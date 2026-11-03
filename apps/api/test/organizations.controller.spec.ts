import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { OrganizationsController } from "../src/organizations/organizations.controller.js";

function createController(prisma?: Record<string, unknown>) {
  return new OrganizationsController(prisma as never);
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
              { id: "membership-a", role: "OWNER", user: { name: "Maya Chen", email: "maya@example.com" } },
              { id: "membership-b", role: "SALES_REP", user: { name: "Sam Lee", email: "sam@example.com" } },
            ];
          },
        },
      };
      const controller = createController(prisma);

      const response = await controller.listMembers({ orgId: "org-a" } as never);

      assert.deepEqual(findManyArgs?.where, {
        organizationId: "org-a",
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      });
      assert.deepEqual(response, {
        data: [
          { id: "membership-a", name: "Maya Chen", email: "maya@example.com", role: "owner" },
          { id: "membership-b", name: "Sam Lee", email: "sam@example.com", role: "sales_rep" },
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
          findUnique: async () => ({ id: "membership-1", organizationId: "org-a", userId: "user-b" }),
          findFirst: async () => ({ userId: "user-a", role: "OWNER" }),
          count: async () => 1,
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
          findUnique: async () => ({ id: "membership-1", organizationId: "org-a", userId: "user-b" }),
          findFirst: async () => ({ userId: "user-a", role: "OWNER" }),
          count: async () => 2,
          update: async () => ({ id: "membership-1", status: "REMOVED" }),
        },
      });

      const result = await controller.removeMember({ orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never, "membership-1");

      assert.equal(result.ok, true);
    });
  });
});
