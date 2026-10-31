import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReportsController } from "../src/reports/reports.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const request = (role: "owner" | "sales_rep" = "owner") => ({
  userId,
  orgId: organizationId,
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/reports/summary",
});

describe("ReportsController", () => {
  it("returns CRM aggregates scoped to the organization and representative", async () => {
    const filters: Record<string, Record<string, unknown>> = {};
    const prisma = {
      lead: {
        groupBy: async (args: { where: Record<string, unknown> }) => {
          filters.leads = args.where;
          return [{ status: "QUALIFIED", _count: { _all: 3 } }];
        },
      },
      deal: {
        groupBy: async (args: { where: Record<string, unknown> }) => {
          filters.deals = args.where;
          return [
            { status: "OPEN", _count: { _all: 2 }, _sum: { value: "1250.50" } },
            { status: "WON", _count: { _all: 1 }, _sum: { value: "700.00" } },
          ];
        },
      },
      activity: {
        groupBy: async (args: { where: Record<string, unknown> }) => {
          filters.activities = args.where;
          return [
            { status: "OPEN", _count: { _all: 2 } },
            { status: "IN_PROGRESS", _count: { _all: 1 } },
            { status: "COMPLETED", _count: { _all: 4 } },
          ];
        },
      },
    };
    const controller = new ReportsController(prisma as never);

    const result = await controller.summary(request("sales_rep"));

    for (const where of Object.values(filters)) {
      assert.equal(where.organizationId, organizationId);
      assert.equal(where.archivedAt, null);
    }
    assert.equal(filters.leads.ownerUserId, userId);
    assert.equal(filters.deals.ownerUserId, userId);
    assert.equal(filters.activities.assignedToUserId, userId);
    assert.deepEqual(result.data.metrics, {
      totalLeads: 3,
      openDeals: 2,
      openPipelineValue: "1250.50",
      wonRevenue: "700.00",
      openActivities: 3,
      completedActivities: 4,
    });
  });
});