import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { AuditLogsController } from "../src/audit-logs/audit-logs.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const request = (role: "owner" | "sales_rep" | "sales_manager" = "owner") => ({
  userId,
  orgId: organizationId,
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/audit-logs",
});

describe("AuditLogsController", () => {
  it("returns paginated events only for the verified organization", async () => {
    let where: Record<string, unknown> | undefined;
    const controller = new AuditLogsController({
      auditLog: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 1; },
        findMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where;
          return [{
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            action: "CREATE",
            resourceType: "leads",
            resourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            actorUserId: userId,
            createdAt: new Date("2026-10-30T12:00:00.000Z"),
            actor: { user: { name: "Alex Morgan" } },
          }];
        },
      },
    } as never);

    const result = await controller.list(request(), "2", "10");

    assert.deepEqual(where, { organizationId });
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 10);
    assert.equal(result.data[0].actorName, "Alex Morgan");
    assert.equal(result.data[0].action, "create");
  });

  it("applies action, resource, actor, and UTC time filters within the selected organization", async () => {
    let where: Record<string, unknown> | undefined;
    const controller = new AuditLogsController({
      auditLog: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    } as never);

    await controller.list(
      request(), "1", "25", "update", "deals", "Maya", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z",
    );

    assert.deepEqual(where, {
      organizationId,
      action: "UPDATE",
      resourceType: { contains: "deals", mode: "insensitive" },
      actor: { is: { user: { is: { name: { contains: "Maya", mode: "insensitive" } } } } },
      createdAt: { gte: new Date("2026-10-01T00:00:00.000Z"), lt: new Date("2026-11-01T00:00:00.000Z") },
    });
  });

  it("rejects unsupported actions and invalid date ranges", async () => {
    const controller = new AuditLogsController({ auditLog: {} } as never);
    await assert.rejects(controller.list(request(), undefined, undefined, "delete"));
    await assert.rejects(controller.list(request(), undefined, undefined, undefined, undefined, undefined, "not-a-date"));
    await assert.rejects(controller.list(request(), undefined, undefined, undefined, undefined, undefined,
      "2026-11-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"));
  });

  it("restricts audit history to Owners and Admins", async () => {
    const controller = new AuditLogsController({ auditLog: {} } as never);
    await assert.rejects(controller.list(request("sales_rep")), ForbiddenException);
    await assert.rejects(controller.list(request("sales_manager")), ForbiddenException);
  });
});
