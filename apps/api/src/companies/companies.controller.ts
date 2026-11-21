import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assignedOwnerFilter, requireRecordArchive, requireRecordWrite } from "../auth/record-permissions.js";

const sortFields = ["createdAt", "name", "industry"] as const;
const sortOrders = ["asc", "desc"] as const;
const companyStatuses = ["prospect", "engaged", "opportunity", "customer", "inactive", "lost"] as const;
const leadSources = ["website", "facebook", "instagram", "meta_ads", "google", "referral", "linkedin", "other"] as const;
const sourceToDatabase = { website: "WEBSITE", facebook: "FACEBOOK", instagram: "INSTAGRAM", meta_ads: "META_ADS", google: "GOOGLE", referral: "REFERRAL", linkedin: "LINKEDIN", other: "OTHER" } as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    @Query("industry") industry?: string,
    @Query("status") status?: string,
    @Query("leadSource") leadSource?: string,
    @Query("companyType") companyType?: string,
    @Query("ownerUserId") requestedOwnerUserId?: string,
    @Query("archived") archived?: string,
  ) {
    const organizationId = this.organizationId(request);
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const sortBy = sortByValue ?? "createdAt";
    const sortOrder = sortOrderValue ?? "desc";
    if (!sortFields.includes(sortBy as (typeof sortFields)[number])) throw this.invalid("Invalid sortBy value");
    if (!sortOrders.includes(sortOrder as (typeof sortOrders)[number])) throw this.invalid("Invalid sortOrder value");
    if (industry && industry.length > 120) throw this.invalid("industry must be at most 120 characters");
    if (status && !companyStatuses.includes(status as (typeof companyStatuses)[number])) throw this.invalid("Invalid company status");
    if (leadSource && !leadSources.includes(leadSource.toLowerCase() as (typeof leadSources)[number])) throw this.invalid("Invalid company lead source");
    if (companyType && companyType.length > 80) throw this.invalid("companyType must be at most 80 characters");
    if (archived && archived !== "true" && archived !== "false") throw this.invalid("archived must be true or false");
    const canManage = ["owner", "admin"].includes(String(request.organizationRole ?? ""));
    if (requestedOwnerUserId && !canManage && requestedOwnerUserId !== request.userId) throw this.invalid("Only workspace administrators can filter by another owner");
    if (requestedOwnerUserId) {
      const validOwner = await this.prisma.membership.count({ where: { organizationId, userId: requestedOwnerUserId, status: "ACTIVE", user: { status: "ACTIVE" } } });
      if (!validOwner) throw this.invalid("Owner must be an active member of this workspace");
    }
    const orderBy = sortBy === "name" ? { name: sortOrder as "asc" | "desc" }
      : sortBy === "industry" ? { industry: sortOrder as "asc" | "desc" }
        : { createdAt: sortOrder as "asc" | "desc" };
    const search = query?.trim();
    const ownerUserId = assignedOwnerFilter(request);
    const where = {
      organizationId,
      archivedAt: archived === "true" ? { not: null } : null,
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(requestedOwnerUserId && canManage ? { ownerUserId: requestedOwnerUserId } : {}),
      ...(industry ? { industry: { equals: industry, mode: "insensitive" as const } } : {}),
      ...(status ? { status: status.toUpperCase() as "PROSPECT" | "ENGAGED" | "OPPORTUNITY" | "CUSTOMER" | "INACTIVE" | "LOST" } : {}),
      ...(leadSource ? { leadSource: sourceToDatabase[leadSource.toLowerCase() as keyof typeof sourceToDatabase] } : {}),
      ...(companyType ? { companyType: { equals: companyType, mode: "insensitive" as const } } : {}),
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
        include: { owner: { include: { user: { select: { name: true } } } }, parentCompany: { select: { id: true, name: true } }, _count: { select: { contacts: { where: { archivedAt: null } }, deals: { where: { archivedAt: null } } } } },
      }),
    ]);
    const companyIds = companies.map(({ id }) => id);
    const [lastActivityRows, nextFollowUpRows] = companyIds.length
      ? await Promise.all([
        this.prisma.activity.groupBy({ by: ["relatedToId"], where: { organizationId, archivedAt: null, relatedToType: "COMPANY", relatedToId: { in: companyIds } }, _max: { createdAt: true } }),
        this.prisma.activity.groupBy({ by: ["relatedToId"], where: { organizationId, archivedAt: null, relatedToType: "COMPANY", relatedToId: { in: companyIds }, status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { gte: new Date() } }, _min: { dueAt: true } }),
      ])
      : [[], []];
    const lastActivityByCompany = new Map(lastActivityRows.map((row) => [row.relatedToId, row._max.createdAt]));
    const nextFollowUpByCompany = new Map(nextFollowUpRows.map((row) => [row.relatedToId, row._min.dueAt]));
    return {
      data: companies.map((company) => ({
        ...this.present(company),
        lastActivityAt: lastActivityByCompany.get(company.id)?.toISOString() ?? null,
        nextFollowUpAt: nextFollowUpByCompany.get(company.id)?.toISOString() ?? null,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Get("summary")
  async summary(@Req() request: HttpRequest) {
    const organizationId = this.organizationId(request);
    const ownerUserId = assignedOwnerFilter(request);
    const where = { organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) };
    const [total, grouped, openDeals] = await Promise.all([
      this.prisma.company.count({ where }),
      this.prisma.company.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.prisma.deal.aggregate({ where: { organizationId, archivedAt: null, status: "OPEN", ...(ownerUserId ? { ownerUserId } : {}) }, _sum: { value: true } }),
    ]);
    const counts = Object.fromEntries(grouped.map((row) => [row.status.toLowerCase(), row._count._all]));
    return { data: { total, customers: counts.customer ?? 0, prospects: counts.prospect ?? 0, opportunities: counts.opportunity ?? 0, openPipelineValue: openDeals._sum.value?.toString() ?? "0", byStatus: counts } };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const data = this.fields(body, true) as Prisma.CompanyUncheckedCreateInput;
    const ownerUserId = await this.resolveOwner(request, organizationId, body.ownerUserId);
    const parentCompanyId = await this.resolveParent(organizationId, null, body.parentCompanyId);
    const company = await this.prisma.company.create({
      data: { ...data, organizationId, ownerUserId: ownerUserId ?? userId, createdByUserId: userId, ...(parentCompanyId !== undefined ? { parentCompanyId } : {}) },
      include: { owner: { include: { user: { select: { name: true } } } }, parentCompany: { select: { id: true, name: true } }, _count: { select: { contacts: { where: { archivedAt: null } }, deals: { where: { archivedAt: null } } } } },
    });
    return { data: this.present(company as Parameters<typeof this.present>[0]) };
  }

  @Get(":id")
  async get(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const ownerUserId = assignedOwnerFilter(request);
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) },
      include: { owner: { include: { user: { select: { name: true } } } }, parentCompany: { select: { id: true, name: true } }, _count: { select: { contacts: { where: { archivedAt: null } }, deals: { where: { archivedAt: null } } } }, contacts: { where: { archivedAt: null }, select: { id: true, name: true, email: true, phone: true, title: true, companyId: true, owner: { select: { user: { select: { name: true } } } } }, orderBy: { name: "asc" }, take: 100 }, deals: { where: { archivedAt: null }, select: { id: true, name: true, value: true, closeDate: true, status: true, owner: { select: { user: { select: { name: true } } } }, pipeline: { select: { name: true } }, stage: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 } },
    });
    if (!company) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    return { data: this.present(company) };
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const patch = this.fields(body, false);
    const resolvedOwner = "ownerUserId" in (body ?? {}) ? await this.resolveOwner(request, organizationId, body.ownerUserId) : undefined;
    const parentCompanyId = "parentCompanyId" in (body ?? {}) ? await this.resolveParent(organizationId, id, body.parentCompanyId) : undefined;
    if (resolvedOwner) Object.assign(patch, { ownerUserId: resolvedOwner });
    if (parentCompanyId !== undefined) Object.assign(patch, { parentCompanyId });
    if (Object.keys(patch).length === 0) throw this.invalid("Provide at least one editable company field");
    const ownerUserId = assignedOwnerFilter(request);
    const where = { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) };
    const result = await this.prisma.company.updateMany({ where, data: patch });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) },
      include: { owner: { include: { user: { select: { name: true } } } }, parentCompany: { select: { id: true, name: true } }, _count: { select: { contacts: { where: { archivedAt: null } }, deals: { where: { archivedAt: null } } } } },
    });
    if (!company) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    return { data: this.present(company) };
  }

  @Post(":id/restore")
  async restore(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordArchive(request);
    const organizationId = this.organizationId(request);
    const result = await this.prisma.company.updateMany({ where: { id, organizationId, archivedAt: { not: null } }, data: { archivedAt: null } });
    if (!result.count) throw new NotFoundException({ code: "not_found", message: "Archived company not found" });
    return { ok: true };
  }

  @Patch("bulk/update")
  async bulkUpdate(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === "string"))] : [];
    if (!ids.length || ids.length > 100 || ids.some((id) => !uuidPattern.test(id))) throw this.invalid("Select between 1 and 100 valid companies");
    const patch: Prisma.CompanyUncheckedUpdateManyInput = {};
    if ("status" in (body ?? {})) {
      const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
      if (!companyStatuses.includes(status as (typeof companyStatuses)[number])) throw this.invalid("Invalid company status");
      patch.status = status.toUpperCase() as NonNullable<Prisma.CompanyUncheckedUpdateManyInput["status"]>;
    }
    if ("ownerUserId" in (body ?? {})) {
      if (!["owner", "admin"].includes(String(request.organizationRole ?? ""))) throw new BadRequestException({ code: "forbidden", message: "Only workspace administrators can reassign companies" });
      const targetOwner = await this.resolveOwner(request, organizationId, body.ownerUserId);
      if (!targetOwner) throw this.invalid("Choose an active workspace owner");
      patch.ownerUserId = targetOwner;
    }
    if (!Object.keys(patch).length) throw this.invalid("Choose a company status or owner update");
    const ownerUserId = assignedOwnerFilter(request);
    const where = { organizationId, archivedAt: null, id: { in: ids }, ...(ownerUserId ? { ownerUserId } : {}) };
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.company.count({ where });
      if (count !== ids.length) throw new NotFoundException({ code: "not_found", message: "One or more selected companies are unavailable" });
      await tx.company.updateMany({ where, data: patch });
    });
    return { data: { updatedCount: ids.length } };
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

  private fields(body: Record<string, unknown>, required: true): Record<string, unknown>;
  private fields(body: Record<string, unknown>, required: false): Record<string, unknown>;
  private fields(body: Record<string, unknown>, required: boolean) {
    const patch: Record<string, unknown> = {};
    const textFields = ["name", "industry", "website", "phone", "email", "logoUrl", "companyType", "description", "registrationNumber", "country", "state", "city", "address", "postalCode", "internalNotes"] as const;
    for (const field of textFields) {
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
      const max = field === "name" ? 160 : field === "industry" || field === "state" || field === "city" || field === "country" ? 120 : field === "website" ? 255 : field === "logoUrl" ? 2048 : field === "email" || field === "registrationNumber" ? 254 : field === "companyType" ? 80 : field === "address" ? 500 : field === "postalCode" || field === "phone" ? 40 : field === "description" || field === "internalNotes" ? 10000 : 254;
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
      if (field === "logoUrl") {
        let url: URL;
        try { url = new URL(cleaned); } catch { throw this.invalid("logoUrl must be a valid HTTP or HTTPS URL"); }
        if (url.protocol !== "http:" && url.protocol !== "https:") throw this.invalid("logoUrl must be a valid HTTP or HTTPS URL");
      }
      if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) throw this.invalid("email must be a valid email address");
      patch[field] = cleaned;
    }
    if (required || "employeeCount" in (body ?? {})) {
      const raw = body?.employeeCount;
      if (raw === null || raw === undefined || raw === "") patch.employeeCount = null;
      else if (!Number.isInteger(Number(raw)) || Number(raw) < 0 || Number(raw) > 100000000) throw this.invalid("employeeCount must be a non-negative integer");
      else patch.employeeCount = Number(raw);
    }
    if (required || "annualRevenue" in (body ?? {})) {
      const raw = body?.annualRevenue;
      if (raw === null || raw === undefined || raw === "") patch.annualRevenue = null;
      else if (!Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 999999999999.99) throw this.invalid("annualRevenue must be a non-negative amount");
      else patch.annualRevenue = Number(raw).toFixed(2);
    }
    if (required || "status" in (body ?? {})) {
      const status = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "prospect";
      if (!companyStatuses.includes(status as (typeof companyStatuses)[number])) throw this.invalid("Invalid company status");
      patch.status = status.toUpperCase();
    }
    if (required || "leadSource" in (body ?? {})) {
      const source = body?.leadSource;
      if (source === undefined || source === null || source === "") patch.leadSource = null;
      else if (typeof source !== "string" || !leadSources.includes(source.toLowerCase() as (typeof leadSources)[number])) throw this.invalid("Invalid company lead source");
      else patch.leadSource = sourceToDatabase[source.toLowerCase() as keyof typeof sourceToDatabase];
    }
    if (required || "tags" in (body ?? {})) {
      const tags = body?.tags ?? [];
      if (!Array.isArray(tags) || tags.length > 50 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 48)) throw this.invalid("tags must contain up to 50 non-empty labels of 48 characters or fewer");
      patch.tags = [...new Set(tags.map((tag) => (tag as string).trim()))];
    }
    if (required || "customFields" in (body ?? {})) {
      const customFields = body?.customFields ?? {};
      if (!customFields || typeof customFields !== "object" || Array.isArray(customFields) || JSON.stringify(customFields).length > 16000) throw this.invalid("customFields must be a JSON object under 16 KB");
      patch.customFields = customFields as Prisma.InputJsonValue;
    }
    return patch;
  }

  private async resolveOwner(request: HttpRequest, organizationId: string, raw: unknown) {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (!["owner", "admin"].includes(String(request.organizationRole ?? ""))) throw new BadRequestException({ code: "forbidden", message: "Only workspace administrators can assign a different company owner" });
    if (typeof raw !== "string" || !uuidPattern.test(raw)) throw this.invalid("ownerUserId must be a valid workspace member ID");
    const count = await this.prisma.membership.count({ where: { organizationId, userId: raw, status: "ACTIVE", user: { status: "ACTIVE" } } });
    if (!count) throw this.invalid("Owner must be an active member of this workspace");
    return raw;
  }

  private async resolveParent(organizationId: string, companyId: string | null, raw: unknown) {
    if (raw === undefined) return undefined;
    if (raw === null || raw === "") return null;
    if (typeof raw !== "string" || !uuidPattern.test(raw)) throw this.invalid("parentCompanyId must be a valid company ID");
    if (raw === companyId) throw this.invalid("A company cannot be its own parent");
    let ancestorId: string | null = raw;
    const visited = new Set<string>();
    for (let depth = 0; ancestorId && depth < 64; depth += 1) {
      if (ancestorId === companyId) throw this.invalid("A company cannot be placed under one of its own subsidiaries");
      if (visited.has(ancestorId)) throw this.invalid("The selected parent has a circular company hierarchy");
      visited.add(ancestorId);
      const ancestor: { id: string; parentCompanyId: string | null } | null = await this.prisma.company.findFirst({ where: { id: ancestorId, organizationId, archivedAt: null }, select: { id: true, parentCompanyId: true } });
      if (!ancestor) throw new NotFoundException({ code: "not_found", message: "Parent company not found in this workspace" });
      ancestorId = ancestor.parentCompanyId;
    }
    if (ancestorId) throw this.invalid("Company hierarchy exceeds the supported depth");
    return raw;
  }

  private present(company: { id: string; name: string; industry: string | null; website: string | null; phone: string | null; email: string | null; logoUrl: string | null; companyType: string | null; description: string | null; employeeCount: number | null; annualRevenue: Prisma.Decimal | null; registrationNumber: string | null; parentCompanyId: string | null; parentCompany?: { id: string; name: string } | null; country: string | null; state: string | null; city: string | null; address: string | null; postalCode: string | null; status: string; leadSource: string | null; tags: string[]; internalNotes: string | null; customFields: Prisma.JsonValue; archivedAt?: Date | null; ownerUserId: string; createdAt: Date; updatedAt: Date; owner: { user: { name: string } }; _count?: { contacts: number; deals: number }; contacts?: Array<{ id: string; name: string; email: string; phone: string | null; title: string | null; companyId: string | null; owner: { user: { name: string } } }>; deals?: Array<{ id: string; name: string; value: Prisma.Decimal; closeDate: Date | null; status: string; owner: { user: { name: string } }; pipeline: { name: string }; stage: { name: string } }> }) {
    return {
      id: company.id,
      name: company.name,
      industry: company.industry,
      website: company.website,
      phone: company.phone,
      email: company.email,
      logoUrl: company.logoUrl,
      companyType: company.companyType,
      description: company.description,
      employeeCount: company.employeeCount,
      annualRevenue: company.annualRevenue?.toString() ?? null,
      registrationNumber: company.registrationNumber,
      parentCompanyId: company.parentCompanyId,
      parentCompany: company.parentCompany ?? null,
      country: company.country,
      state: company.state,
      city: company.city,
      address: company.address,
      postalCode: company.postalCode,
      status: String(company.status ?? "PROSPECT").toLowerCase(),
      leadSource: company.leadSource?.toLowerCase() ?? null,
      tags: company.tags ?? [],
      internalNotes: company.internalNotes,
      customFields: company.customFields ?? {},
      owner: company.owner.user.name,
      ownerUserId: company.ownerUserId,
      archivedAt: company.archivedAt?.toISOString() ?? null,
      contactsCount: company._count?.contacts ?? company.contacts?.length ?? 0,
      dealsCount: company._count?.deals ?? company.deals?.length ?? 0,
      contacts: company.contacts?.map((contact) => ({ id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, title: contact.title, companyId: contact.companyId, owner: contact.owner.user.name })),
      deals: company.deals?.map((deal) => ({ id: deal.id, name: deal.name, value: deal.value.toString(), closeDate: deal.closeDate?.toISOString() ?? null, status: deal.status.toLowerCase(), owner: deal.owner.user.name, pipeline: deal.pipeline, stage: deal.stage })),
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
