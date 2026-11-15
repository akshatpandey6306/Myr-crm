import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assignedOwnerFilter, requireRecordArchive, requireRecordWrite } from "../auth/record-permissions.js";

const statuses = ["ACTIVE", "PENDING", "ON_HOLD"] as const;
const sortFields = ["createdAt", "name", "category", "status", "rating"] as const;
const sortOrders = ["asc", "desc"] as const;
type VendorStatusValue = (typeof statuses)[number];
type VendorFields = {
  name: string;
  category: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  status: VendorStatusValue;
  rating: number;
  reviewCount: number;
};

@Controller("vendors")
export class VendorsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("summary")
  async summary(@Req() request: HttpRequest) {
    const organizationId = this.organizationId(request);
    const where = { organizationId, archivedAt: null, ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) };
    const [total, active, pending, onHold] = await Promise.all([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.count({ where: { ...where, status: "ACTIVE" } }),
      this.prisma.vendor.count({ where: { ...where, status: "PENDING" } }),
      this.prisma.vendor.count({ where: { ...where, status: "ON_HOLD" } }),
    ]);
    return { data: { total, active, pending, onHold } };
  }

  @Get("categories")
  async categories(@Req() request: HttpRequest) {
    const organizationId = this.organizationId(request);
    const values = await this.prisma.vendor.findMany({
      where: {
        organizationId,
        archivedAt: null,
        category: { not: "" },
        ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}),
      },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    return { data: values.map(({ category }) => category) };
  }

  @Get()
  async list(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("status") statusValue?: string,
    @Query("category") categoryValue?: string,
    @Query("createdAfter") createdAfterValue?: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
    @Query("sortBy") sortByValue?: string,
    @Query("sortOrder") sortOrderValue?: string,
  ) {
    const organizationId = this.organizationId(request);
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const status = statusValue && statusValue !== "ALL" ? statusValue : undefined;
    if (status && !statuses.includes(status as VendorStatusValue)) throw this.invalid("Invalid vendor status");
    if (categoryValue && categoryValue.length > 120) throw this.invalid("category must be at most 120 characters");
    let createdAfter: Date | undefined;
    if (createdAfterValue) {
      createdAfter = new Date(createdAfterValue);
      if (!Number.isFinite(createdAfter.getTime())) throw this.invalid("createdAfter must be a valid date");
    }
    const sortBy = sortByValue ?? "createdAt";
    const sortOrder = sortOrderValue ?? "desc";
    if (!sortFields.includes(sortBy as (typeof sortFields)[number])) throw this.invalid("Invalid sortBy value");
    if (!sortOrders.includes(sortOrder as (typeof sortOrders)[number])) throw this.invalid("Invalid sortOrder value");
    const search = query?.trim();
    const ownerUserId = assignedOwnerFilter(request);
    const where = {
      organizationId,
      archivedAt: null,
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(status ? { status: status as VendorStatusValue } : {}),
      ...(categoryValue ? { category: categoryValue } : {}),
      ...(createdAfter ? { createdAt: { gte: createdAfter } } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { category: { contains: search, mode: "insensitive" as const } },
        { contactPerson: { contains: search, mode: "insensitive" as const } },
        { email: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const orderBy = sortBy === "name" ? { name: sortOrder as "asc" | "desc" }
      : sortBy === "category" ? { category: sortOrder as "asc" | "desc" }
        : sortBy === "status" ? { status: sortOrder as "asc" | "desc" }
          : sortBy === "rating" ? { rating: sortOrder as "asc" | "desc" }
            : { createdAt: sortOrder as "asc" | "desc" };
    const [total, vendors] = await Promise.all([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return {
      data: vendors.map((vendor) => this.present(vendor)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const vendor = await this.prisma.vendor.create({
      data: { ...this.fields(body, true), organizationId, ownerUserId: userId, createdByUserId: userId },
    });
    return { data: this.present(vendor) };
  }

  @Get(":id")
  async get(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, organizationId, archivedAt: null, ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) },
    });
    if (!vendor) throw new NotFoundException({ code: "not_found", message: "Vendor not found" });
    return { data: this.present(vendor) };
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const patch = this.fields(body, false);
    if (Object.keys(patch).length === 0) throw this.invalid("Provide at least one editable vendor field");
    const where = { id, organizationId, archivedAt: null, ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) };
    const result = await this.prisma.vendor.updateMany({ where, data: patch });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Vendor not found" });
    const vendor = await this.prisma.vendor.findFirst({ where });
    if (!vendor) throw new NotFoundException({ code: "not_found", message: "Vendor not found" });
    return { data: this.present(vendor) };
  }

  @Delete(":id")
  async archive(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordArchive(request);
    const organizationId = this.organizationId(request);
    const result = await this.prisma.vendor.updateMany({
      where: { id, organizationId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Vendor not found" });
    return { ok: true };
  }

  private fields(body: Record<string, unknown>, required: true): VendorFields;
  private fields(body: Record<string, unknown>, required: false): Partial<VendorFields>;
  private fields(body: Record<string, unknown>, required: boolean): Partial<VendorFields> {
    const patch: Partial<VendorFields> = {};
    for (const field of ["name", "category", "contactPerson", "email", "phone"] as const) {
      if (!required && !(field in (body ?? {}))) continue;
      if (required && field !== "name" && field !== "category" && !(field in (body ?? {}))) {
        patch[field] = null;
        continue;
      }
      const max = field === "name" ? 160 : field === "category" ? 120 : field === "contactPerson" ? 120 : field === "email" ? 254 : 40;
      const value = body?.[field];
      if (field !== "name" && field !== "category" && (value === null || value === "")) {
        patch[field] = null;
        continue;
      }
      if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
        throw this.invalid(`${field} must be a non-empty string of at most ${max} characters`);
      }
      const cleaned = value.trim();
      if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) throw this.invalid("email must be a valid email address");
      patch[field] = cleaned;
    }
    if (required || "status" in (body ?? {})) {
      const value = body?.status ?? (required ? "PENDING" : undefined);
      if (value !== undefined) {
        if (typeof value !== "string" || !statuses.includes(value as VendorStatusValue)) throw this.invalid("status must be ACTIVE, PENDING, or ON_HOLD");
        patch.status = value as VendorStatusValue;
      }
    }
    if (required || "rating" in (body ?? {})) {
      const value = body?.rating ?? (required ? 0 : undefined);
      if (value !== undefined) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) throw this.invalid("rating must be a number between 0 and 5");
        patch.rating = value;
      }
    }
    if (required || "reviewCount" in (body ?? {})) {
      const value = body?.reviewCount ?? (required ? 0 : undefined);
      if (value !== undefined) {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
          throw this.invalid("reviewCount must be a non-negative integer no greater than 1000000");
        }
        patch.reviewCount = value;
      }
    }
    return patch;
  }

  private present(vendor: {
    id: string; name: string; category: string; contactPerson: string | null; email: string | null; phone: string | null;
    status: VendorStatusValue; rating: number; reviewCount: number; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: vendor.id,
      name: vendor.name,
      category: vendor.category,
      contactPerson: vendor.contactPerson,
      email: vendor.email,
      phone: vendor.phone,
      status: vendor.status,
      rating: vendor.rating,
      reviewCount: vendor.reviewCount,
      createdAt: vendor.createdAt.toISOString(),
      updatedAt: vendor.updatedAt.toISOString(),
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
