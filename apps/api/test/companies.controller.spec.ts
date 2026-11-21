import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CompaniesController } from "../src/companies/companies.controller.js";

const request = (role: "owner" | "sales_rep" = "owner") => ({
  userId: "user-a",
  orgId: "org-a",
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/companies",
});

describe("CompaniesController", () => {
  it("scopes company search and pagination to the verified organization", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      activity: { groupBy: async () => [] },
      company: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    };
    const controller = new CompaniesController(prisma as never);
    const result = await controller.list(request(), "north", "2", "10", "name", "asc");

    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.archivedAt, null);
    assert.deepEqual(where?.OR, [
      { name: { contains: "north", mode: "insensitive" } },
      { industry: { contains: "north", mode: "insensitive" } },
      { website: { contains: "north", mode: "insensitive" } },
      { phone: { contains: "north", mode: "insensitive" } },
    ]);
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 10);
  });

  it("limits representative lists and reads to records they own", async () => {
    let listWhere: Record<string, unknown> | undefined;
    let getWhere: Record<string, unknown> | undefined;
    const company = {
      id: "company-a",
      name: "Northstar Labs",
      industry: "Technology",
      website: null,
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      owner: { user: { name: "Maya Chen" } },
    };
    const prisma = {
      activity: { groupBy: async () => [] },
      company: {
        count: async (args: { where: Record<string, unknown> }) => { listWhere = args.where; return 1; },
        findMany: async (args: { where: Record<string, unknown> }) => { listWhere = args.where; return [company]; },
        findFirst: async (args: { where: Record<string, unknown> }) => { getWhere = args.where; return company; },
      },
    };
    const controller = new CompaniesController(prisma as never);

    await controller.list(request("sales_rep"));
    await controller.get(request("sales_rep"), "company-a");

    assert.equal(listWhere?.ownerUserId, "user-a");
    assert.equal(getWhere?.organizationId, "org-a");
    assert.equal(getWhere?.ownerUserId, "user-a");
  });

  it("uses verified tenant and user IDs when creating a company", async () => {
    let args: Record<string, unknown> | undefined;
    const company = {
      id: "company-a",
      name: "Northstar Labs",
      industry: "Technology",
      website: "https://northstar.io",
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      owner: { user: { name: "Maya Chen" } },
    };
    const prisma = {
      company: {
        create: async (value: Record<string, unknown>) => { args = value; return company; },
      },
    };
    const controller = new CompaniesController(prisma as never);
    await controller.create(request(), {
      name: " Northstar Labs ",
      industry: " Technology ",
      website: "https://northstar.io",
      organizationId: "org-b",
      createdByUserId: "user-b",
    });

    const data = args?.data as Record<string, unknown>;
    assert.equal(data.organizationId, "org-a");
    assert.equal(data.ownerUserId, "user-a");
    assert.equal(data.createdByUserId, "user-a");
    assert.equal(data.name, "Northstar Labs");
    assert.equal(data.phone, null);
  });

  it("rejects invalid company websites", async () => {
    const controller = new CompaniesController({ company: {} } as never);
    await assert.rejects(
      controller.create(request(), { name: "Example", website: "javascript:alert(1)" }),
      BadRequestException,
    );
  });

  it("returns not found when updating a company outside the verified organization", async () => {
    const prisma = { company: { updateMany: async () => ({ count: 0 }) } };
    const controller = new CompaniesController(prisma as never);
    await assert.rejects(controller.update(request(), "company-b", { name: "Changed" }), NotFoundException);
  });

  it("archives companies only inside the verified organization", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      company: {
        updateMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where;
          return { count: 1 };
        },
      },
    };
    const controller = new CompaniesController(prisma as never);

    assert.deepEqual(await controller.archive(request(), "company-a"), { ok: true });
    assert.equal(where?.id, "company-a");
    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.archivedAt, null);
  });

  it("updates selected company statuses atomically inside the verified tenant", async () => {
    let countWhere: Record<string, unknown> | undefined;
    let updateArgs: Record<string, unknown> | undefined;
    const tx = { company: {
      count: async (args: { where: Record<string, unknown> }) => { countWhere = args.where; return 2; },
      updateMany: async (args: Record<string, unknown>) => { updateArgs = args; return { count: 2 }; },
    } };
    const controller = new CompaniesController({ $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) } as never);
    const result = await controller.bulkUpdate(request(), { ids: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ], status: "customer" });

    assert.equal(countWhere?.organizationId, "org-a");
    assert.deepEqual(countWhere?.id, { in: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"] });
    assert.deepEqual(updateArgs?.data, { status: "CUSTOMER" });
    assert.deepEqual(result.data, { updatedCount: 2 });
  });

  it("does not partially update a bulk request containing an unavailable company", async () => {
    let updated = false;
    const tx = { company: {
      count: async () => 1,
      updateMany: async () => { updated = true; return { count: 1 }; },
    } };
    const controller = new CompaniesController({ $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) } as never);
    await assert.rejects(
      controller.bulkUpdate(request(), { ids: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"], status: "customer" }),
      NotFoundException,
    );
    assert.equal(updated, false);
  });
});
