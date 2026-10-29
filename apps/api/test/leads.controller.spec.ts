import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { LeadsController } from "../src/leads/leads.controller.js";

describe("LeadsController", () => {
  it("scopes paginated and filtered reads to the verified organization", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      lead: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    };
    const controller = new LeadsController(prisma as never);
    const result = await controller.list(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads" },
      "north",
      "website",
      "new",
      "2",
      "10",
      "name",
      "asc",
    );

    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.archivedAt, null);
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 10);
    assert.equal(result.meta.total, 0);
  });

  it("uses server verified tenant and actor IDs when creating a lead", async () => {
    let args: Record<string, unknown> | undefined;
    const lead = {
      id: "lead-a", name: "Olivia Rhye", company: "Northstar", source: "WEBSITE", status: "NEW",
      createdAt: new Date(), updatedAt: new Date(), owner: { user: { name: "Maya Chen" } },
    };
    const prisma = { lead: { create: async (value: Record<string, unknown>) => { args = value; return lead; } } };
    const controller = new LeadsController(prisma as never);
    await controller.create(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads" },
      { name: "Olivia Rhye", company: "Northstar", source: "website", organizationId: "org-b", ownerUserId: "user-b" },
    );
    const data = args?.data as Record<string, unknown>;
    assert.equal(data.organizationId, "org-a");
    assert.equal(data.ownerUserId, "user-a");
    assert.equal(data.createdByUserId, "user-a");
  });

  it("returns not found for a record outside the verified organization", async () => {
    const prisma = { lead: { updateMany: async () => ({ count: 0 }) } };
    const controller = new LeadsController(prisma as never);
    await assert.rejects(
      controller.update(
        { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads/lead-b" },
        "lead-b",
        { status: "qualified" },
      ),
      NotFoundException,
    );
  });

  it("blocks read-only record mutations", async () => {
    const controller = new LeadsController({ lead: {} } as never);
    await assert.rejects(
      controller.create(
        { userId: "user-a", orgId: "org-a", organizationRole: "read_only", headers: {}, params: {}, path: "/api/v1/leads" },
        { name: "Test", company: "Example", source: "website" },
      ),
      ForbiddenException,
    );
  });

  it("limits representative list queries to records they own", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      lead: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    };
    const controller = new LeadsController(prisma as never);
    await controller.list(
      { userId: "rep-a", orgId: "org-a", organizationRole: "sales_rep", headers: {}, params: {}, path: "/api/v1/leads" },
    );
    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.ownerUserId, "rep-a");
  });
});
