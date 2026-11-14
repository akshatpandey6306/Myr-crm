import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Logger, NotFoundException, Param, Patch, PayloadTooLargeException, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assignedOwnerFilter, requireRecordArchive, requireRecordWrite } from "../auth/record-permissions.js";
import { AutomationsService } from "../automations/automations.service.js";

const sources = ["website", "referral", "linkedin", "other"] as const;
const statuses = ["new", "contacted", "qualified", "disqualified"] as const;
const sortFields = ["createdAt", "name", "company"] as const;
const sortOrders = ["asc", "desc"] as const;
const assignmentScopes = ["selected", "all"] as const;
const assignmentManagers = new Set(["owner", "admin"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type LeadSourceValue = (typeof sources)[number];
type LeadStatusValue = (typeof statuses)[number];
type DbLeadSource = "WEBSITE" | "REFERRAL" | "LINKEDIN" | "OTHER";
type DbLeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED";
type LeadImportRow = { row: number; name: string; company: string; source: LeadSourceValue; status: LeadStatusValue; errors: string[] };
type LeadAssignment = { leadId: string; ownerUserId: string };
const sourceToDatabase: Record<LeadSourceValue, DbLeadSource> = { website: "WEBSITE", referral: "REFERRAL", linkedin: "LINKEDIN", other: "OTHER" };
const statusToDatabase: Record<LeadStatusValue, DbLeadStatus> = { new: "NEW", contacted: "CONTACTED", qualified: "QUALIFIED", disqualified: "DISQUALIFIED" };

@Controller("leads")
export class LeadsController {
  private readonly logger = new Logger(LeadsController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AutomationsService) private readonly automations: AutomationsService,
  ) {}

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

  @Get("export")
  async export(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("source") source?: string,
    @Query("status") status?: string,
    @Query("sortBy") sortByValue?: string,
    @Query("sortOrder") sortOrderValue?: string,
  ) {
    const organizationId = this.organizationId(request);
    if (source && !sources.includes(source as LeadSourceValue)) throw this.invalid("Invalid source filter");
    if (status && !statuses.includes(status as LeadStatusValue)) throw this.invalid("Invalid status filter");
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    const sortBy = sortByValue ?? "createdAt";
    const sortOrder = sortOrderValue ?? "desc";
    if (!sortFields.includes(sortBy as (typeof sortFields)[number])) throw this.invalid("Invalid sortBy value");
    if (!sortOrders.includes(sortOrder as (typeof sortOrders)[number])) throw this.invalid("Invalid sortOrder value");
    const orderBy = sortBy === "name" ? { name: sortOrder as "asc" | "desc" }
      : sortBy === "company" ? { company: sortOrder as "asc" | "desc" }
        : { createdAt: sortOrder as "asc" | "desc" };
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
    const total = await this.prisma.lead.count({ where });
    if (total > 10_000) {
      throw new PayloadTooLargeException({ code: "export_too_large", message: "Narrow your filters to export no more than 10,000 leads at a time" });
    }
    const leads = await this.prisma.lead.findMany({
      where,
      orderBy,
      take: 10_000,
      select: {
        name: true,
        company: true,
        source: true,
        status: true,
        createdAt: true,
        owner: { select: { user: { select: { name: true } } } },
      },
    });
    await this.prisma.auditLog.create({
      data: { organizationId, actorUserId: request.userId!, action: "CREATE", resourceType: "lead_export" },
    });
    return {
      data: leads.map((lead) => ({
        name: lead.name,
        company: lead.company,
        source: lead.source.toLowerCase(),
        status: lead.status.toLowerCase(),
        owner: lead.owner.user.name,
        createdAt: lead.createdAt.toISOString(),
      })),
    };
  }

  @Post("import/validate")
  async validateImport(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    this.requireAssignmentManager(request);
    const { organizationId } = this.context(request);
    const rows = this.parseLeadImportRows(body?.rows);
    const validatedRows = await this.validateLeadImport(organizationId, rows, this.prisma);
    const responseRows = validatedRows.map(({ row, name, company, source, status, errors }) => ({
      row, name, company, source, status, errors,
    }));
    return {
      data: {
        rows: responseRows,
        validCount: responseRows.filter(({ errors }) => errors.length === 0).length,
        canImport: responseRows.length > 0 && responseRows.every(({ errors }) => errors.length === 0),
      },
    };
  }

  @Post("import")
  async importLeads(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    this.requireAssignmentManager(request);
    const { organizationId, userId } = this.context(request);
    const rows = this.parseLeadImportRows(body?.rows);
    const generatedActivityIds: string[] = [];
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const validatedRows = await this.validateLeadImport(organizationId, rows, transaction);
        const invalidRows = validatedRows.filter(({ errors }) => errors.length > 0);
        if (invalidRows.length > 0) {
          throw new BadRequestException({
            code: "lead_import_conflict",
            message: "Lead import validation changed. Review the rows and retry.",
            rows: invalidRows.map(({ row, errors }) => ({ row, errors })),
          });
        }
        const results = [];
        for (const row of validatedRows) {
          const ownerUserId = await this.nextLeadOwner(transaction, organizationId, userId);
          const lead = await transaction.lead.create({
            data: {
              organizationId,
              name: row.name,
              company: row.company,
              source: sourceToDatabase[row.source],
              status: statusToDatabase[row.status],
              ownerUserId,
              createdByUserId: userId,
            },
            include: { owner: { include: { user: { select: { name: true } } } } },
          });
          generatedActivityIds.push(...((await this.automations.runForLead(transaction, {
            organizationId,
            actorUserId: userId,
            leadId: lead.id,
            leadName: lead.name,
            leadOwnerUserId: lead.ownerUserId,
            status: lead.status,
            event: "lead_created",
          })) ?? []));
          results.push(lead);
        }
        return results;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.auditGeneratedActivities(generatedActivityIds, organizationId, userId);
      return { data: { createdCount: created.length } };
    } catch (error) {
      if (this.prismaCode(error) === "P2034") {
        throw new BadRequestException({ code: "lead_import_conflict", message: "Lead data changed while importing. No leads were imported; validate the file again." });
      }
      throw error;
    }
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const name = this.requiredText(body?.name, "name", 120);
    const company = this.requiredText(body?.company, "company", 160);
    const source = this.enumValue(body?.source, sources, "source");
    const status = this.enumValue(body?.status ?? "new", statuses, "status");
    const result = await this.prisma.$transaction(async (tx) => {
      const ownerUserId = await this.nextLeadOwner(tx, organizationId, userId);
      const createdLead = await tx.lead.create({
        data: {
          organizationId,
          name,
          company,
          source: sourceToDatabase[source],
          status: statusToDatabase[status],
          ownerUserId,
          createdByUserId: userId,
        },
        include: { owner: { include: { user: { select: { name: true } } } } },
      });
      const generatedActivityIds = await this.automations.runForLead(tx, {
        organizationId,
        actorUserId: userId,
        leadId: createdLead.id,
        leadName: createdLead.name,
        leadOwnerUserId: createdLead.ownerUserId,
        status: createdLead.status,
        event: "lead_created",
      });
      return { lead: createdLead, generatedActivityIds: generatedActivityIds ?? [] };
    });
    await this.auditGeneratedActivities(result.generatedActivityIds, organizationId, userId);
    return { data: this.present(result.lead) };
  }

  @Get("assignment-settings")
  async getAssignmentSettings(@Req() request: HttpRequest) {
    const { organizationId } = this.context(request);
    const canManage = this.canManageAssignments(request);
    const [settings, members] = await Promise.all([
      this.prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { leadAutoAssignEnabled: true, leadAutoAssignUserIds: true },
      }),
      canManage
        ? this.prisma.membership.findMany({
          where: {
            organizationId,
            status: "ACTIVE",
            role: { not: "READ_ONLY" },
            user: { status: "ACTIVE" },
          },
          select: { userId: true, user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        })
        : Promise.resolve([]),
    ]);
    return {
      data: {
        canManage,
        enabled: settings?.leadAutoAssignEnabled ?? false,
        assigneeUserIds: canManage ? settings?.leadAutoAssignUserIds ?? [] : [],
        assignees: members.map(({ userId, user }) => ({ id: userId, name: user.name })),
      },
    };
  }

  @Patch("assignment-settings")
  async updateAssignmentSettings(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    this.requireAssignmentManager(request);
    const { organizationId } = this.context(request);
    if (typeof body?.enabled !== "boolean") throw this.invalid("enabled must be a boolean");
    const assigneeUserIds = this.userIds(body?.assigneeUserIds, "assigneeUserIds", 100);
    if (body.enabled && assigneeUserIds.length === 0) {
      throw this.invalid("Choose at least one team member for automatic assignment");
    }
    await this.requireActiveAssignees(organizationId, assigneeUserIds);
    const settings = await this.prisma.organizationSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        leadAutoAssignEnabled: body.enabled,
        leadAutoAssignUserIds: assigneeUserIds,
        leadAutoAssignCursor: 0,
      },
      update: {
        leadAutoAssignEnabled: body.enabled,
        leadAutoAssignUserIds: assigneeUserIds,
        leadAutoAssignCursor: 0,
      },
      select: { leadAutoAssignEnabled: true, leadAutoAssignUserIds: true },
    });
    return { data: { enabled: settings.leadAutoAssignEnabled, assigneeUserIds: settings.leadAutoAssignUserIds } };
  }

  @Post("distribute")
  async distribute(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    this.requireAssignmentManager(request);
    const { organizationId } = this.context(request);
    const scope = this.enumValue(body?.scope, assignmentScopes, "scope");
    const assigneeUserIds = this.userIds(body?.assigneeUserIds, "assigneeUserIds", 100);
    if (assigneeUserIds.length === 0) throw this.invalid("Choose at least one team member");
    const leadIds = scope === "selected" ? this.userIds(body?.leadIds, "leadIds", 1000) : [];
    if (scope === "selected" && leadIds.length === 0) throw this.invalid("Choose at least one lead");
    const result = await this.prisma.$transaction(async (tx) => {
      await this.requireActiveAssignees(organizationId, assigneeUserIds, tx);
      const leads = await tx.lead.findMany({
        where: {
          organizationId,
          archivedAt: null,
          ...(scope === "selected" ? { id: { in: leadIds } } : {}),
        },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (scope === "selected" && leads.length !== leadIds.length) {
        throw new NotFoundException({ code: "not_found", message: "One or more selected leads are not active in this organization" });
      }
      const assignedIds = new Map(assigneeUserIds.map((id) => [id, [] as string[]]));
      leads.forEach(({ id }, index) => {
        const userId = assigneeUserIds[index % assigneeUserIds.length];
        const recipientLeadIds = userId ? assignedIds.get(userId) : undefined;
        if (!recipientLeadIds) throw this.invalid("Could not determine a lead recipient");
        recipientLeadIds.push(id);
      });
      for (const [userId, ids] of assignedIds) {
        for (let offset = 0; offset < ids.length; offset += 500) {
          await tx.lead.updateMany({
            where: { organizationId, archivedAt: null, id: { in: ids.slice(offset, offset + 500) } },
            data: { ownerUserId: userId },
          });
        }
      }
      return leads.length;
    });
    return { data: { assignedCount: result, assigneeCount: assigneeUserIds.length } };
  }

  @Post("distribute/preview")
  async previewDistribution(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    this.requireAssignmentManager(request);
    const { organizationId } = this.context(request);
    const scope = this.enumValue(body?.scope, assignmentScopes, "scope");
    const assigneeUserIds = this.userIds(body?.assigneeUserIds, "assigneeUserIds", 100);
    if (assigneeUserIds.length === 0) throw this.invalid("Choose at least one team member");
    const leadIds = scope === "selected" ? this.userIds(body?.leadIds, "leadIds", 1000) : [];
    if (scope === "selected" && leadIds.length === 0) throw this.invalid("Choose at least one lead");
    await this.requireActiveAssignees(organizationId, assigneeUserIds);
    const leads = await this.prisma.lead.findMany({
      where: {
        organizationId,
        archivedAt: null,
        ...(scope === "selected" ? { id: { in: leadIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        owner: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 10_001,
    });
    if (leads.length > 10_000) {
      throw new PayloadTooLargeException({ code: "assignment_preview_too_large", message: "Select a smaller group of leads to preview distribution" });
    }
    if (scope === "selected" && leads.length !== leadIds.length) {
      throw new NotFoundException({ code: "not_found", message: "One or more selected leads are not active in this organization" });
    }
    const members = await this.prisma.membership.findMany({
      where: { organizationId, userId: { in: assigneeUserIds }, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { userId: true, user: { select: { name: true } } },
    });
    const names = new Map(members.map(({ userId, user }) => [userId, user.name]));
    const assignments = leads.map((lead, index) => {
      const ownerUserId = assigneeUserIds[index % assigneeUserIds.length];
      if (!ownerUserId) throw this.invalid("Could not determine a lead recipient");
      return {
        leadId: lead.id,
        name: lead.name,
        currentOwner: lead.owner.user.name,
        ownerUserId,
        owner: names.get(ownerUserId) ?? "",
      };
    });
    return { data: { scope, assignedCount: assignments.length, assigneeCount: assigneeUserIds.length, assignments } };
  }

  @Patch("distribute")
  async applyDistribution(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    this.requireAssignmentManager(request);
    const { organizationId, userId } = this.context(request);
    const assignments = this.parseAssignments(body?.assignments);
    const assigneeUserIds = [...new Set(assignments.map(({ ownerUserId }) => ownerUserId))];
    const distributionCounts = new Map(assigneeUserIds.map((id) => [id, 0]));
    for (const { ownerUserId } of assignments) {
      distributionCounts.set(ownerUserId, (distributionCounts.get(ownerUserId) ?? 0) + 1);
    }
    const counts = [...distributionCounts.values()];
    if (Math.max(...counts) - Math.min(...counts) > 1) {
      throw this.invalid("Lead assignments must be split as evenly as possible across selected employees");
    }
    await this.requireActiveAssignees(organizationId, assigneeUserIds);
    await this.prisma.$transaction(async (transaction) => {
      const leads = await transaction.lead.findMany({
        where: { organizationId, archivedAt: null, id: { in: assignments.map(({ leadId }) => leadId) } },
        select: { id: true },
      });
      if (leads.length !== assignments.length) {
        throw new NotFoundException({ code: "not_found", message: "One or more leads are no longer active in this organization" });
      }
      for (const assignment of assignments) {
        await transaction.lead.updateMany({
          where: { id: assignment.leadId, organizationId, archivedAt: null },
          data: { ownerUserId: assignment.ownerUserId },
        });
      }
      await transaction.auditLog.createMany({
        data: assignments.map(({ leadId }) => ({
          organizationId,
          actorUserId: userId,
          action: "UPDATE",
          resourceType: "lead_assignment",
          resourceId: leadId,
        })),
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { data: { assignedCount: assignments.length } };
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
    const { organizationId, userId } = this.context(request);
    const patch: { name?: string; company?: string; source?: DbLeadSource; status?: DbLeadStatus } = {};
    if ("name" in (body ?? {})) patch.name = this.requiredText(body.name, "name", 120);
    if ("company" in (body ?? {})) patch.company = this.requiredText(body.company, "company", 160);
    if ("source" in (body ?? {})) patch.source = sourceToDatabase[this.enumValue(body.source, sources, "source")];
    if ("status" in (body ?? {})) patch.status = statusToDatabase[this.enumValue(body.status, statuses, "status")];
    if (Object.keys(patch).length === 0) throw new BadRequestException({ code: "validation_error", message: "Provide at least one editable lead field" });
    const ownerUserId = assignedOwnerFilter(request);
    const result = await this.prisma.$transaction(async (tx) => {
      const where = { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) };
      const before = await tx.lead.findFirst({ where });
      if (!before) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      const result = await tx.lead.updateMany({ where, data: patch });
      if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      const updatedLead = await tx.lead.findFirst({
        where,
        include: { owner: { include: { user: { select: { name: true } } } } },
      });
      if (!updatedLead) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      if (patch.status && before.status !== patch.status) {
        const generatedActivityIds = await this.automations.runForLead(tx, {
          organizationId,
          actorUserId: userId,
          leadId: updatedLead.id,
          leadName: updatedLead.name,
          leadOwnerUserId: updatedLead.ownerUserId,
          status: updatedLead.status,
          event: "lead_status_changed",
        });
        return { lead: updatedLead, generatedActivityIds: generatedActivityIds ?? [] };
      }
      return { lead: updatedLead, generatedActivityIds: [] as string[] };
    });
    await this.auditGeneratedActivities(result.generatedActivityIds, organizationId, userId);
    return { data: this.present(result.lead) };
  }

  private async auditGeneratedActivities(activityIds: string[], organizationId: string, actorUserId: string) {
    for (const resourceId of activityIds) {
      try {
        await this.prisma.auditLog.create({
          data: { organizationId, actorUserId, action: "CREATE", resourceType: "activity", resourceId },
        });
      } catch (cause) {
        this.logger.error("Could not persist audit event for automation-generated activity", cause instanceof Error ? cause.stack : undefined);
      }
    }
  }

  private async nextLeadOwner(tx: Prisma.TransactionClient, organizationId: string, defaultUserId: string) {
    const settings = await tx.organizationSettings.findUnique({
      where: { organizationId },
      select: { leadAutoAssignEnabled: true, leadAutoAssignUserIds: true },
    });
    if (!settings?.leadAutoAssignEnabled) return defaultUserId;
    if (settings.leadAutoAssignUserIds.length === 0) {
      throw new BadRequestException({ code: "validation_error", message: "No team members are configured for automatic lead assignment" });
    }
    const eligibleMembers = await tx.membership.findMany({
      where: {
        organizationId,
        userId: { in: settings.leadAutoAssignUserIds },
        status: "ACTIVE",
        role: { not: "READ_ONLY" },
        user: { status: "ACTIVE" },
      },
      select: { userId: true },
    });
    const eligibleUserIds = settings.leadAutoAssignUserIds.filter((id) =>
      eligibleMembers.some((member) => member.userId === id),
    );
    if (eligibleUserIds.length === 0) {
      throw new BadRequestException({ code: "validation_error", message: "No active team members are configured for automatic lead assignment" });
    }
    const cursor = await tx.organizationSettings.update({
      where: { organizationId },
      data: { leadAutoAssignCursor: { increment: 1 } },
      select: { leadAutoAssignCursor: true },
    });
    const ownerUserId = eligibleUserIds[(cursor.leadAutoAssignCursor - 1) % eligibleUserIds.length];
    if (!ownerUserId) throw new BadRequestException({ code: "validation_error", message: "Could not determine the next lead owner" });
    return ownerUserId;
  }

  private parseLeadImportRows(value: unknown): LeadImportRow[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
      throw this.invalid("Import between 1 and 500 leads at a time");
    }
    return value.map((value, index) => {
      const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const company = typeof row.company === "string" ? row.company.trim() : "";
      const sourceValue = typeof row.source === "string" && row.source.trim() ? row.source.trim().toLowerCase() : "website";
      const statusValue = typeof row.status === "string" && row.status.trim() ? row.status.trim().toLowerCase() : "new";
      const errors: string[] = [];
      if (!name || name.length > 120) errors.push("Name is required and must be at most 120 characters.");
      if (!company || company.length > 160) errors.push("Company is required and must be at most 160 characters.");
      if (!sources.includes(sourceValue as LeadSourceValue)) errors.push("Source must be website, referral, linkedin, or other.");
      if (!statuses.includes(statusValue as LeadStatusValue)) errors.push("Status must be new, contacted, qualified, or disqualified.");
      return {
        row: index + 2,
        name,
        company,
        source: sources.includes(sourceValue as LeadSourceValue) ? sourceValue as LeadSourceValue : "website",
        status: statuses.includes(statusValue as LeadStatusValue) ? statusValue as LeadStatusValue : "new",
        errors,
      };
    });
  }

  private async validateLeadImport(
    organizationId: string,
    rows: LeadImportRow[],
    db: Pick<Prisma.TransactionClient, "lead">,
  ) {
    const keyFor = (name: string, company: string) => `${name.trim().toLocaleLowerCase()}\u0000${company.trim().toLocaleLowerCase()}`;
    const seen = new Map<string, LeadImportRow[]>();
    for (const row of rows) {
      const key = keyFor(row.name, row.company);
      if (!row.name || !row.company) continue;
      seen.set(key, [...(seen.get(key) ?? []), row]);
    }
    for (const duplicates of seen.values()) {
      if (duplicates.length > 1) duplicates.forEach((row) => row.errors.push("This lead is duplicated in the import file."));
    }
    const validRows = rows.filter(({ errors }) => errors.length === 0);
    if (!validRows.length) return rows;
    const existing = await db.lead.findMany({
      where: {
        organizationId,
        archivedAt: null,
        OR: validRows.map(({ name, company }) => ({
          name: { equals: name, mode: "insensitive" as const },
          company: { equals: company, mode: "insensitive" as const },
        })),
      },
      select: { name: true, company: true },
    });
    const existingKeys = new Set(existing.map(({ name, company }) => keyFor(name, company)));
    for (const row of validRows) {
      if (existingKeys.has(keyFor(row.name, row.company))) {
        row.errors.push("A lead with this name and company already exists in this workspace.");
      }
    }
    return rows;
  }

  private parseAssignments(value: unknown): LeadAssignment[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) {
      throw this.invalid("Assignments must contain between 1 and 10,000 leads");
    }
    const assignments = value.map((value) => {
      const assignment = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      if (
        typeof assignment.leadId !== "string" || !uuidPattern.test(assignment.leadId) ||
        typeof assignment.ownerUserId !== "string" || !uuidPattern.test(assignment.ownerUserId)
      ) {
        throw this.invalid("Every assignment requires valid lead and employee IDs");
      }
      return { leadId: assignment.leadId, ownerUserId: assignment.ownerUserId };
    });
    if (new Set(assignments.map(({ leadId }) => leadId)).size !== assignments.length) {
      throw this.invalid("A lead can only appear once in the proposed assignments");
    }
    return assignments;
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

  private canManageAssignments(request: HttpRequest) {
    return assignmentManagers.has(request.organizationRole ?? "");
  }

  private requireAssignmentManager(request: HttpRequest) {
    if (!this.canManageAssignments(request)) {
      throw new ForbiddenException({ code: "forbidden", message: "Only the Organization Owner or Admin can manage bulk lead actions" });
    }
  }

  private userIds(value: unknown, field: string, maximum: number) {
    if (!Array.isArray(value) || value.length > maximum || value.some((id) => typeof id !== "string" || !uuidPattern.test(id))) {
      throw this.invalid(`${field} must contain at most ${maximum} valid IDs`);
    }
    return [...new Set(value as string[])];
  }

  private async requireActiveAssignees(
    organizationId: string,
    userIds: string[],
    db: Pick<PrismaService, "membership"> = this.prisma,
  ) {
    if (userIds.length === 0) return;
    const members = await db.membership.findMany({
      where: {
        organizationId,
        userId: { in: userIds },
        status: "ACTIVE",
        role: { not: "READ_ONLY" },
        user: { status: "ACTIVE" },
      },
      select: { userId: true },
    });
    if (members.length !== userIds.length) {
      throw this.invalid("Choose only active team members who can own leads");
    }
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

  private prismaCode(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  }
}
