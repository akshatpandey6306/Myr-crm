import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
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

  it("creates the organization, owner membership, and default pipeline atomically", async () => {
    let createArgs: Record<string, unknown> | undefined;
    const controller = new OrganizationsController({
      organization: {
        create: async (args: Record<string, unknown>) => {
          createArgs = args;
          return { id: "org-a", name: "Northwind", memberships: [{ role: "OWNER" }] };
        },
      },
    } as never);

    const result = await controller.create({ userId: "user-a" } as never, { name: " Northwind " });
    const data = createArgs?.data as Record<string, unknown>;
    const memberships = data.memberships as { create: Record<string, unknown> };
    const pipelines = data.pipelines as { create: { stages: { create: Array<{ name: string; position: number }> } } };

    assert.equal(data.name, "Northwind");
    assert.deepEqual(memberships.create, { userId: "user-a", role: "OWNER" });
    assert.deepEqual(pipelines.create.stages.create.map((stage) => stage.position), [0, 1, 2, 3]);
    assert.equal(result.data.role, "owner");
  });

  it("requires authenticated user context", async () => {
    const controller = new OrganizationsController({} as never);
    await assert.rejects(controller.list({} as never), UnauthorizedException);
  });
});
