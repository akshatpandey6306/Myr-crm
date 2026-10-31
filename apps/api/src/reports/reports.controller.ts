import { Controller, Get, Inject, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("reports")
export class ReportsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("summary")
  async summary(@Req() request: HttpRequest) {
    if (!request.orgId || !request.userId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }

    const organizationId = request.orgId;
    const userId = request.userId;
    const leadWhere = {
      organizationId,
      archivedAt: null,
      ...(request.organizationRole === "sales_rep" ? { ownerUserId: userId } : {}),
    };
    const dealWhere = { ...leadWhere };
    const activityWhere = {
      organizationId,
      archivedAt: null,
      ...(request.organizationRole === "sales_rep" ? { assignedToUserId: userId } : {}),
    };

    const [leadsByStatus, dealsByStatus, activitiesByStatus] = await Promise.all([
      this.prisma.lead.groupBy({ by: ["status"], where: leadWhere, _count: { _all: true } }),
      this.prisma.deal.groupBy({ by: ["status"], where: dealWhere, _count: { _all: true }, _sum: { value: true } }),
      this.prisma.activity.groupBy({ by: ["status"], where: activityWhere, _count: { _all: true } }),
    ]);

    const deals = dealsByStatus.map((group) => ({
      status: group.status.toLowerCase(),
      count: group._count._all,
      value: group._sum.value?.toString() ?? "0",
    }));
    const activities = activitiesByStatus.map((group) => ({
      status: group.status.toLowerCase(),
      count: group._count._all,
    }));
    const valueFor = (status: string) => Number(deals.find((group) => group.status === status)?.value ?? 0);

    return {
      data: {
        generatedAt: new Date().toISOString(),
        metrics: {
          totalLeads: leadsByStatus.reduce((total, group) => total + group._count._all, 0),
          openDeals: deals.find((group) => group.status === "open")?.count ?? 0,
          openPipelineValue: valueFor("open").toFixed(2),
          wonRevenue: valueFor("won").toFixed(2),
          openActivities: activities
            .filter((group) => group.status === "open" || group.status === "in_progress")
            .reduce((total, group) => total + group.count, 0),
          completedActivities: activities.find((group) => group.status === "completed")?.count ?? 0,
        },
        leadsByStatus: leadsByStatus.map((group) => ({ status: group.status.toLowerCase(), count: group._count._all })),
        dealsByStatus: deals,
        activitiesByStatus: activities,
      },
    };
  }
}