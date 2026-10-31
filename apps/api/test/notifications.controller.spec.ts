import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { NotificationsController } from "../src/notifications/notifications.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const notificationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const request = () => ({
  userId,
  orgId: organizationId,
  organizationRole: "sales_rep" as const,
  headers: {},
  params: {},
  path: "/api/v1/notifications",
});

describe("NotificationsController", () => {
  it("lists only the authenticated recipient's organization notifications", async () => {
    let listWhere: Record<string, unknown> | undefined;
    let countWhere: Record<string, unknown> | undefined;
    const controller = new NotificationsController({
      notification: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          listWhere = args.where;
          return [{
            id: notificationId,
            type: "ACTIVITY_ASSIGNED",
            title: "Activity assigned to you",
            body: "Follow up",
            activityId: notificationId,
            readAt: null,
            createdAt: new Date("2026-10-30T12:00:00.000Z"),
          }];
        },
        count: async (args: { where: Record<string, unknown> }) => {
          countWhere = args.where;
          return 1;
        },
      },
    } as never);

    const result = await controller.list(request());

    assert.deepEqual(listWhere, { organizationId, recipientUserId: userId });
    assert.deepEqual(countWhere, { organizationId, recipientUserId: userId, readAt: null });
    assert.equal(result.meta.unreadCount, 1);
    assert.equal(result.data[0].type, "activity_assigned");
  });

  it("does not mark another member's notification as read", async () => {
    let updateWhere: Record<string, unknown> | undefined;
    let lookupWhere: Record<string, unknown> | undefined;
    const controller = new NotificationsController({
      notification: {
        updateMany: async (args: { where: Record<string, unknown> }) => { updateWhere = args.where; return { count: 0 }; },
        findFirst: async (args: { where: Record<string, unknown> }) => { lookupWhere = args.where; return null; },
      },
    } as never);

    await assert.rejects(controller.markRead(request(), notificationId), NotFoundException);
    assert.equal(updateWhere?.organizationId, organizationId);
    assert.equal(updateWhere?.recipientUserId, userId);
    assert.equal(lookupWhere?.recipientUserId, userId);
  });

  it("marks all unread notifications only for the current member", async () => {
    let where: Record<string, unknown> | undefined;
    const controller = new NotificationsController({
      notification: { updateMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return { count: 2 }; } },
    } as never);

    assert.deepEqual(await controller.markAllRead(request()), { ok: true, updated: 2 });
    assert.deepEqual(where, { organizationId, recipientUserId: userId, readAt: null });
  });
});