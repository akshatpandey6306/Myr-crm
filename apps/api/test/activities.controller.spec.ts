import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ActivitiesController } from "../src/activities/activities.controller.js";

describe("ActivitiesController", () => {
  it("scopes reads to the verified organization", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      activity: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    };
    const controller = new ActivitiesController(prisma as never);
    const result = await controller.list(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/activities" },
      undefined, "open", "task", "normal", "1", "10", "createdAt", "desc",
    );
    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.status, "OPEN");
    assert.equal(where?.type, "TASK");
    assert.equal(where?.priority, "NORMAL");
    assert.equal(result.meta.total, 0);
  });

  it("creates an activity with server-controlled fields", async () => {
    let args: Record<string, unknown> | undefined;
    const activity = { id: "act-a", organizationId: "org-a", type: "TASK", title: "Follow up", status: "OPEN", priority: "NORMAL", description: null, dueAt: null, completedAt: null, assignedToUserId: null, relatedToType: null, relatedToId: null, createdByUserId: "user-a", createdAt: new Date(), updatedAt: new Date() };
    const prisma = { activity: { create: async (value: Record<string, unknown>) => { args = value; return activity; }, membership: { findUnique: async () => ({ status: "ACTIVE" }) } } };
    // membership is on prisma root in our controller; adjust
    (prisma as any).membership = { findUnique: async () => ({ status: "ACTIVE" }) };
    const controller = new ActivitiesController(prisma as never);
    const result = await controller.create(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/activities" },
      { title: "Follow up", type: "task" },
    );
    const data = (args as any)?.data;
    assert.equal(data.organizationId, "org-a");
    assert.equal(data.createdByUserId, "user-a");
    assert.equal(data.title, "Follow up");
    assert.equal(result.id, "act-a");
  });

  it("returns not found for an activity outside the organization", async () => {
    const prisma = { activity: { findFirst: async () => null } };
    const controller = new ActivitiesController(prisma as never);
    await assert.rejects(() => controller.get(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/activities/x" },
      "act-other",
    ), NotFoundException);
  });

  it("blocks read-only mutations", async () => {
    const prisma = { activity: {} };
    const controller = new ActivitiesController(prisma as never);
    await assert.rejects(() => controller.create(
      { userId: "user-a", orgId: "org-a", organizationRole: "read_only", headers: {}, params: {}, path: "/api/v1/activities" },
      { title: "x" },
    ), ForbiddenException);
  });
});
