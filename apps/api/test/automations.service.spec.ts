import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AutomationsService } from "../src/automations/automations.service.js";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorUserId = "11111111-1111-4111-8111-111111111111";
const leadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ruleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const event = {
  organizationId,
  actorUserId,
  leadId,
  leadName: "Olivia Rhye",
  leadOwnerUserId: actorUserId,
  status: "QUALIFIED" as const,
  event: "lead_status_changed" as const,
};

describe("AutomationsService", () => {
  it("creates a linked follow-up task and run record for a matching status rule", async () => {
    let activityArgs: Record<string, unknown> | undefined;
    let runArgs: Record<string, unknown> | undefined;
    const tx = {
      automationRule: {
        findMany: async (args: Record<string, unknown>) => {
          assert.deepEqual(args.where, {
            organizationId,
            trigger: "LEAD_STATUS_CHANGED",
            enabled: true,
            archivedAt: null,
          });
          return [{
            id: ruleId,
            trigger: "LEAD_STATUS_CHANGED",
            triggerStatus: "QUALIFIED",
            activityTitle: "Follow up with {{leadName}}",
            activityPriority: "HIGH",
            dueInDays: 2,
          }];
        },
      },
      automationRun: {
        findUnique: async () => null,
        create: async (args: Record<string, unknown>) => { runArgs = args; return {}; },
      },
      activity: {
        create: async (args: Record<string, unknown>) => { activityArgs = args; return { id: "activity-id" }; },
      },
    };

    await new AutomationsService().runForLead(tx as never, event);

    const data = activityArgs?.data as Record<string, unknown>;
    assert.equal(data.title, "Follow up with Olivia Rhye");
    assert.equal(data.organizationId, organizationId);
    assert.equal(data.createdByUserId, actorUserId);
    assert.equal(data.assignedToUserId, actorUserId);
    assert.equal(data.relatedToType, "LEAD");
    assert.equal(data.relatedToId, leadId);
    assert.equal(data.priority, "HIGH");
    assert.ok(data.dueAt instanceof Date);
    assert.deepEqual(runArgs?.data, {
      organizationId,
      ruleId,
      leadId,
      activityId: "activity-id",
    });
  });

  it("runs lead-created rules and records the generated task", async () => {
    let ruleQuery: Record<string, unknown> | undefined;
    let activityCount = 0;
    let runCount = 0;
    const tx = {
      automationRule: {
        findMany: async (args: Record<string, unknown>) => {
          ruleQuery = args.where;
          return [{
            id: ruleId,
            trigger: "LEAD_CREATED",
            triggerStatus: null,
            activityTitle: "Welcome {{leadName}}",
            activityPriority: "NORMAL",
            dueInDays: 0,
          }];
        },
      },
      automationRun: {
        findUnique: async () => null,
        create: async () => { runCount += 1; return {}; },
      },
      activity: {
        create: async () => { activityCount += 1; return { id: "activity-id" }; },
      },
    };

    await new AutomationsService().runForLead(tx as never, {
      ...event,
      event: "lead_created",
      status: "NEW",
    });

    assert.deepEqual(ruleQuery, {
      organizationId,
      trigger: "LEAD_CREATED",
      enabled: true,
      archivedAt: null,
    });
    assert.equal(activityCount, 1);
    assert.equal(runCount, 1);
  });

  it("does not execute a rule for a different lead status or an already-run lead", async () => {
    let activityCount = 0;
    const tx = {
      automationRule: {
        findMany: async () => [{
          id: ruleId,
          trigger: "LEAD_STATUS_CHANGED",
          triggerStatus: "CONTACTED",
          activityTitle: "Follow up",
          activityPriority: "NORMAL",
          dueInDays: 1,
        }],
      },
      automationRun: { findUnique: async () => null },
      activity: { create: async () => { activityCount += 1; return { id: "activity-id" }; } },
    };
    const service = new AutomationsService();
    await service.runForLead(tx as never, event);
    assert.equal(activityCount, 0);

    tx.automationRule.findMany = async () => [{
      id: ruleId,
      trigger: "LEAD_STATUS_CHANGED",
      triggerStatus: "QUALIFIED",
      activityTitle: "Follow up",
      activityPriority: "NORMAL",
      dueInDays: 1,
    }];
    tx.automationRun.findUnique = async () => ({ id: "existing-run" });
    await service.runForLead(tx as never, event);
    assert.equal(activityCount, 0);
  });
});
