import { BadRequestException, Controller, ForbiddenException, Get, Inject, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

const managers = new Set(["owner", "admin"]);
const actions = new Set(["create", "update", "archive"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("audit-logs")
export class AuditLogsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Req() request: HttpRequest,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
    @Query("action") actionValue?: string,
    @Query("resourceType") resourceTypeValue?: string,
    @Query("actor") actorValue?: string,
    @Query("from") fromValue?: string,
    @Query("to") toValue?: string,
  ) {
    if (!request.orgId || !request.userId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }
    if (!request.organizationRole || !managers.has(request.organizationRole)) {
      throw new ForbiddenException({ code: "forbidden", message: "Only the Organization Owner or Admin can view audit history" });
    }
    const page = pageValue === undefined ? 1 : Number(pageValue);
    const pageSize = pageSizeValue === undefined ? 25 : Number(pageSizeValue);
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException({ code: "validation_error", message: "page must be a positive integer" });
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException({ code: "validation_error", message: "pageSize must be between 1 and 100" });
    }

    const action = actionValue?.trim().toLowerCase();
    if (action && !actions.has(action)) {
      throw new BadRequestException({ code: "validation_error", message: "action must be create, update, or archive" });
    }
    const resourceType = resourceTypeValue?.trim();
    if (resourceType && resourceType.length > 48) {
      throw new BadRequestException({ code: "validation_error", message: "resourceType must be at most 48 characters" });
    }
    const actor = actorValue?.trim();
    if (actor && actor.length > 120) {
      throw new BadRequestException({ code: "validation_error", message: "actor must be at most 120 characters" });
    }
    const from = this.dateFilter(fromValue, "from");
    const to = this.dateFilter(toValue, "to");
    if (from && to && from >= to) {
      throw new BadRequestException({ code: "validation_error", message: "to must be later than from" });
    }

    const where: Prisma.AuditLogWhereInput = {
      organizationId: request.orgId,
      ...(action ? { action: action.toUpperCase() as "CREATE" | "UPDATE" | "ARCHIVE" } : {}),
      ...(resourceType ? { resourceType: { contains: resourceType, mode: "insensitive" } } : {}),
      ...(actor ? { actor: { is: { user: { is: { name: { contains: actor, mode: "insensitive" } } } } } } : {}),
      ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    };
    const [total, events] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { include: { user: { select: { name: true } } } } },
      }),
    ]);
    return {
      data: events.map((event) => ({
        id: event.id,
        action: event.action.toLowerCase(),
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        actorUserId: event.actorUserId,
        actorName: event.actor.user.name,
        createdAt: event.createdAt.toISOString(),
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  private dateFilter(value: string | undefined, field: "from" | "to") {
    if (value === undefined || value === "") return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException({ code: "validation_error", message: `${field} must be a valid date-time` });
    }
    return date;
  }
}
