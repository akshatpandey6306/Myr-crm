import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { LeadsController } from "../src/leads/leads.controller.js";

const createController = (prisma: unknown) =>
  new LeadsController({
    organization: { findUnique: async () => ({ timezone: "UTC" }) },
    ...(prisma as Record<string, unknown>),
  } as never, { runForLead: async () => {} } as never);

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
      ownerUserId: "user-a", createdAt: new Date(), updatedAt: new Date(), owner: { role: "OWNER", user: { name: "Maya Chen" } },
    };
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        organizationSettings: { findUnique: async () => null },
        membership: { findMany: async () => [] },
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

  it("detects duplicate email inside the active tenant and representative ownership scope", async () => {
    let duplicateWhere: Record<string, unknown> | undefined;
    const controller = createController({
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        lead: { findMany: async (args: { where: Record<string, unknown> }) => {
          duplicateWhere = args.where;
          return [{ id: "existing-lead", name: "Olivia Rhye", company: "Northstar", email: "olivia@example.com", phone: null }];
        } },
      }),
    });

    await assert.rejects(controller.create(
      { userId: "rep-a", orgId: "org-a", organizationRole: "sales_rep", headers: {}, params: {}, path: "/api/v1/leads" },
      { name: "Olivia Rhye", company: "Northstar", email: " OLIVIA@example.com ", source: "website" },
    ), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      const response = error.getResponse() as { details?: { duplicates?: Array<{ id: string }> } };
      assert.equal(response.details?.duplicates?.[0]?.id, "existing-lead");
      return true;
    });
    assert.equal(duplicateWhere?.organizationId, "org-a");
    assert.equal(duplicateWhere?.ownerUserId, "rep-a");
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

  it("returns conversion options only for the active tenant and representative ownership", async () => {
    let companyWhere: Record<string, unknown> | undefined;
    let contactWhere: Record<string, unknown> | undefined;
    const controller = createController({
      lead: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.organizationId, "org-a");
        assert.equal(where.ownerUserId, "rep-a");
        return { id: "lead-a" };
      } },
      company: { findMany: async ({ where }: { where: Record<string, unknown> }) => { companyWhere = where; return []; } },
      contact: { findMany: async ({ where }: { where: Record<string, unknown> }) => { contactWhere = where; return []; } },
    });
    const result = await controller.conversionOptions({
      userId: "rep-a", orgId: "org-a", organizationRole: "sales_rep", enabledModules: ["companies", "contacts"], headers: {}, params: {}, path: "/api/v1/leads/lead-a/conversion-options",
    }, "lead-a", "North");
    assert.equal(companyWhere?.organizationId, "org-a");
    assert.equal(companyWhere?.ownerUserId, "rep-a");
    assert.equal(contactWhere?.organizationId, "org-a");
    assert.equal(contactWhere?.ownerUserId, "rep-a");
    assert.equal((result.data as { canCreateDeal: boolean }).canCreateDeal, false);
  });

  it("does not allow conversion to link a company from another tenant", async () => {
    let companyLookup: Record<string, unknown> | undefined;
    const controller = createController({
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        lead: { findFirst: async () => ({ id: "lead-a", company: "Northstar", name: "Olivia", email: "olivia@example.com", phone: null, ownerUserId: "owner-a" }) },
        leadConversion: { findUnique: async () => null },
        company: { findFirst: async ({ where }: { where: Record<string, unknown> }) => { companyLookup = where; return null; } },
      }),
    });
    await assert.rejects(controller.convert({
      userId: "owner-a", orgId: "org-a", organizationRole: "owner", enabledModules: ["companies", "contacts", "deals"], headers: {}, params: {}, path: "/api/v1/leads/lead-a/convert",
    }, "lead-a", { companyId: "11111111-1111-4111-8111-111111111111", contactId: "22222222-2222-4222-8222-222222222222" }), NotFoundException);
    assert.deepEqual(companyLookup, { id: "11111111-1111-4111-8111-111111111111", organizationId: "org-a", archivedAt: null });
  });

  it("returns an existing conversion instead of creating duplicate CRM records", async () => {
    const convertedAt = new Date("2026-11-20T10:00:00Z");
    let writes = 0;
    const prior = { id: "conversion-a", convertedAt, company: { id: "company-a", name: "Northstar" }, contact: { id: "contact-a", name: "Olivia", email: "olivia@example.com" }, deal: null };
    const controller = createController({
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        lead: { findFirst: async () => ({ id: "lead-a", company: "Northstar", name: "Olivia", email: "olivia@example.com", phone: null, ownerUserId: "owner-a" }) },
        leadConversion: { findUnique: async () => prior, create: async () => { writes += 1; return prior; } },
        company: { create: async () => { writes += 1; return {}; } },
        contact: { create: async () => { writes += 1; return {}; } },
        deal: { create: async () => { writes += 1; return {}; } },
        auditLog: { create: async () => { writes += 1; return {}; } },
      }),
    });
    const result = await controller.convert({
      userId: "owner-a", orgId: "org-a", organizationRole: "owner", enabledModules: ["companies", "contacts", "deals"], headers: {}, params: {}, path: "/api/v1/leads/lead-a/convert",
    }, "lead-a", { createDeal: true });
    assert.equal((result.data as { alreadyConverted: boolean }).alreadyConverted, true);
    assert.equal(writes, 0);
  });

  it("runs status automations inside the lead update transaction only when status changes", async () => {
    let event: Record<string, unknown> | undefined;
    const before = {
      id: "lead-a", name: "Olivia Rhye", company: "Northstar", source: "WEBSITE", status: "NEW",
      ownerUserId: "user-a", createdByUserId: "user-a", createdAt: new Date(), updatedAt: new Date(),
    };
    const updated = {
      ...before, status: "QUALIFIED", owner: { role: "OWNER", user: { name: "Maya Chen" } },
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
    assert.equal(event?.status, "qualified");
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

  it("accepts custom lead statuses and normalizes whitespace and case", async () => {
    let createArgs: { data: Record<string, unknown> } | undefined;
    const lead = {
      id: "lead-a", name: "Olivia Rhye", company: "Northstar", source: "WEBSITE", status: "follow up",
      ownerUserId: "user-a", createdAt: new Date(), updatedAt: new Date(), owner: { role: "OWNER", user: { name: "Maya Chen" } },
    };
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        organizationSettings: { findUnique: async () => null },
        membership: { findMany: async () => [] },
        lead: { create: async (args: { data: Record<string, unknown> }) => { createArgs = args; return lead; } },
      }),
    };
    const controller = createController(prisma);

    await controller.create(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads" },
      { name: "Olivia Rhye", company: "Northstar", source: "website", status: "  FOLLOW   UP " },
    );

    assert.equal(createArgs?.data.status, "follow up");
  });

  it("filters leads by normalized custom statuses", async () => {
    let where: Record<string, unknown> | undefined;
    const controller = createController({
      lead: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    });

    await controller.list(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads" },
      undefined,
      undefined,
      "  FOLLOW UP ",
    );

    assert.deepEqual(where?.status, { in: ["follow up"] });
  });

  it("distributes selected leads evenly among active members within the organization", async () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const employeeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const employeeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const updates: { ids: string[]; ownerUserId: string }[] = [];
    const prisma = {
      membership: {
        findMany: async () => [{ userId: employeeA }, { userId: employeeB }],
      },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        membership: {
          findMany: async () => [{ userId: employeeA }, { userId: employeeB }],
        },
        lead: {
          findMany: async () => [{ id: first }, { id: second }, { id: "33333333-3333-4333-8333-333333333333" }],
          updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { ownerUserId: string } }) => {
            updates.push({ ids: where.id.in, ownerUserId: data.ownerUserId });
            return { count: where.id.in.length };
          },
        },
      }),
    };
    const controller = createController(prisma);

    const result = await controller.distribute(
      { userId: "user-a", orgId: "org-a", organizationRole: "admin", headers: {}, params: {}, path: "/api/v1/leads/distribute" },
      { scope: "selected", leadIds: [first, second, "33333333-3333-4333-8333-333333333333"], assigneeUserIds: [employeeA, employeeB] },
    );

    assert.deepEqual(result, { data: { assignedCount: 3, assigneeCount: 2 } });
    assert.deepEqual(updates, [
      { ids: [first, "33333333-3333-4333-8333-333333333333"], ownerUserId: employeeA },
      { ids: [second], ownerUserId: employeeB },
    ]);
  });

  it("distributes all active leads without widening beyond the verified organization", async () => {
    const employeeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const employeeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let leadWhere: Record<string, unknown> | undefined;
    const updatedOwners: string[] = [];
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        membership: { findMany: async () => [{ userId: employeeA }, { userId: employeeB }] },
        lead: {
          findMany: async ({ where }: { where: Record<string, unknown> }) => {
            leadWhere = where;
            return [{ id: "11111111-1111-4111-8111-111111111111" }, { id: "22222222-2222-4222-8222-222222222222" }];
          },
          updateMany: async ({ data }: { data: { ownerUserId: string } }) => {
            updatedOwners.push(data.ownerUserId);
            return { count: 1 };
          },
        },
      }),
    };

    const result = await createController(prisma).distribute(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads/distribute" },
      { scope: "all", assigneeUserIds: [employeeA, employeeB] },
    );

    assert.deepEqual(result, { data: { assignedCount: 2, assigneeCount: 2 } });
    assert.equal(leadWhere?.organizationId, "org-a");
    assert.equal(leadWhere?.archivedAt, null);
    assert.deepEqual(updatedOwners, [employeeA, employeeB]);
  });

  it("does not allow sales managers to distribute leads", async () => {
    const controller = createController({});
    await assert.rejects(
      controller.distribute(
        { userId: "user-a", orgId: "org-a", organizationRole: "sales_manager", headers: {}, params: {}, path: "/api/v1/leads/distribute" },
        { scope: "all", assigneeUserIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] },
      ),
      ForbiddenException,
    );
  });

  it("uses the persisted round-robin pool to assign newly created leads", async () => {
    const assignedTo = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let createArgs: Record<string, unknown> | undefined;
    const lead = {
      id: "lead-a", name: "Olivia Rhye", company: "Northstar", source: "WEBSITE", status: "NEW",
      ownerUserId: assignedTo, createdAt: new Date(), updatedAt: new Date(), owner: { role: "SALES_REP", user: { name: "Jordan Lee" } },
    };
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        organizationSettings: {
          findUnique: async () => ({
            leadAutoAssignEnabled: true,
            leadAutoAssignUserIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", assignedTo],
          }),
          update: async () => ({ leadAutoAssignCursor: 2 }),
        },
        membership: { findMany: async () => [{ userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { userId: assignedTo }] },
        lead: {
          create: async (args: { data: Record<string, unknown> }) => { createArgs = args.data; return lead; },
        },
      }),
    };
    const controller = new LeadsController(prisma as never, { runForLead: async () => [] } as never);

    await controller.create(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads" },
      { name: "Olivia Rhye", company: "Northstar", source: "website" },
    );

    assert.equal(createArgs?.ownerUserId, assignedTo);
    assert.equal(createArgs?.createdByUserId, "user-a");
  });

  it("validates lead imports without creating records or overwriting likely duplicates", async () => {
    let findManyCalls = 0;
    const controller = createController({
      lead: {
        findMany: async () => { findManyCalls += 1; return []; },
      },
    });

    const result = await controller.validateImport(
      { userId: "user-a", orgId: "org-a", organizationRole: "admin", headers: {}, params: {}, path: "/api/v1/leads/import/validate" },
      { rows: [
        { name: "Olivia", company: "Northstar", source: "website", status: "new" },
        { name: " olivia ", company: " northstar ", source: "bad-source", status: "new" },
      ] },
    );

    assert.equal(result.data.canImport, false);
    assert.ok(result.data.rows.every(({ errors }) => errors.includes("This lead is duplicated in the import file.")));
    assert.equal(findManyCalls, 0);
  });

  it("previews an even assignment proposal without mutating leads", async () => {
    const employeeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const employeeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const controller = createController({
      membership: {
        findMany: async () => [
          { userId: employeeA, user: { name: "Alex" } },
          { userId: employeeB, user: { name: "Blair" } },
        ],
      },
      lead: {
        findMany: async () => [
          { id: "11111111-1111-4111-8111-111111111111", name: "Lead A", owner: { user: { name: "Original" } } },
          { id: "22222222-2222-4222-8222-222222222222", name: "Lead B", owner: { user: { name: "Original" } } },
          { id: "33333333-3333-4333-8333-333333333333", name: "Lead C", owner: { user: { name: "Original" } } },
        ],
      },
    });

    const result = await controller.previewDistribution(
      { userId: "user-a", orgId: "org-a", organizationRole: "admin", headers: {}, params: {}, path: "/api/v1/leads/distribute/preview" },
      { scope: "all", assigneeUserIds: [employeeA, employeeB] },
    );

    assert.deepEqual(result.data.assignments.map(({ owner }) => owner), ["Alex", "Blair", "Alex"]);
  });

  it("applies only balanced assignments to active workspace leads and audits each lead", async () => {
    const employeeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const employeeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const leadA = "11111111-1111-4111-8111-111111111111";
    const leadB = "22222222-2222-4222-8222-222222222222";
    let auditRows: Record<string, unknown>[] | undefined;
    const updates: { leadId: string; ownerUserId: string }[] = [];
    const controller = createController({
      membership: { findMany: async () => [{ userId: employeeA }, { userId: employeeB }] },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
        lead: {
          findMany: async () => [{ id: leadA }, { id: leadB }],
          updateMany: async ({ where, data }: { where: { id: string }; data: { ownerUserId: string } }) => {
            updates.push({ leadId: where.id, ownerUserId: data.ownerUserId });
            return { count: 1 };
          },
        },
        auditLog: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => { auditRows = data; return { count: data.length }; } },
      }),
    });

    const result = await controller.applyDistribution(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads/distribute" },
      { assignments: [{ leadId: leadA, ownerUserId: employeeA }, { leadId: leadB, ownerUserId: employeeB }] },
    );

    assert.deepEqual(result, { data: { assignedCount: 2 } });
    assert.deepEqual(updates, [{ leadId: leadA, ownerUserId: employeeA }, { leadId: leadB, ownerUserId: employeeB }]);
    assert.deepEqual(auditRows?.map(({ resourceType, resourceId }) => [resourceType, resourceId]), [
      ["lead_assignment", leadA],
      ["lead_assignment", leadB],
    ]);
  });

  it("limits lead exports to records owned by sales representatives", async () => {
    let where: Record<string, unknown> | undefined;
    const controller = createController({
      lead: {
        count: async () => 1,
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
      auditLog: { create: async () => undefined },
    });

    await controller.export(
      { userId: "rep-a", orgId: "org-a", organizationRole: "sales_rep", headers: {}, params: {}, path: "/api/v1/leads/export" },
      "north",
      "website",
      "new",
    );

    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.ownerUserId, "rep-a");
    assert.equal(where?.archivedAt, null);
    assert.equal(where?.source, "WEBSITE");
  });

  it("writes each lead call once to the shared tenant-scoped activity timeline", async () => {
    let activityData: Record<string, unknown> | undefined;
    let callData: Record<string, unknown> | undefined;
    const callTime = new Date("2026-11-20T10:00:00.000Z");
    const controller = createController({
      lead: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.organizationId, "org-a");
        return { id: "lead-a", name: "Ada Lovelace" };
      } },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        activity: { create: async ({ data }: { data: Record<string, unknown> }) => {
          activityData = data;
          return { ...data, id: "activity-a" };
        } },
        leadCall: { create: async ({ data }: { data: Record<string, unknown> }) => {
          callData = data;
          return { ...data, id: "call-a", logger: { user: { name: "Alex" } } };
        } },
        lead: { updateMany: async () => ({ count: 1 }) },
        auditLog: { create: async () => undefined },
      }),
    });

    const result = await controller.logCall(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads/lead-a/calls" },
      "lead-a",
      { callStatus: "connected", durationSeconds: 80, customerResponse: "Interested", nextAction: "Send proposal" },
    );

    assert.equal(activityData?.organizationId, "org-a");
    assert.equal(activityData?.relatedToType, "LEAD");
    assert.equal(activityData?.relatedToId, "lead-a");
    assert.equal(activityData?.createdByUserId, "user-a");
    assert.equal(activityData?.type, "CALL");
    assert.equal(callData?.activityId, "activity-a");
    assert.equal(callData?.calledAt, activityData?.createdAt);
    assert.equal((result.data as { activity: { id: string } }).activity.id, "activity-a");
  });

  it("loads a lead timeline using the active workspace and lead relationship", async () => {
    let timelineWhere: Record<string, unknown> | undefined;
    const createdAt = new Date("2026-11-20T10:00:00.000Z");
    const controller = createController({
      lead: { findFirst: async () => ({
        id: "lead-a", name: "Ada Lovelace", company: "Analytical Engines", source: "WEBSITE", status: "NEW",
        createdAt, updatedAt: createdAt, ownerUserId: "user-a", owner: { role: "OWNER", user: { name: "Alex" } }, calls: [],
      }) },
      activity: { findMany: async ({ where }: { where: Record<string, unknown> }) => {
        timelineWhere = where;
        return [{
          id: "activity-a", type: "CALL", title: "Call with Ada Lovelace", description: "Call status: connected",
          status: "COMPLETED", priority: "NORMAL", dueAt: createdAt, createdAt,
          creator: { user: { name: "Alex" } }, assignee: { user: { name: "Alex" } },
          leadCall: { callStatus: "connected", durationSeconds: 80, customerResponse: "Interested", nextAction: "Send proposal", followUpAt: null },
        }];
      } },
    });

    const result = await controller.get(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/leads/lead-a" },
      "lead-a",
    );

    assert.deepEqual(timelineWhere, { organizationId: "org-a", relatedToType: "LEAD", relatedToId: "lead-a", archivedAt: null });
    const data = result.data as { activities: { id: string; call: { status: string; durationSeconds: number | null } }[] };
    assert.equal(data.activities.length, 1);
    assert.equal(data.activities[0]?.id, "activity-a");
    assert.equal(data.activities[0]?.call.status, "connected");
    assert.equal(data.activities[0]?.call.durationSeconds, 80);
  });
});
