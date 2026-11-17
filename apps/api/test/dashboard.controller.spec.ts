import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { DashboardController } from "../src/dashboard/dashboard.controller.js";

describe("DashboardController", () => {
  it("scopes summary queries to the verified organization and representative's records", async () => {
    const countQueries: { where: Record<string, unknown> }[] = [];
    const aggregateWheres: Record<string, unknown>[] = [];
    let groupByWhere: Record<string, unknown> | undefined;
    let pipelineWhere: Record<string, unknown> | undefined;
    let recentWhere: Record<string, unknown> | undefined;
    const prisma = {
      lead: {
        count: async (args: { where: Record<string, unknown> }) => { countQueries.push(args); return 7; },
        groupBy: async () => [{ status: "NEW", _count: { _all: 7 } }],
      },
      deal: {
        count: async (args: { where: Record<string, unknown> }) => { countQueries.push(args); return 3; },
        aggregate: async (args: { where: Record<string, unknown> }) => { aggregateWheres.push(args.where); return { _sum: { value: "4200" } }; },
        groupBy: async (args: { by?: string[]; where: Record<string, unknown> }) => {
          groupByWhere = args.where;
          return args.by?.includes("status")
            ? [
              { status: "OPEN", _count: { _all: 3 }, _sum: { value: "4200" } },
              { status: "WON", _count: { _all: 3 }, _sum: { value: "4200" } },
            ]
            : [{ pipelineId: "pipeline-a", stageId: "stage-a", _sum: { value: "4200" } }];
        },
        findMany: async (args: { where: Record<string, unknown> }) => {
          recentWhere = args.where;
          return [{
            id: "deal-a",
            name: "Expansion",
            value: "4200",
            company: { name: "Northwind" },
            pipeline: { name: "Sales" },
            stage: { name: "Qualified" },
            owner: { user: { name: "Maya Chen" } },
          }];
        },
      },
      pipeline: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          pipelineWhere = args.where;
          return [{ id: "pipeline-a", name: "Sales", stages: [{ id: "stage-a", name: "Qualified", position: 0 }] }];
        },
      },
      activity: { groupBy: async () => [{ status: "OPEN", _count: { _all: 2 } }] },
    };
    const controller = new DashboardController(prisma as never);

    const response = await controller.summary({
      orgId: "org-a",
      userId: "user-a",
      organizationRole: "sales_rep",
    } as never);

    assert.deepEqual(countQueries.map(({ where }) => where), [
      { organizationId: "org-a", archivedAt: null, ownerUserId: "user-a" },
      { organizationId: "org-a", archivedAt: null, ownerUserId: "user-a", status: "OPEN" },
      { organizationId: "org-a", archivedAt: null, ownerUserId: "user-a", status: "WON" },
    ]);
    assert.deepEqual(aggregateWheres, [
      { organizationId: "org-a", archivedAt: null, ownerUserId: "user-a", status: "OPEN" },
      { organizationId: "org-a", archivedAt: null, ownerUserId: "user-a", status: "WON" },
    ]);
    assert.deepEqual(groupByWhere, { organizationId: "org-a", archivedAt: null, ownerUserId: "user-a", status: "OPEN" });
    assert.deepEqual(recentWhere, { organizationId: "org-a", archivedAt: null, ownerUserId: "user-a", status: "OPEN" });
    assert.deepEqual(pipelineWhere, { organizationId: "org-a" });
    assert.deepEqual(response, {
      data: {
        metrics: {
          totalLeads: 7,
          openDeals: 3,
          pipelineValue: 4200,
          wonDeals: 3,
          openPipelineValue: "4200.00",
          wonRevenue: "4200.00",
          openActivities: 2,
          completedActivities: 0,
        },
        leadsByStatus: [{ status: "new", count: 7 }],
        dealsByStatus: [
          { status: "open", count: 3, value: "4200" },
          { status: "won", count: 3, value: "4200" },
        ],
        activitiesByStatus: [{ status: "open", count: 2 }],
        pipeline: [{ id: "stage-a", label: "Sales · Qualified", value: 4200, color: "#3678D4" }],
        recentDeals: [{
          id: "deal-a",
          company: "Northwind",
          name: "Expansion",
          owner: "Maya Chen",
          stage: "Qualified",
          amount: 4200,
        }],
      },
    });
  });

  it("requires a verified organization context", async () => {
    const controller = new DashboardController({} as never);
    await assert.rejects(controller.summary({} as never), UnauthorizedException);
  });

  it("does not include dashboard data from disabled lead and deal modules", async () => {
    const controller = new DashboardController({} as never);
    const response = await controller.summary({
      orgId: "org-a",
      userId: "user-a",
      enabledModules: [],
    } as never);

    assert.deepEqual(response, {
      data: {
        metrics: {
          totalLeads: 0,
          openDeals: 0,
          pipelineValue: 0,
          wonDeals: 0,
          openPipelineValue: "0.00",
          wonRevenue: "0.00",
          openActivities: 0,
          completedActivities: 0,
        },
        leadsByStatus: [],
        dealsByStatus: [],
        activitiesByStatus: [],
        pipeline: [],
        recentDeals: [],
      },
    });
  });
});
