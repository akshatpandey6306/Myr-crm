import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ActivitiesController } from "../src/activities/activities.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const recordId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const request = (role: "owner" | "admin" | "sales_manager" | "sales_rep" | "read_only" = "owner") => ({
  userId,
  orgId: organizationId,
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/activities",
});

const activity = (overrides: Record<string, unknown> = {}) => ({
  id: recordId,
  organizationId,
  type: "TASK",
  title: "Follow up",
  description: null,
  status: "OPEN",
  priority: "NORMAL",
  dueAt: null,
  completedAt: null,
  assignedToUserId: userId,
  relatedToType: null,
  relatedToId: null,
  createdByUserId: userId,
  createdAt: new Date("2026-10-28T10:00:00.000Z"),
  updatedAt: new Date("2026-10-28T10:00:00.000Z"),
  assignee: { user: { id: userId, name: "Alex Morgan" } },
  creator: { user: { id: userId, name: "Alex Morgan" } },
  ...overrides,
});

describe("ActivitiesController", () => {
  it("scopes lists, filters, sorts, and paginates by verified organization", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      activity: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    };
    const controller = new ActivitiesController(prisma as never);
    const result = await controller.list(
      request(),
      "follow",
      "task",
      "open",
      "high",
      undefined,
      undefined,
      undefined,
      "2",
      "10",
      "dueAt",
      "desc",
    );

    assert.equal(where?.organizationId, organizationId);
    assert.equal(where?.archivedAt, null);
    assert.deepEqual(where?.OR, [
      { title: { contains: "follow", mode: "insensitive" } },
      { description: { contains: "follow", mode: "insensitive" } },
    ]);
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 10);
    assert.equal(result.meta.total, 0);
  });

  it("limits sales representative reads to assigned activities", async () => {
    let listWhere: Record<string, unknown> | undefined;
    let getWhere: Record<string, unknown> | undefined;
    const prisma = {
      activity: {
        count: async (args: { where: Record<string, unknown> }) => { listWhere = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { listWhere = args.where; return []; },
        findFirst: async (args: { where: Record<string, unknown> }) => { getWhere = args.where; return activity(); },
      },
    };
    const controller = new ActivitiesController(prisma as never);

    await controller.list(request("sales_rep"));
    await controller.get(request("sales_rep"), recordId);

    assert.equal(listWhere?.assignedToUserId, userId);
    assert.equal(getWhere?.organizationId, organizationId);
    assert.equal(getWhere?.assignedToUserId, userId);
  });

  it("rejects a representative filter that attempts to select another assignee", async () => {
    const controller = new ActivitiesController({ activity: {} } as never);
    await assert.rejects(
      controller.list(request("sales_rep"), undefined, undefined, undefined, undefined, otherUserId),
      ForbiddenException,
    );
  });

  it("creates activities with server-controlled tenant, creator, and default assignee", async () => {
    let args: Record<string, unknown> | undefined;
    const prisma = {
      membership: { findFirst: async () => ({ userId }) },
      activity: {
        create: async (value: Record<string, unknown>) => {
          args = value;
          return activity({ type: "CALL", title: "Call customer" });
        },
      },
    };
    const controller = new ActivitiesController(prisma as never);
    const result = await controller.create(request(), {
      type: "call",
      title: " Call customer ",
      organizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      createdByUserId: otherUserId,
      assignedToUserId: otherUserId,
    });

    const data = args?.data as Record<string, unknown>;
    assert.equal(data.organizationId, organizationId);
    assert.equal(data.createdByUserId, userId);
    assert.equal(data.assignedToUserId, otherUserId);
    assert.equal(data.title, "Call customer");
    assert.equal(result.data.type, "call");
  });

  it("requires related record type and ID together", async () => {
    const controller = new ActivitiesController({ activity: {} } as never);
    await assert.rejects(
      controller.create(request(), { type: "task", title: "Follow up", relatedToType: "lead" }),
      BadRequestException,
    );
  });

  it("rejects a related record outside the active organization", async () => {
    const prisma = {
      membership: { findFirst: async () => ({ userId }) },
      lead: { findFirst: async () => null },
      activity: {},
    };
    const controller = new ActivitiesController(prisma as never);
    await assert.rejects(
      controller.create(request(), {
        type: "task",
        title: "Follow up",
        relatedToType: "lead",
        relatedToId: recordId,
      }),
      BadRequestException,
    );
  });

  it("sets and clears completedAt as status changes", async () => {
    let patch: Record<string, unknown> | undefined;
    let calls = 0;
    const prisma = {
      activity: {
        findFirst: async () => {
          calls += 1;
          return calls === 1 ? { completedAt: null } : activity({
            status: "COMPLETED",
            completedAt: patch?.completedAt,
          });
        },
        updateMany: async (args: { data: Record<string, unknown> }) => {
          patch = args.data;
          return { count: 1 };
        },
      },
    };
    const controller = new ActivitiesController(prisma as never);
    await controller.update(request(), recordId, { status: "completed" });

    assert.equal(patch?.status, "COMPLETED");
    assert.ok(patch?.completedAt instanceof Date);
  });

  it("prevents representatives from changing activity assignments", async () => {
    const controller = new ActivitiesController({ activity: {} } as never);
    await assert.rejects(
      controller.update(request("sales_rep"), recordId, { assignedToUserId: otherUserId }),
      ForbiddenException,
    );
  });

  it("archives activities only inside the verified organization", async () => {
    let args: { where: Record<string, unknown>; data: Record<string, unknown> } | undefined;
    const prisma = {
      activity: {
        updateMany: async (value: typeof args) => {
          args = value;
          return { count: 1 };
        },
      },
    };
    const controller = new ActivitiesController(prisma as never);

    assert.deepEqual(await controller.archive(request(), recordId), { ok: true });
    assert.equal(args?.where.id, recordId);
    assert.equal(args?.where.organizationId, organizationId);
    assert.equal(args?.where.archivedAt, null);
    assert.ok(args?.data.archivedAt instanceof Date);
  });

  it("returns not found for an activity outside the verified organization", async () => {
    const controller = new ActivitiesController({
      activity: { updateMany: async () => ({ count: 0 }) },
    } as never);
    await assert.rejects(controller.archive(request(), recordId), NotFoundException);
  });
});
