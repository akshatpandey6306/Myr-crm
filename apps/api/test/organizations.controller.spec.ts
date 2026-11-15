import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { OrganizationsController } from "../src/organizations/organizations.controller.js";

describe("OrganizationsController", () => {
  it("lists only active memberships for the authenticated user", async () => {
    let query: Record<string, unknown> | undefined;
    const controller = new OrganizationsController({
      membership: {
        findMany: async (args: Record<string, unknown>) => {
          query = args;
          return [{ role: "OWNER", organization: { id: "org-a", name: "Northwind" } }];
        },
      },
    } as never);

    const result = await controller.list({ userId: "user-a" } as never);

    assert.deepEqual(query?.where, { userId: "user-a", status: "ACTIVE" });
    assert.deepEqual(result.data, [{ id: "org-a", name: "Northwind", role: "owner" }]);
  });

  it("rejects customer workspace creation outside central provisioning", async () => {
    const controller = new OrganizationsController({} as never);
    await assert.rejects(controller.create({ userId: "user-a" } as never, { name: "Northwind" }), ForbiddenException);
  });

  it("requires authenticated user context", async () => {
    const controller = new OrganizationsController({} as never);
    await assert.rejects(controller.list({} as never), UnauthorizedException);
  });
});
