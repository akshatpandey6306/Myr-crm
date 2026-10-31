import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { requireRecordWrite } from "../auth/record-permissions.js";

const types = ["task", "call", "meeting", "note", "email"] as const;
const statuses = ["open", "in_progress", "completed", "cancelled"] as const;
const priorities = ["low", "normal", "high"] as const;
const relatedTypes = ["lead", "contact", "company", "deal"] as const;
const sortFields = ["createdAt", "dueAt", "title", "status", "priority"] as const;
const sortOrders = ["asc", "desc"] as const;
type ActivityTypeValue = (typeof types)[number];
type ActivityStatusValue = (typeof statuses)[number];
type ActivityPriorityValue = (typeof priorities)[number];
type RelatedTypeValue = (typeof relatedTypes)[number];

const typeToDb: Record<ActivityTypeValue, any> = { task: "TASK", call: "CALL", meeting: "MEETING", note: "NOTE", email: "EMAIL" };
const dbToType: Record<string, ActivityTypeValue> = { TASK: "task", CALL: "call", MEETING: "meeting", NOTE: "note", EMAIL: "email" };
const statusToDb: Record<ActivityStatusValue, any> = { open: "OPEN", in_progress: "IN_PROGRESS", completed: "COMPLETED", cancelled: "CANCELLED" };
const dbToStatus: Record<string, ActivityStatusValue> = { OPEN: "open", IN_PROGRESS: "in_progress", COMPLETED: "completed", CANCELLED: "cancelled" };
const priorityToDb: Record<ActivityPriorityValue, any> = { low: "LOW", normal: "NORMAL", high: "HIGH" };
const dbToPriority: Record<string, ActivityPriorityValue> = { LOW: "low", NORMAL: "normal", HIGH: "high" };

@Controller("activities")
export class ActivitiesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private organizationId(request: HttpRequest) {
    if (!request.orgId) throw new NotFoundException({ code: "not_found", message: "Organization not found" });
    return request.orgId;
  }

  private invalid(field: string) { return new BadRequestException({ code: "validation_error", message: `Invalid ${field}` }); }
  private requiredText(value: unknown, field: string, max: number) {
    if (typeof value !== "string" || !value.trim()) throw this.invalid(field);
    const trimmed = value.trim();
    if (trimmed.length > max) throw this.invalid(`${field} must be at most ${max} characters`);
    return trimmed;
  }
  private optionalText(value: unknown, field: string, max: number) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw this.invalid(field);
    const trimmed = value.trim();
    if (trimmed.length > max) throw this.invalid(`${field} must be at most ${max} characters`);
    return trimmed;
  }
  private pagination(pageValue?: string, pageSizeValue?: string) {
    const page = Math.max(1, Number(pageValue ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeValue ?? 20) || 20));
    return { page, pageSize };
  }
  private parseDate(value: unknown, field: string) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw this.invalid(field);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw this.invalid(field);
    return d;
  }

  private async validateAssigned(userId: string | null, organizationId: string) {
    if (!userId) return;
    const m = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!m || m.status !== "ACTIVE") throw new BadRequestException({ code: "validation_error", message: "assignedToUserId must be an active member of the organization" });
  }

  private async validateRelated(relatedToType: string | null, relatedToId: string | null, organizationId: string) {
    if (relatedToType === null && relatedToId === null) return;
    if (relatedToType === null || relatedToId === null) throw new BadRequestException({ code: "validation_error", message: "relatedToType and relatedToId must be provided together" });
    if (!relatedTypes.includes(relatedToType as RelatedTypeValue)) throw this.invalid("relatedToType");
    let exists = false;
    if (relatedToType === "lead") exists = !!(await this.prisma.lead.findFirst({ where: { id: relatedToId, organizationId } }));
    else if (relatedToType === "contact") exists = !!(await this.prisma.contact.findFirst({ where: { id: relatedToId, organizationId } }));
    else if (relatedToType === "company") exists = !!(await this.prisma.company.findFirst({ where: { id: relatedToId, organizationId } }));
    else if (relatedToType === "deal") exists = !!(await this.prisma.deal.findFirst({ where: { id: relatedToId, organizationId } }));
    if (!exists) throw new BadRequestException({ code: "validation_error", message: "related record must belong to the same organization" });
  }

  private present(activity: any) {
    return {
      id: activity.id,
      organizationId: activity.organizationId,
      type: dbToType[activity.type],
      title: activity.title,
      description: activity.description,
      status: dbToStatus[activity.status],
      priority: dbToPriority[activity.priority],
      dueAt: activity.dueAt ? activity.dueAt.toISOString() : null,
      completedAt: activity.completedAt ? activity.completedAt.toISOString() : null,
      assignedToUserId: activity.assignedToUserId,
      relatedToType: activity.relatedToType,
      relatedToId: activity.relatedToId,
      createdByUserId: activity.createdByUserId,
      createdAt: activity.createdAt.toISOString(),
      updatedAt: activity.updatedAt.toISOString(),
    };
  }

  @Get()
  async list(@Req() request: HttpRequest, @Query("q") query?: string, @Query("status") status?: string, @Query("type") type?: string, @Query("priority") priority?: string, @Query("page") pageValue?: string, @Query("pageSize") pageSizeValue?: string, @Query("sortBy") sortByValue?: string, @Query("sortOrder") sortOrderValue?: string) {
    const organizationId = this.organizationId(request);
    if (status && !statuses.includes(status as ActivityStatusValue)) throw this.invalid("status");
    if (type && !types.includes(type as ActivityTypeValue)) throw this.invalid("type");
    if (priority && !priorities.includes(priority as ActivityPriorityValue)) throw this.invalid("priority");
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const sortBy = sortByValue ?? "createdAt";
    const sortOrder = sortOrderValue ?? "desc";
    if (!sortFields.includes(sortBy as (typeof sortFields)[number])) throw this.invalid("sortBy");
    if (!sortOrders.includes(sortOrder as (typeof sortOrders)[number])) throw this.invalid("sortOrder");
    const orderBy = sortBy === "title" ? { title: sortOrder as "asc" | "desc" } : sortBy === "dueAt" ? { dueAt: sortOrder as "asc" | "desc" } : sortBy === "status" ? { status: sortOrder as "asc" | "desc" } : sortBy === "priority" ? { priority: sortOrder as "asc" | "desc" } : { createdAt: sortOrder as "asc" | "desc" };
    const where: any = {
      organizationId,
      ...(request.organizationRole === "sales_rep" ? { assignedToUserId: request.userId } : {}),
      ...(status ? { status: statusToDb[status as ActivityStatusValue] } : {}),
      ...(type ? { type: typeToDb[type as ActivityTypeValue] } : {}),
      ...(priority ? { priority: priorityToDb[priority as ActivityPriorityValue] } : {}),
      ...(query?.trim() ? { OR: [{ title: { contains: query.trim(), mode: "insensitive" } }, { description: { contains: query.trim(), mode: "insensitive" } }] } : {}),
    };
    const [total, activities] = await Promise.all([
      this.prisma.activity.count({ where }),
      this.prisma.activity.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { data: activities.map((a) => this.present(a)), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const userId = request.userId!;
    const title = this.requiredText(body?.title, "title", 160);
    const type = this.enumValue(body?.type ?? "task", types, "type");
    const status = this.enumValue(body?.status ?? "open", statuses, "status");
    const priority = this.enumValue(body?.priority ?? "normal", priorities, "priority");
    const description = this.optionalText(body?.description, "description", 4000);
    const dueAt = this.parseDate(body?.dueAt, "dueAt");
    const assignedToUserId = body?.assignedToUserId === undefined || body?.assignedToUserId === null || body?.assignedToUserId === "" ? null : String(body.assignedToUserId);
    const relatedToType = body?.relatedToType === undefined || body?.relatedToType === null || body?.relatedToType === "" ? null : String(body.relatedToType);
    const relatedToId = body?.relatedToId === undefined || body?.relatedToId === null || body?.relatedToId === "" ? null : String(body.relatedToId);
    await this.validateAssigned(assignedToUserId, organizationId);
    await this.validateRelated(relatedToType, relatedToId, organizationId);
    const activity = await this.prisma.activity.create({
      data: {
        organizationId,
        type: typeToDb[type],
        title,
        description,
        status: statusToDb[status],
        priority: priorityToDb[priority],
        dueAt,
        completedAt: status === "completed" ? new Date() : null,
        assignedToUserId,
        relatedToType,
        relatedToId,
        createdByUserId: userId,
      },
    });
    return this.present(activity);
  }

  private enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
    if (typeof value !== "string" || !values.includes(value as T)) throw this.invalid(field);
    return value as T;
  }

  @Get(":id")
  async get(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const activity = await this.prisma.activity.findFirst({ where: { id, organizationId } });
    if (!activity) throw new NotFoundException({ code: "not_found", message: "Activity not found" });
    return this.present(activity);
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const existing = await this.prisma.activity.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Activity not found" });
    const data: any = {};
    if (body.title !== undefined) data.title = this.requiredText(body.title, "title", 160);
    if (body.description !== undefined) data.description = this.optionalText(body.description, "description", 4000);
    if (body.type !== undefined) data.type = typeToDb[this.enumValue(body.type, types, "type")];
    if (body.status !== undefined) {
      const s = this.enumValue(body.status, statuses, "status");
      data.status = statusToDb[s];
      if (s === "completed") data.completedAt = new Date();
      else data.completedAt = null;
    }
    if (body.priority !== undefined) data.priority = priorityToDb[this.enumValue(body.priority, priorities, "priority")];
    if (body.dueAt !== undefined) data.dueAt = this.parseDate(body.dueAt, "dueAt");
    if (body.assignedToUserId !== undefined) {
      const uid = body.assignedToUserId === null || body.assignedToUserId === "" ? null : String(body.assignedToUserId);
      await this.validateAssigned(uid, organizationId);
      data.assignedToUserId = uid;
    }
    if (body.relatedToType !== undefined || body.relatedToId !== undefined) {
      const rt = body.relatedToType === undefined ? existing.relatedToType : (body.relatedToType === null || body.relatedToType === "" ? null : String(body.relatedToType));
      const rid = body.relatedToId === undefined ? existing.relatedToId : (body.relatedToId === null || body.relatedToId === "" ? null : String(body.relatedToId));
      await this.validateRelated(rt, rid, organizationId);
      data.relatedToType = rt;
      data.relatedToId = rid;
    }
    const updated = await this.prisma.activity.update({ where: { id }, data });
    return this.present(updated);
  }

  @Delete(":id")
  async remove(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const existing = await this.prisma.activity.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Activity not found" });
    await this.prisma.activity.delete({ where: { id } });
    return { ok: true };
  }
}
