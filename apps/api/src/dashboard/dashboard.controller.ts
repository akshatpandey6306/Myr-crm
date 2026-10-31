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

    const [totalLeads, openDeals, pipelineTotals, wonDeals, pipelines, recentDeals] = await Promise.all([
      this.prisma.lead.count({ where: leadWhere }),
      this.prisma.deal.count({ where: openDealsWhere }),
      this.prisma.deal.aggregate({ where: openDealsWhere, _sum: { value: true } }),
      this.prisma.deal.count({ where: { ...dealWhere, status: "WON" } }),
      this.prisma.pipeline.findMany({
        where: { organizationId },
        include: { stages: { orderBy: { position: "asc" } } },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      }),
      this.prisma.deal.findMany({
        where: openDealsWhere,
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          company: { select: { name: true } },
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
          owner: { include: { user: { select: { name: true } } } },
        },
      }),
    ]);

    const stageTotals = await this.prisma.deal.groupBy({
      by: ["pipelineId", "stageId"],
      where: openDealsWhere,
      _sum: { value: true },
    });

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
        },
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
