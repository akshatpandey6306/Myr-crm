import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { requireRecordArchive, requireRecordWrite } from "../auth/record-permissions.js";
import { PrismaService } from "../prisma/prisma.service.js";

const types = ["task", "call", "meeting", "note", "email"] as const;
const statuses = ["open", "in_progress", "completed", "cancelled"] as const;
const priorities = ["low", "normal", "high"] as const;
const relatedTypes = ["lead", "contact", "company", "deal"] as const;
const sortFields = ["createdAt", "dueAt"] as const;
const sortOrders = ["asc", "desc"] as const;
const managers = new Set(["owner", "admin", "sales_manager"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ActivityTypeValue = (typeof types)[number];
type ActivityStatusValue = (typeof statuses)[number];
type ActivityPriorityValue = (typeof priorities)[number];
type RelatedTypeValue = (typeof relatedTypes)[number];
type ActivityFields = {
  type?: "TASK" | "CALL" | "MEETING" | "NOTE" | "EMAIL";
  title?: string;
  description?: string | null;
  status?: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority?: "LOW" | "NORMAL" | "HIGH";
  dueAt?: Date | null;
  completedAt?: Date | null;
  assignedToUserId?: string | null;
  relatedToType?: "LEAD" | "CONTACT" | "COMPANY" | "DEAL" | null;
  relatedToId?: string | null;
};

@Controller("activities")
export class ActivitiesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("type") typeValue?: string,
    @Query("status") statusValue?: string,
    @Query("priority") priorityValue?: string,
    @Query("assignedToUserId") assignedToUserIdValue?: string,
    @Query("relatedToType") relatedToTypeValue?: string,
    @Query("relatedToId") relatedToIdValue?: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
    @Query("sortBy") sortByValue?: string,
    @Query("sortOrder") sortOrderValue?: string,
  ) {
    const { organizationId, userId } = this.context(request);
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const type = typeValue ? this.enumValue(typeValue, types, "type") : undefined;
    const status = statusValue ? this.enumValue(statusValue, statuses, "status") : undefined;
    const priority = priorityValue ? this.enumValue(priorityValue, priorities, "priority") : undefined;
    const relatedToType = relatedToTypeValue
      ? this.enumValue(relatedToTypeValue, relatedTypes, "relatedToType")
      : undefined;
    const relatedToId = relatedToIdValue ? this.uuid(relatedToIdValue, "relatedToId") : undefined;
    if (relatedToId && !relatedToType) throw this.invalid("relatedToId requires relatedToType");

    const sortBy = sortByValue ?? "dueAt";
    const sortOrder = sortOrderValue ?? "asc";
    if (!sortFields.includes(sortBy as (typeof sortFields)[number])) {
      throw this.invalid("Invalid sortBy value");
    }
    if (!sortOrders.includes(sortOrder as (typeof sortOrders)[number])) {
      throw this.invalid("Invalid sortOrder value");
    }
    let assignedFilter: string | null | undefined;
    if (assignedToUserIdValue === "unassigned") assignedFilter = null;
    else if (assignedToUserIdValue === "me") assignedFilter = userId;
    else if (assignedToUserIdValue) assignedFilter = this.uuid(assignedToUserIdValue, "assignedToUserId");
    if (
      request.organizationRole === "sales_rep"
      && assignedFilter !== undefined
      && assignedFilter !== userId
    ) {
      throw new ForbiddenException({ code: "forbidden", message: "Sales representatives can view only their assigned activities" });
    }

    const search = query?.trim();
    const where = {
      organizationId,
      archivedAt: null,
      ...(request.organizationRole === "sales_rep" ? { assignedToUserId: userId } : {}),
      ...(assignedFilter !== undefined ? { assignedToUserId: assignedFilter } : {}),
      ...(type ? { type: type.toUpperCase() as "TASK" | "CALL" | "MEETING" | "NOTE" | "EMAIL" } : {}),
      ...(status ? { status: status.toUpperCase() as "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" } : {}),
      ...(priority ? { priority: priority.toUpperCase() as "LOW" | "NORMAL" | "HIGH" } : {}),
      ...(relatedToType ? {
        relatedToType: relatedToType.toUpperCase() as "LEAD" | "CONTACT" | "COMPANY" | "DEAL",
        ...(relatedToId ? { relatedToId } : {}),
      } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
        ],
      } : {}),
    };
    const orderBy = sortBy === "dueAt"
      ? { dueAt: { sort: sortOrder as "asc" | "desc", nulls: "last" as const } }
      : { createdAt: sortOrder as "asc" | "desc" };
    const [total, activities] = await Promise.all([
      this.prisma.activity.count({ where }),
      this.prisma.activity.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.relations(),
      }),
    ]);
    const relatedNames = await this.relatedNames(organizationId, activities);

    return {
      data: activities.map((activity) => this.present(activity, relatedNames)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const type = this.enumValue(body?.type, types, "type");
    const status = this.enumValue(body?.status ?? "open", statuses, "status");
    const priority = this.enumValue(body?.priority ?? "normal", priorities, "priority");
    const title = this.requiredText(body?.title, "title", 160);
    const fields = {
      type: type.toUpperCase() as NonNullable<ActivityFields["type"]>,
      title,
      description: this.optionalText(body?.description, "description", 5000),
      status: status.toUpperCase() as NonNullable<ActivityFields["status"]>,
      priority: priority.toUpperCase() as NonNullable<ActivityFields["priority"]>,
      dueAt: this.dateValue(body?.dueAt, "dueAt"),
      completedAt: status === "completed" ? new Date() : null,
      ...this.relatedFields(body),
    };
    const relatedType = fields.relatedToType;
    const relatedId = fields.relatedToId;

    let assignedToUserId: string | null = userId;
    if ("assignedToUserId" in (body ?? {})) {
      const requestedAssignee = body.assignedToUserId;
      if (request.organizationRole === "sales_rep" && requestedAssignee !== userId) {
        throw new ForbiddenException({ code: "forbidden", message: "Sales representatives can assign activities only to themselves" });
      }
      assignedToUserId = requestedAssignee === null
        ? null
        : this.uuid(requestedAssignee, "assignedToUserId");
    }
    if (assignedToUserId) await this.validateAssignee(organizationId, assignedToUserId);
    await this.validateRelated(organizationId, relatedType, relatedId);

    const activity = await this.prisma.activity.create({
      data: {
        ...fields,
        organizationId,
        assignedToUserId,
        createdByUserId: userId,
      },
      include: this.relations(),
    });
    const relatedNames = await this.relatedNames(organizationId, [activity]);
    return { data: this.present(activity, relatedNames) };
  }

  @Get(":id")
  async get(@Req() request: HttpRequest, @Param("id") id: string) {
    const { organizationId, userId } = this.context(request);
    const activity = await this.prisma.activity.findFirst({
      where: {
        id,
        organizationId,
        archivedAt: null,
        ...(request.organizationRole === "sales_rep" ? { assignedToUserId: userId } : {}),
      },
      include: this.relations(),
    });
    if (!activity) throw new NotFoundException({ code: "not_found", message: "Activity not found" });
    const relatedNames = await this.relatedNames(organizationId, [activity]);
    return { data: this.present(activity, relatedNames) };
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    if ("assignedToUserId" in (body ?? {})) this.requireAssignmentPermission(request);
    const { organizationId, userId } = this.context(request);
    const ownerFilter = request.organizationRole === "sales_rep" ? { assignedToUserId: userId } : {};
    const where = { id, organizationId, archivedAt: null, ...ownerFilter };
    const existing = await this.prisma.activity.findFirst({ where, select: { completedAt: true } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Activity not found" });

    const patch: ActivityFields = {};
    if ("type" in (body ?? {})) {
      patch.type = this.enumValue(body.type, types, "type").toUpperCase() as ActivityFields["type"];
    }
    if ("title" in (body ?? {})) patch.title = this.requiredText(body.title, "title", 160);
    if ("description" in (body ?? {})) patch.description = this.optionalText(body.description, "description", 5000);
    if ("status" in (body ?? {})) {
      const status = this.enumValue(body.status, statuses, "status");
      patch.status = status.toUpperCase() as ActivityFields["status"];
      patch.completedAt = status === "completed" ? existing.completedAt ?? new Date() : null;
    }
    if ("priority" in (body ?? {})) {
      patch.priority = this.enumValue(body.priority, priorities, "priority").toUpperCase() as ActivityFields["priority"];
    }
    if ("dueAt" in (body ?? {})) patch.dueAt = this.dateValue(body.dueAt, "dueAt");

    const hasRelatedField = "relatedToType" in (body ?? {}) || "relatedToId" in (body ?? {});
    if (hasRelatedField) {
      const related = this.relatedFields(body);
      Object.assign(patch, related);
      await this.validateRelated(organizationId, related.relatedToType, related.relatedToId);
    }

    if ("assignedToUserId" in (body ?? {})) {
      const assignee = body.assignedToUserId === null
        ? null
        : this.uuid(body.assignedToUserId, "assignedToUserId");
      if (assignee) await this.validateAssignee(organizationId, assignee);
      patch.assignedToUserId = assignee;
    }
    if (Object.keys(patch).length === 0) throw this.invalid("Provide at least one editable activity field");

    const result = await this.prisma.activity.updateMany({ where, data: patch });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Activity not found" });
    const activity = await this.prisma.activity.findFirst({ where, include: this.relations() });
    if (!activity) throw new NotFoundException({ code: "not_found", message: "Activity not found" });
    const relatedNames = await this.relatedNames(organizationId, [activity]);
    return { data: this.present(activity, relatedNames) };
  }

  @Delete(":id")
  async archive(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordArchive(request);
    const { organizationId } = this.context(request);
    const result = await this.prisma.activity.updateMany({
      where: { id, organizationId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Activity not found" });
    return { ok: true };
  }

  private relations() {
    return {
      assignee: { include: { user: { select: { id: true, name: true } } } },
      creator: { include: { user: { select: { id: true, name: true } } } },
    } as const;
  }

  private async relatedNames(
    organizationId: string,
    activities: Array<{ relatedToType: string | null; relatedToId: string | null }>,
  ) {
    const result = new Map<string, string>();
    const groups = new Map<string, string[]>();
    for (const activity of activities) {
      if (!activity.relatedToType || !activity.relatedToId) continue;
      const ids = groups.get(activity.relatedToType) ?? [];
      ids.push(activity.relatedToId);
      groups.set(activity.relatedToType, ids);
    }
    const [leads, contacts, companies, deals] = await Promise.all([
      groups.has("LEAD") ? this.prisma.lead.findMany({
        where: { organizationId, archivedAt: null, id: { in: groups.get("LEAD") } },
        select: { id: true, name: true },
      }) : [],
      groups.has("CONTACT") ? this.prisma.contact.findMany({
        where: { organizationId, archivedAt: null, id: { in: groups.get("CONTACT") } },
        select: { id: true, name: true },
      }) : [],
      groups.has("COMPANY") ? this.prisma.company.findMany({
        where: { organizationId, archivedAt: null, id: { in: groups.get("COMPANY") } },
        select: { id: true, name: true },
      }) : [],
      groups.has("DEAL") ? this.prisma.deal.findMany({
        where: { organizationId, archivedAt: null, id: { in: groups.get("DEAL") } },
        select: { id: true, name: true },
      }) : [],
    ]);
    for (const record of [...leads, ...contacts, ...companies, ...deals]) result.set(record.id, record.name);
    return result;
  }

  private present(
    activity: {
      id: string;
      organizationId: string;
      type: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      dueAt: Date | null;
      completedAt: Date | null;
      assignedToUserId: string | null;
      relatedToType: string | null;
      relatedToId: string | null;
      createdByUserId: string;
      createdAt: Date;
      updatedAt: Date;
      assignee: { user: { name: string } } | null;
      creator: { user: { name: string } };
    },
    relatedNames: Map<string, string>,
  ) {
    return {
      id: activity.id,
      organizationId: activity.organizationId,
      type: activity.type.toLowerCase(),
      title: activity.title,
      description: activity.description,
      status: activity.status.toLowerCase(),
      priority: activity.priority.toLowerCase(),
      dueAt: activity.dueAt?.toISOString() ?? null,
      completedAt: activity.completedAt?.toISOString() ?? null,
      assignedToUserId: activity.assignedToUserId,
      assignedToName: activity.assignee?.user.name ?? null,
      relatedToType: activity.relatedToType?.toLowerCase() ?? null,
      relatedToId: activity.relatedToId,
      relatedToName: activity.relatedToId ? relatedNames.get(activity.relatedToId) ?? null : null,
      createdByUserId: activity.createdByUserId,
      createdByName: activity.creator.user.name,
      createdAt: activity.createdAt.toISOString(),
      updatedAt: activity.updatedAt.toISOString(),
    };
  }

  private async validateAssignee(organizationId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { userId: true },
    });
    if (!membership) throw this.invalid("assignedToUserId must be an active member of the selected organization");
  }

  private async validateRelated(organizationId: string, type: ActivityFields["relatedToType"], id: string | null | undefined) {
    if (!type || !id) return;
    const where = { id, organizationId, archivedAt: null };
    const record = type === "LEAD"
      ? await this.prisma.lead.findFirst({ where, select: { id: true } })
      : type === "CONTACT"
        ? await this.prisma.contact.findFirst({ where, select: { id: true } })
        : type === "COMPANY"
          ? await this.prisma.company.findFirst({ where, select: { id: true } })
          : await this.prisma.deal.findFirst({ where, select: { id: true } });
    if (!record) throw this.invalid("Related record must be active and belong to the selected organization");
  }

  private relatedFields(body: Record<string, unknown>): ActivityFields {
    const hasType = body && "relatedToType" in body;
    const hasId = body && "relatedToId" in body;
    if (!hasType && !hasId) return {};
    const typeValue = body.relatedToType;
    const idValue = body.relatedToId;
    if (typeValue === null && idValue === null) return { relatedToType: null, relatedToId: null };
    if (typeof typeValue !== "string" || typeof idValue !== "string") {
      throw this.invalid("relatedToType and relatedToId must be provided together or both null");
    }
    const type = this.enumValue(typeValue, relatedTypes, "relatedToType");
    const id = this.uuid(idValue, "relatedToId");
    return {
      relatedToType: type.toUpperCase() as ActivityFields["relatedToType"],
      relatedToId: id,
    };
  }

  private requireAssignmentPermission(request: HttpRequest) {
    if (!request.organizationRole || !managers.has(request.organizationRole)) {
      throw new ForbiddenException({ code: "forbidden", message: "Your organization role cannot assign activities" });
    }
  }

  private context(request: HttpRequest) {
    if (!request.orgId || !request.userId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }
    return { organizationId: request.orgId, userId: request.userId };
  }

  private requiredText(value: unknown, field: string, maxLength: number) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      throw this.invalid(`${field} is required and must be at most ${maxLength} characters`);
    }
    return value.trim();
  }

  private optionalText(value: unknown, field: string, maxLength: number) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || value.trim().length > maxLength) {
      throw this.invalid(`${field} must be a string of at most ${maxLength} characters`);
    }
    return value.trim() || null;
  }

  private dateValue(value: unknown, field: string) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") throw this.invalid(`${field} must be an ISO date or null`);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw this.invalid(`${field} must be a valid ISO date or null`);
    return date;
  }

  private uuid(value: unknown, field: string) {
    if (typeof value !== "string" || !uuidPattern.test(value)) throw this.invalid(`${field} must be a valid ID`);
    return value;
  }

  private enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) throw this.invalid(`Invalid ${field} value`);
    return value as T;
  }

  private pagination(pageValue?: string, pageSizeValue?: string) {
    const page = pageValue === undefined ? 1 : Number(pageValue);
    const pageSize = pageSizeValue === undefined ? 25 : Number(pageSizeValue);
    if (!Number.isInteger(page) || page < 1) throw this.invalid("page must be a positive integer");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw this.invalid("pageSize must be between 1 and 100");
    }
    return { page, pageSize };
  }

  private invalid(message: string) {
    return new BadRequestException({ code: "validation_error", message });
  }
}
