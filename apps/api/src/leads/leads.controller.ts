import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assignedOwnerFilter, requireRecordArchive, requireRecordWrite } from "../auth/record-permissions.js";

const sources = ["website", "referral", "linkedin", "other"] as const;
const statuses = ["new", "contacted", "qualified", "disqualified"] as const;
const sortFields = ["createdAt", "name", "company"] as const;
const sortOrders = ["asc", "desc"] as const;
type LeadSourceValue = (typeof sources)[number];
type LeadStatusValue = (typeof statuses)[number];
type DbLeadSource = "WEBSITE" | "REFERRAL" | "LINKEDIN" | "OTHER";
type DbLeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED";
const sourceToDatabase: Record<LeadSourceValue, DbLeadSource> = { website: "WEBSITE", referral: "REFERRAL", linkedin: "LINKEDIN", other: "OTHER" };
const statusToDatabase: Record<LeadStatusValue, DbLeadStatus> = { new: "NEW", contacted: "CONTACTED", qualified: "QUALIFIED", disqualified: "DISQUALIFIED" };

@Controller("leads")
export class LeadsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("source") source?: string,
    @Query("status") status?: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
    @Query("sortBy") sortByValue?: string,
    @Query("sortOrder") sortOrderValue?: string,
  ) {
    const organizationId = this.organizationId(request);
    if (source && !sources.includes(source as LeadSourceValue)) throw this.invalid("source");
    if (status && !statuses.includes(status as LeadStatusValue)) throw this.invalid("status");
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const sortBy = sortByValue ?? "createdAt";
    const sortOrder = sortOrderValue ?? "desc";
    if (!sortFields.includes(sortBy as (typeof sortFields)[number])) throw this.invalid("Invalid sortBy value");
    if (!sortOrders.includes(sortOrder as (typeof sortOrders)[number])) throw this.invalid("Invalid sortOrder value");
    const orderBy = sortBy === "name" ? { name: sortOrder as "asc" | "desc" } : sortBy === "company" ? { company: sortOrder as "asc" | "desc" } : { createdAt: sortOrder as "asc" | "desc" };
    const where = {
      organizationId,
      archivedAt: null,
      ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}),
      ...(source ? { source: sourceToDatabase[source as LeadSourceValue] } : {}),
      ...(status ? { status: statusToDatabase[status as LeadStatusValue] } : {}),
      ...(query?.trim() ? { OR: [
        { name: { contains: query.trim(), mode: "insensitive" as const } },
        { company: { contains: query.trim(), mode: "insensitive" as const } },
      ] } : {}),
    };
    const [total, leads] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { owner: { include: { user: { select: { name: true } } } } },
      }),
    ]);
    return {
      data: leads.map((lead) => this.present(lead)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const name = this.requiredText(body?.name, "name", 120);
    const company = this.requiredText(body?.company, "company", 160);
    const source = this.enumValue(body?.source, sources, "source");
    const status = this.enumValue(body?.status ?? "new", statuses, "status");
    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        name,
        company,
        source: sourceToDatabase[source],
        status: statusToDatabase[status],
        ownerUserId: userId,
        createdByUserId: userId,
      },
      include: { owner: { include: { user: { select: { name: true } } } } },
    });
    return { data: this.present(lead) };
  }

  @Get(":id")
  async get(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId, archivedAt: null, ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) },
      include: { owner: { include: { user: { select: { name: true } } } } },
    });
    if (!lead) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
    return { data: this.present(lead) };
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const patch: { name?: string; company?: string; source?: DbLeadSource; status?: DbLeadStatus } = {};
    if ("name" in (body ?? {})) patch.name = this.requiredText(body.name, "name", 120);
    if ("company" in (body ?? {})) patch.company = this.requiredText(body.company, "company", 160);
    if ("source" in (body ?? {})) patch.source = sourceToDatabase[this.enumValue(body.source, sources, "source")];
    if ("status" in (body ?? {})) patch.status = statusToDatabase[this.enumValue(body.status, statuses, "status")];
    if (Object.keys(patch).length === 0) throw new BadRequestException({ code: "validation_error", message: "Provide at least one editable lead field" });
    const ownerUserId = assignedOwnerFilter(request);
    const result = await this.prisma.lead.updateMany({ where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) }, data: patch });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
    const lead = await this.prisma.lead.findFirst({ where: { id, organizationId, ...(ownerUserId ? { ownerUserId } : {}) }, include: { owner: { include: { user: { select: { name: true } } } } } });
    if (!lead) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
    return { data: this.present(lead) };
  }

  @Delete(":id")
  async archive(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordArchive(request);
    const organizationId = this.organizationId(request);
    const result = await this.prisma.lead.updateMany({
      where: { id, organizationId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
    return { ok: true };
  }

  private present(lead: { id: string; name: string; company: string; source: string; status: string; createdAt: Date; updatedAt: Date; owner: { user: { name: string } } }) {
    return {
      id: lead.id,
      name: lead.name,
      company: lead.company,
      source: lead.source.toLowerCase(),
      status: lead.status.toLowerCase(),
      owner: lead.owner.user.name,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    };
  }

  private context(request: HttpRequest) {
    if (!request.orgId || !request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    return { organizationId: request.orgId, userId: request.userId };
  }

  private organizationId(request: HttpRequest) {
    return this.context(request).organizationId;
  }

  private requiredText(value: unknown, field: string, maxLength: number) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      throw new BadRequestException({ code: "validation_error", message: `${field} is required and must be at most ${maxLength} characters` });
    }
    return value.trim();
  }

  private enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) throw this.invalid(`Invalid ${field} value`);
    return value as T;
  }

  private pagination(pageValue?: string, pageSizeValue?: string) {
    const page = pageValue === undefined ? 1 : Number(pageValue);
    const pageSize = pageSizeValue === undefined ? 25 : Number(pageSizeValue);
    if (!Number.isInteger(page) || page < 1) throw this.invalid("page must be a positive integer");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw this.invalid("pageSize must be between 1 and 100");
    return { page, pageSize };
  }

  private invalid(message: string) {
    return new BadRequestException({ code: "validation_error", message });
  }
}
