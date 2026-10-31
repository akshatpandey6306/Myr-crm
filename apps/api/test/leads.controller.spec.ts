import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { LeadsController } from "../src/leads/leads.controller.js";

const createController = (prisma: unknown) =>
  new LeadsController(prisma as never, { runForLead: async () => {} } as never);

describe("LeadsController", () => {
  it("scopes paginated and filtered reads to the verified organization", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      lead: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    };
    const controller = createController(prisma);
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
      ownerUserId: "user-a", createdAt: new Date(), updatedAt: new Date(), owner: { user: { name: "Maya Chen" } },
    };
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        lead: { create: async (value: Record<string, unknown>) => { args = value; return lead; } },
      }),
    };
    const controller = createController(prisma);
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
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        lead: { findFirst: async () => null },
      }),
    };
    const controller = createController(prisma);
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
    const controller = createController({ lead: {} });
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
    const controller = createController(prisma);
    await controller.list(
      { userId: "rep-a", orgId: "org-a", organizationRole: "sales_rep", headers: {}, params: {}, path: "/api/v1/leads" },
    );
    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.ownerUserId, "rep-a");
  });

  it("runs status automations inside the lead update transaction only when status changes", async () => {
    let event: Record<string, unknown> | undefined;
    const before = {
      id: "lead-a", name: "Olivia Rhye", company: "Northstar", source: "WEBSITE", status: "NEW",
      ownerUserId: "user-a", createdByUserId: "user-a", createdAt: new Date(), updatedAt: new Date(),
    };
    const updated = {
      ...before, status: "QUALIFIED", owner: { user: { name: "Maya Chen" } },
    };
    let findCount = 0;
    let auditData: Record<string, unknown> | undefined;
    const prisma = {
      auditLog: { create: async (args: { data: Record<string, unknown> }) => { auditData = args.data; return args.data; } },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        lead: {
          findFirst: async () => findCount++ === 0 ? before : updated,
          updateMany: async () => ({ count: 1 }),
        },
      }),
    };
    const controller = new LeadsController(prisma as never, {
      runForLead: async (_tx: unknown, value: Record<string, unknown>) => { event = value; return ["activity-generated"]; },
    } as never);

    await controller.update(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads/lead-a" },
      "lead-a",
      { status: "qualified" },
    );
    assert.equal(event?.event, "lead_status_changed");
    assert.equal(event?.status, "QUALIFIED");
    assert.equal(event?.leadId, "lead-a");
    assert.equal(event?.organizationId, "org-a");
    assert.deepEqual(auditData, {
      organizationId: "org-a",
      actorUserId: "user-a",
      action: "CREATE",
      resourceType: "activity",
      resourceId: "activity-generated",
    });
  });
});
