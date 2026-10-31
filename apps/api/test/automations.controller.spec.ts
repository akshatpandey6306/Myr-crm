import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AutomationsController } from "../src/automations/automations.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ruleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const request = (role: "owner" | "admin" | "sales_manager" | "sales_rep" | "read_only" = "owner") => ({
  userId,
  orgId: organizationId,
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/automations",
});

const rule = (overrides: Record<string, unknown> = {}) => ({
  id: ruleId,
  name: "Qualified lead follow-up",
  trigger: "LEAD_STATUS_CHANGED",
  triggerStatus: "QUALIFIED",
  activityTitle: "Follow up with {{leadName}}",
  activityPriority: "HIGH",
  dueInDays: 2,
  enabled: true,
  createdAt: new Date("2026-10-29T10:00:00.000Z"),
  _count: { runs: 3 },
  runs: [{ ranAt: new Date("2026-10-29T10:30:00.000Z") }],
  ...overrides,
});

describe("AutomationsController", () => {
  it("lists rules only for the verified organization and presents run metadata", async () => {
    let args: Record<string, unknown> | undefined;
    const controller = new AutomationsController({
      automationRule: { findMany: async (value: Record<string, unknown>) => { args = value; return [rule()]; } },
    } as never);

    const result = await controller.list(request());

    assert.deepEqual(args?.where, { organizationId, archivedAt: null });
    assert.equal(result.data[0].triggerStatus, "qualified");
    assert.equal(result.data[0].runCount, 3);
    assert.equal(result.data[0].lastRunAt, "2026-10-29T10:30:00.000Z");
  });

  it("creates a rule using verified organization and creator IDs", async () => {
    let args: Record<string, unknown> | undefined;
    const controller = new AutomationsController({
      automationRule: { create: async (value: Record<string, unknown>) => { args = value; return rule(); } },
    } as never);

    await controller.create(request(), {
      name: "  Qualified lead follow-up ",
      trigger: "lead_status_changed",
      triggerStatus: "qualified",
      activityTitle: " Follow up with {{leadName}} ",
      activityPriority: "high",
      dueInDays: 2,
      organizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      createdByUserId: "22222222-2222-4222-8222-222222222222",
    });

    const data = args?.data as Record<string, unknown>;
    assert.equal(data.organizationId, organizationId);
    assert.equal(data.createdByUserId, userId);
    assert.equal(data.name, "Qualified lead follow-up");
    assert.equal(data.trigger, "LEAD_STATUS_CHANGED");
    assert.equal(data.triggerStatus, "QUALIFIED");
    assert.equal(data.activityPriority, "HIGH");
  });

  it("rejects status triggers without a status and due dates outside the supported range", async () => {
    const controller = new AutomationsController({ automationRule: {} } as never);
    await assert.rejects(
      controller.create(request(), {
        name: "Follow up",
        trigger: "lead_status_changed",
        activityTitle: "Follow up",
      }),
      BadRequestException,
    );
    await assert.rejects(
      controller.create(request(), {
        name: "Follow up",
        trigger: "lead_created",
        activityTitle: "Follow up",
        dueInDays: 366,
      }),
      BadRequestException,
    );
  });

  it("allows only managers to create or change automation rules", async () => {
    const controller = new AutomationsController({ automationRule: {} } as never);
    await assert.rejects(
      controller.create(request("sales_rep"), {
        name: "Follow up",
        trigger: "lead_created",
        activityTitle: "Follow up",
      }),
      ForbiddenException,
    );
    await assert.rejects(
      controller.update(request("read_only"), ruleId, { enabled: false }),
      ForbiddenException,
    );
  });

  it("updates and archives rules within the verified organization", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const controller = new AutomationsController({
      automationRule: {
        updateMany: async (value: Record<string, unknown>) => { updateArgs = value; return { count: 1 }; },
        findFirst: async () => rule({ enabled: false }),
      },
    } as never);

    await controller.update(request("admin"), ruleId, { enabled: false });
    assert.deepEqual(updateArgs?.where, { id: ruleId, organizationId, archivedAt: null });
    assert.deepEqual(updateArgs?.data, { enabled: false });

    await controller.archive(request("admin"), ruleId);
    assert.deepEqual(updateArgs?.where, { id: ruleId, organizationId, archivedAt: null });
    assert.equal((updateArgs?.data as Record<string, unknown>).enabled, false);
    assert.ok((updateArgs?.data as Record<string, unknown>).archivedAt instanceof Date);
  });

  it("returns not found instead of exposing a rule from another organization", async () => {
    const controller = new AutomationsController({
      automationRule: { updateMany: async () => ({ count: 0 }) },
    } as never);
    await assert.rejects(controller.archive(request(), ruleId), NotFoundException);
  });

  it("returns recent runs only after checking rule ownership in the active organization", async () => {
    let runWhere: Record<string, unknown> | undefined;
    const controller = new AutomationsController({
      automationRule: { findFirst: async () => ({ id: ruleId }) },
      automationRun: {
        findMany: async (args: Record<string, unknown>) => {
          runWhere = args.where;
          return [{
            id: "run-id",
            leadId: "lead-id",
            activityId: "activity-id",
            ranAt: new Date("2026-10-29T10:30:00.000Z"),
            lead: { id: "lead-id", name: "Olivia", company: "Northstar" },
          }];
        },
      },
    } as never);

    const result = await controller.runs(request(), ruleId);

    assert.deepEqual(runWhere, { ruleId, organizationId });
    assert.equal(result.data[0].leadName, "Olivia");
    assert.equal(result.data[0].activityId, "activity-id");
  });
});
