import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { OrganizationsController } from "../src/organizations/organizations.controller.js";

describe("OrganizationsController listMembers", () => {
  it("returns active members for only the verified organization", async () => {
    let findManyArgs: Record<string, unknown> | undefined;
    const prisma = {
      membership: {
        findMany: async (args: Record<string, unknown>) => {
          findManyArgs = args;
          return [
            { userId: "user-a", role: "OWNER", user: { name: "Maya Chen" } },
            { userId: "user-b", role: "SALES_REP", user: { name: "Sam Lee" } },
          ];
        },
      },
    };
    const controller = new OrganizationsController(prisma as never);

    const response = await controller.listMembers({ orgId: "org-a" } as never);

    assert.deepEqual(findManyArgs?.where, {
      organizationId: "org-a",
      status: "ACTIVE",
      user: { status: "ACTIVE" },
    });
    assert.deepEqual(response, {
      data: [
        { id: "user-a", name: "Maya Chen", role: "owner" },
        { id: "user-b", name: "Sam Lee", role: "sales_rep" },
      ],
    });
  });

  it("requires a verified organization context", async () => {
    const controller = new OrganizationsController({} as never);

    await assert.rejects(controller.listMembers({} as never), UnauthorizedException);
  });
});
