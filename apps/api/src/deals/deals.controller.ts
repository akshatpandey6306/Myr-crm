import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { assignedOwnerFilter, requireRecordArchive, requireRecordWrite } from "../auth/record-permissions.js";
import { PrismaService } from "../prisma/prisma.service.js";

const statuses = ["open", "won", "lost"] as const;
const sortFields = ["createdAt", "name", "value", "closeDate"] as const;
const sortOrders = ["asc", "desc"] as const;
type DealStatus = (typeof statuses)[number];
type DatabaseStatus = "OPEN" | "WON" | "LOST";
const statusToDatabase: Record<DealStatus, DatabaseStatus> = { open: "OPEN", won: "WON", lost: "LOST" };

@Controller("deals")
export class DealsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("pipelineId") pipelineId?: string,
    @Query("status") status?: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
    @Query("sortBy") sortByValue?: string,
    @Query("sortOrder") sortOrderValue?: string,
  ) {
    const organizationId = this.organizationId(request);
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    if (status && !statuses.includes(status as DealStatus)) throw this.invalid("Invalid status value");
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const sortBy = sortByValue ?? "createdAt";
    const sortOrder = sortOrderValue ?? "desc";
    if (!sortFields.includes(sortBy as (typeof sortFields)[number])) throw this.invalid("Invalid sortBy value");
    if (!sortOrders.includes(sortOrder as (typeof sortOrders)[number])) throw this.invalid("Invalid sortOrder value");
    const orderBy = sortBy === "name" ? { name: sortOrder as "asc" | "desc" }
      : sortBy === "value" ? { value: sortOrder as "asc" | "desc" }
        : sortBy === "closeDate" ? { closeDate: sortOrder as "asc" | "desc" }
          : { createdAt: sortOrder as "asc" | "desc" };
    const search = query?.trim();
    const ownerUserId = assignedOwnerFilter(request);
    const where = {
      organizationId,
      archivedAt: null,
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(pipelineId ? { pipelineId } : {}),
      ...(status ? { status: statusToDatabase[status as DealStatus] } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { company: { name: { contains: search, mode: "insensitive" as const } } },
      ] } : {}),
    };
    const [total, deals] = await Promise.all([
      this.prisma.deal.count({ where }),
      this.prisma.deal.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          company: { select: { id: true, name: true } },
          pipeline: { select: { id: true, name: true } },
          stage: { select: { id: true, name: true, position: true } },
          owner: { include: { user: { select: { name: true } } } },
        },
      }),
    ]);
    return { data: deals.map((deal) => this.present(deal)), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const name = this.text(body?.name, "name", 160);
    const value = this.money(body?.value ?? 0);
    const closeDate = this.date(body?.closeDate);
    const status = this.status(body?.status ?? "open");
    const pipelineId = typeof body?.pipelineId === "string" ? body.pipelineId : undefined;
    const pipeline = pipelineId
      ? await this.prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId }, select: { id: true } })
      : await this.prisma.pipeline.findFirst({ where: { organizationId, isDefault: true }, select: { id: true } });
    if (!pipeline) throw this.invalid("Choose a pipeline in this workspace");
    const stageId = typeof body?.stageId === "string" ? body.stageId : undefined;
    const stage = stageId
      ? await this.prisma.pipelineStage.findFirst({ where: { id: stageId, organizationId, pipelineId: pipeline.id }, select: { id: true } })
      : await this.prisma.pipelineStage.findFirst({ where: { organizationId, pipelineId: pipeline.id }, orderBy: { position: "asc" }, select: { id: true } });
    if (!stage) throw this.invalid("Choose a stage in the selected pipeline");
    const companyId = await this.companyId(body?.companyId, organizationId);
    const deal = await this.prisma.deal.create({
      data: {
        organizationId, name, value, closeDate, status: statusToDatabase[status],
        pipelineId: pipeline.id, stageId: stage.id, companyId,
        ownerUserId: userId, createdByUserId: userId,
      },
      include: this.includes(),
    });
    return { data: this.present(deal) };
  }

  @Get(":id")
  async get(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const ownerUserId = assignedOwnerFilter(request);
    const deal = await this.prisma.deal.findFirst({
      where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) },
      include: this.includes(),
    });
    if (!deal) throw new NotFoundException({ code: "not_found", message: "Deal not found" });
    return { data: this.present(deal) };
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const patch: Record<string, unknown> = {};
    if ("name" in (body ?? {})) patch.name = this.text(body.name, "name", 160);
    if ("value" in (body ?? {})) patch.value = this.money(body.value);
    if ("closeDate" in (body ?? {})) patch.closeDate = this.date(body.closeDate);
    if ("status" in (body ?? {})) patch.status = statusToDatabase[this.status(body.status)];
    if ("companyId" in (body ?? {})) patch.companyId = await this.companyId(body.companyId, organizationId);

    const current = await this.prisma.deal.findFirst({
      where: { id, organizationId, archivedAt: null, ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) },
      select: { id: true, pipelineId: true, stageId: true },
    });
    if (!current) throw new NotFoundException({ code: "not_found", message: "Deal not found" });

    const pipelineId = typeof body?.pipelineId === "string" ? body.pipelineId : current.pipelineId;
    if ("pipelineId" in (body ?? {}) && typeof body.pipelineId !== "string") throw this.invalid("pipelineId must be a pipeline ID");
    const stageChanged = "stageId" in (body ?? {}) || pipelineId !== current.pipelineId;
    if (stageChanged) {
      const pipeline = await this.prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId }, select: { id: true } });
      if (!pipeline) throw this.invalid("Choose a pipeline in this workspace");
      const stageId = typeof body?.stageId === "string" ? body.stageId : undefined;
      const stage = stageId
        ? await this.prisma.pipelineStage.findFirst({ where: { id: stageId, organizationId, pipelineId }, select: { id: true } })
        : await this.prisma.pipelineStage.findFirst({ where: { organizationId, pipelineId }, orderBy: { position: "asc" }, select: { id: true } });
      if (!stage) throw this.invalid("Choose a stage in the selected pipeline");
      patch.pipelineId = pipelineId;
      patch.stageId = stage.id;
    }
    if (Object.keys(patch).length === 0) throw this.invalid("Provide at least one editable deal field");
    const result = await this.prisma.deal.updateMany({
      where: { id, organizationId, archivedAt: null, ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) },
      data: patch,
    });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Deal not found" });
    const deal = await this.prisma.deal.findFirst({ where: { id, organizationId }, include: this.includes() });
    if (!deal) throw new NotFoundException({ code: "not_found", message: "Deal not found" });
    return { data: this.present(deal) };
  }

  @Delete(":id")
  async archive(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordArchive(request);
    const result = await this.prisma.deal.updateMany({
      where: { id, organizationId: this.organizationId(request), archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Deal not found" });
    return { ok: true };
  }

  private includes() {
    return {
      company: { select: { id: true, name: true } },
      pipeline: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true, position: true } },
      owner: { include: { user: { select: { name: true } } } },
    };
  }

  private present(deal: {
    id: string; name: string; value: { toString(): string }; closeDate: Date | null; status: string;
    company: { id: string; name: string } | null; pipeline: { id: string; name: string };
    stage: { id: string; name: string; position: number }; createdAt: Date; updatedAt: Date;
    owner: { user: { name: string } };
  }) {
    return {
      id: deal.id,
      name: deal.name,
      value: deal.value.toString(),
      closeDate: deal.closeDate?.toISOString().slice(0, 10) ?? null,
      status: deal.status.toLowerCase(),
      company: deal.company,
      pipeline: deal.pipeline,
      stage: deal.stage,
      owner: deal.owner.user.name,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    };
  }

  private async companyId(value: unknown, organizationId: string): Promise<string | null> {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw this.invalid("companyId must be a company ID");
    const company = await this.prisma.company.findFirst({ where: { id: value, organizationId, archivedAt: null }, select: { id: true } });
    if (!company) throw this.invalid("Choose an active company in this workspace");
    return company.id;
  }

  private status(value: unknown): DealStatus {
    if (typeof value !== "string" || !statuses.includes(value as DealStatus)) throw this.invalid("Invalid status value");
    return value as DealStatus;
  }

  private money(value: unknown) {
    const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    if (!Number.isFinite(amount) || amount < 0 || amount > 9_999_999_999.99 || Math.round(amount * 100) !== amount * 100) {
      throw this.invalid("value must be a non-negative amount with at most two decimal places");
    }
    return amount.toFixed(2);
  }

  private date(value: unknown): Date | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw this.invalid("closeDate must use YYYY-MM-DD");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw this.invalid("closeDate must be a valid calendar date");
    return date;
  }

  private text(value: unknown, field: string, maxLength: number) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      throw this.invalid(`${field} is required and must be at most ${maxLength} characters`);
    }
    return value.trim();
  }

  private context(request: HttpRequest) {
    if (!request.orgId || !request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    return { organizationId: request.orgId, userId: request.userId };
  }

  private organizationId(request: HttpRequest) {
    return this.context(request).organizationId;
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
