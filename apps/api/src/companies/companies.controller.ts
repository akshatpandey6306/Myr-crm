import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assignedOwnerFilter, requireRecordArchive, requireRecordWrite } from "../auth/record-permissions.js";

const sortFields = ["createdAt", "name", "industry"] as const;
const sortOrders = ["asc", "desc"] as const;

@Controller("companies")
export class CompaniesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
    @Query("sortBy") sortByValue?: string,
    @Query("sortOrder") sortOrderValue?: string,
  ) {
    const organizationId = this.organizationId(request);
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const sortBy = sortByValue ?? "createdAt";
    const sortOrder = sortOrderValue ?? "desc";
    if (!sortFields.includes(sortBy as (typeof sortFields)[number])) throw this.invalid("Invalid sortBy value");
    if (!sortOrders.includes(sortOrder as (typeof sortOrders)[number])) throw this.invalid("Invalid sortOrder value");
    const orderBy = sortBy === "name" ? { name: sortOrder as "asc" | "desc" }
      : sortBy === "industry" ? { industry: sortOrder as "asc" | "desc" }
        : { createdAt: sortOrder as "asc" | "desc" };
    const search = query?.trim();
    const ownerUserId = assignedOwnerFilter(request);
    const where = {
      organizationId,
      archivedAt: null,
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { industry: { contains: search, mode: "insensitive" as const } },
        { website: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const [total, companies] = await Promise.all([
      this.prisma.company.count({ where }),
      this.prisma.company.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { owner: { include: { user: { select: { name: true } } } } },
      }),
    ]);
    return {
      data: companies.map((company) => this.present(company)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const company = await this.prisma.company.create({
      data: { ...this.fields(body, true), organizationId, ownerUserId: userId, createdByUserId: userId },
      include: { owner: { include: { user: { select: { name: true } } } } },
    });
    return { data: this.present(company) };
  }

  @Get(":id")
  async get(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const ownerUserId = assignedOwnerFilter(request);
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) },
      include: { owner: { include: { user: { select: { name: true } } } } },
    });
    if (!company) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    return { data: this.present(company) };
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const patch = this.fields(body, false);
    if (Object.keys(patch).length === 0) throw this.invalid("Provide at least one editable company field");
    const ownerUserId = assignedOwnerFilter(request);
    const where = { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) };
    const result = await this.prisma.company.updateMany({ where, data: patch });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) },
      include: { owner: { include: { user: { select: { name: true } } } } },
    });
    if (!company) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    return { data: this.present(company) };
  }

  @Delete(":id")
  async archive(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordArchive(request);
    const organizationId = this.organizationId(request);
    const result = await this.prisma.company.updateMany({
      where: { id, organizationId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    return { ok: true };
  }

  private fields(body: Record<string, unknown>, required: true): { name: string; industry: string | null; website: string | null; phone: string | null };
  private fields(body: Record<string, unknown>, required: false): Partial<{ name: string; industry: string | null; website: string | null; phone: string | null }>;
  private fields(body: Record<string, unknown>, required: boolean) {
    const patch: Partial<{ name: string; industry: string | null; website: string | null; phone: string | null }> = {};
    for (const field of ["name", "industry", "website", "phone"] as const) {
      if (!required && !(field in (body ?? {}))) continue;
      if (required && field !== "name" && !(field in (body ?? {}))) {
        patch[field] = null;
        continue;
      }
      const value = body?.[field];
      if (!required && field !== "name" && (value === null || value === "")) {
        patch[field] = null;
        continue;
      }
      const max = field === "name" ? 160 : field === "industry" ? 120 : field === "website" ? 255 : 40;
      if (field !== "name" && (value === null || value === "")) {
        patch[field] = null;
        continue;
      }
      if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
        throw this.invalid(`${field} must be a non-empty string of at most ${max} characters`);
      }
      const cleaned = value.trim();
      if (field === "website") {
        let url: URL;
        try {
          url = new URL(cleaned);
        } catch {
          throw this.invalid("website must be a valid HTTP or HTTPS URL");
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") throw this.invalid("website must be a valid HTTP or HTTPS URL");
      }
      patch[field] = cleaned;
    }
    return patch;
  }

  private present(company: { id: string; name: string; industry: string | null; website: string | null; phone: string | null; createdAt: Date; updatedAt: Date; owner: { user: { name: string } } }) {
    return {
      id: company.id,
      name: company.name,
      industry: company.industry,
      website: company.website,
      phone: company.phone,
      owner: company.owner.user.name,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
    };
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
