import { Controller, Get, Inject, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { assignedOwnerFilter } from "../auth/record-permissions.js";
import { PrismaService } from "../prisma/prisma.service.js";

const chartColors = ["#3678D4", "#8254C7", "#E56F4A", "#24936F", "#D1A832", "#3B9A9A"];

@Controller("dashboard")
export class DashboardController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("summary")
  async summary(@Req() request: HttpRequest) {
    const organizationId = this.organizationId(request);
    const ownerUserId = assignedOwnerFilter(request);
    const leadsEnabled = request.enabledModules?.includes("leads") ?? true;
    const dealsEnabled = request.enabledModules?.includes("deals") ?? true;
    const activitiesEnabled = request.enabledModules?.includes("activities") ?? true;
    const leadWhere = {
      organizationId,
      archivedAt: null,
      ...(ownerUserId ? { ownerUserId } : {}),
    };
    const dealWhere = {
      organizationId,
      archivedAt: null,
      ...(ownerUserId ? { ownerUserId } : {}),
    };
    const openDealsWhere = { ...dealWhere, status: "OPEN" as const };
    const activityWhere = {
      organizationId,
      archivedAt: null,
      ...(activitiesEnabled && request.organizationRole === "sales_rep" ? { assignedToUserId: request.userId } : {}),
    };

    const [totalLeads, openDeals, pipelineTotals, wonDeals, wonTotals, pipelines, recentDeals, leadsByStatus, dealsByStatus, activitiesByStatus] = await Promise.all([
      leadsEnabled ? this.prisma.lead.count({ where: leadWhere }) : Promise.resolve(0),
      dealsEnabled ? this.prisma.deal.count({ where: openDealsWhere }) : Promise.resolve(0),
      dealsEnabled ? this.prisma.deal.aggregate({ where: openDealsWhere, _sum: { value: true } }) : Promise.resolve({ _sum: { value: 0 } }),
      dealsEnabled ? this.prisma.deal.count({ where: { ...dealWhere, status: "WON" } }) : Promise.resolve(0),
      dealsEnabled ? this.prisma.deal.aggregate({ where: { ...dealWhere, status: "WON" }, _sum: { value: true } }) : Promise.resolve({ _sum: { value: 0 } }),
      dealsEnabled ? this.prisma.pipeline.findMany({
        where: { organizationId },
        include: { stages: { orderBy: { position: "asc" } } },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      }) : Promise.resolve([]),
      dealsEnabled ? this.prisma.deal.findMany({
        where: openDealsWhere,
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          company: { select: { name: true } },
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
          owner: { include: { user: { select: { name: true } } } },
        },
      }) : Promise.resolve([]),
      leadsEnabled ? this.prisma.lead.groupBy({ by: ["status"], where: leadWhere, _count: { _all: true } }) : Promise.resolve([]),
      dealsEnabled ? this.prisma.deal.groupBy({ by: ["status"], where: dealWhere, _count: { _all: true }, _sum: { value: true } }) : Promise.resolve([]),
      activitiesEnabled ? this.prisma.activity.groupBy({ by: ["status"], where: activityWhere, _count: { _all: true } }) : Promise.resolve([]),
    ]);

    const stageTotals = dealsEnabled ? await this.prisma.deal.groupBy({
      by: ["pipelineId", "stageId"],
      where: openDealsWhere,
      _sum: { value: true },
    }) : [];

    const pipeline = pipelines.flatMap((item) =>
      item.stages.map((stage, index) => {
        const total = stageTotals.find((row) => row.pipelineId === item.id && row.stageId === stage.id)?._sum.value;
        return {
          id: stage.id,
          label: `${item.name} · ${stage.name}`,
          value: Number(total ?? 0),
          color: chartColors[index % chartColors.length],
        };
      }),
    );

    return {
      data: {
        metrics: {
          totalLeads,
          openDeals,
          pipelineValue: Number(pipelineTotals._sum.value ?? 0),
          wonDeals,
          openPipelineValue: Number(dealsByStatus.find(({ status }) => status === "OPEN")?._sum.value ?? 0).toFixed(2),
          wonRevenue: Number(wonTotals._sum.value ?? 0).toFixed(2),
          openActivities: activitiesByStatus.filter(({ status }) => status === "OPEN" || status === "IN_PROGRESS").reduce((sum, item) => sum + item._count._all, 0),
          completedActivities: activitiesByStatus.find(({ status }) => status === "COMPLETED")?._count._all ?? 0,
        },
        leadsByStatus: leadsByStatus.map(({ status, _count }) => ({ status: status.toLowerCase(), count: _count._all })),
        dealsByStatus: dealsByStatus.map(({ status, _count, _sum }) => ({ status: status.toLowerCase(), count: _count._all, value: _sum.value?.toString() ?? "0" })),
        activitiesByStatus: activitiesByStatus.map(({ status, _count }) => ({ status: status.toLowerCase(), count: _count._all })),
        pipeline,
        recentDeals: recentDeals.map((deal) => ({
          id: deal.id,
          company: deal.company?.name ?? "No company",
          name: deal.name,
          owner: deal.owner.user.name,
          stage: deal.stage.name,
          amount: Number(deal.value),
        })),
      },
    };
  }

  private organizationId(request: HttpRequest) {
    if (!request.orgId || !request.userId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }
    return request.orgId;
  }
}
