import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { VendorsController } from "../src/vendors/vendors.controller.js";

const request = (role: "owner" | "sales_rep" = "owner") => ({
  userId: "user-a",
  orgId: "org-a",
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/vendors",
});

const sampleVendor = {
  id: "vendor-a",
  name: "Northstar Supply",
  category: "Office Supplies",
  contactPerson: "Maya Chen",
  email: "maya@example.com",
  phone: null,
  status: "ACTIVE" as const,
  rating: 4.8,
  reviewCount: 12,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("VendorsController", () => {
  it("scopes vendor list, summary, and categories to the verified workspace", async () => {
    const whereClauses: Record<string, unknown>[] = [];
    const prisma = {
      vendor: {
        count: async ({ where }: { where: Record<string, unknown> }) => { whereClauses.push(where); return 0; },
        groupBy: async ({ where }: { where: Record<string, unknown> }) => { whereClauses.push(where); return []; },
        findMany: async ({ where }: { where: Record<string, unknown> }) => { whereClauses.push(where); return []; },
      },
    };
    const controller = new VendorsController(prisma as never);

    await controller.list(request(), "supplies", "ACTIVE");
    await controller.summary(request());
    await controller.categories(request());

    assert.ok(whereClauses.length > 0);
    assert.ok(whereClauses.every((where) => where.organizationId === "org-a"));
    assert.ok(whereClauses.every((where) => where.archivedAt === null));
  });

  it("returns the same vendor totals from one status aggregation", async () => {
    const groupByCalls: Array<Record<string, unknown>> = [];
    const prisma = {
      vendor: {
        count: async () => { throw new Error("Summary should use one grouped query"); },
        groupBy: async (args: Record<string, unknown>) => {
          groupByCalls.push(args);
          return [
            { status: "ACTIVE", _count: { _all: 5 } },
            { status: "PENDING", _count: { _all: 2 } },
            { status: "ON_HOLD", _count: { _all: 1 } },
          ];
        },
      },
    };
    const controller = new VendorsController(prisma as never);

    assert.deepEqual(await controller.summary(request("sales_rep")), {
      data: { total: 8, active: 5, pending: 2, onHold: 1 },
    });
    assert.equal(groupByCalls.length, 1);
    assert.deepEqual(groupByCalls[0]?.by, ["status"]);
    assert.deepEqual(groupByCalls[0]?.where, {
      organizationId: "org-a",
      archivedAt: null,
      ownerUserId: "user-a",
    });
  });

  it("uses verified workspace and actor IDs when creating vendors", async () => {
    let args: Record<string, unknown> | undefined;
    const prisma = { vendor: { create: async (value: Record<string, unknown>) => { args = value; return sampleVendor; } } };
    const controller = new VendorsController(prisma as never);

    await controller.create(request(), {
      name: " Northstar Supply ",
      category: " Office Supplies ",
      contactPerson: "Maya Chen",
      email: "maya@example.com",
      organizationId: "org-b",
      ownerUserId: "user-b",
      createdByUserId: "user-b",
    });

    const data = args?.data as Record<string, unknown>;
    assert.equal(data.organizationId, "org-a");
    assert.equal(data.ownerUserId, "user-a");
    assert.equal(data.createdByUserId, "user-a");
    assert.equal(data.name, "Northstar Supply");
    assert.equal(data.status, "PENDING");
    assert.equal(data.phone, null);
  });

  it("limits sales representative results to vendors they own", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      vendor: {
        count: async ({ where: filter }: { where: Record<string, unknown> }) => { where = filter; return 0; },
        findMany: async ({ where: filter }: { where: Record<string, unknown> }) => { where = filter; return []; },
      },
    };
    const controller = new VendorsController(prisma as never);

    await controller.list(request("sales_rep"));

    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.ownerUserId, "user-a");
  });

  it("does not update a vendor from another workspace", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      vendor: {
        updateMany: async ({ where: filter }: { where: Record<string, unknown> }) => { where = filter; return { count: 0 }; },
      },
    };
    const controller = new VendorsController(prisma as never);

    await assert.rejects(controller.update(request(), "vendor-b", { name: "Changed" }), NotFoundException);
    assert.equal(where?.organizationId, "org-a");
  });

  it("archives only vendors in the verified workspace", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      vendor: {
        updateMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return { count: 1 }; },
      },
    };
    const controller = new VendorsController(prisma as never);

    assert.deepEqual(await controller.archive(request(), "vendor-a"), { ok: true });
    assert.equal(where?.id, "vendor-a");
    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.archivedAt, null);
  });

  it("rejects invalid vendor statuses and ratings", async () => {
    const controller = new VendorsController({ vendor: {} } as never);

    await assert.rejects(controller.create(request(), { name: "Vendor", category: "Services", status: "DISABLED" }), BadRequestException);
    await assert.rejects(controller.create(request(), { name: "Vendor", category: "Services", rating: 8 }), BadRequestException);
  });
});
