import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assignedOwnerFilter, requireRecordArchive, requireRecordWrite } from "../auth/record-permissions.js";

const sortFields = ["createdAt", "name", "email", "company"] as const;
const sortOrders = ["asc", "desc"] as const;

@Controller("contacts")
export class ContactsController {
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
      : sortBy === "email" ? { email: sortOrder as "asc" | "desc" }
        : sortBy === "company" ? { company: sortOrder as "asc" | "desc" }
          : { createdAt: sortOrder as "asc" | "desc" };
    const search = query?.trim();
    const where = {
      organizationId,
      archivedAt: null,
      ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { email: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search, mode: "insensitive" as const } },
        { title: { contains: search, mode: "insensitive" as const } },
        { company: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const [total, contacts] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { owner: { include: { user: { select: { name: true } } } } },
      }),
    ]);
    return {
      data: contacts.map((contact) => this.present(contact)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const data = this.fields(body, true);
    try {
      const contact = await this.prisma.contact.create({
        data: { ...data, organizationId, ownerUserId: userId, createdByUserId: userId },
        include: { owner: { include: { user: { select: { name: true } } } } },
      });
      return { data: this.present(contact) };
    } catch (error) {
      if (this.prismaCode(error) === "P2002") throw this.duplicate();
      throw error;
    }
  }

  @Get(":id")
  async get(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId, archivedAt: null, ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) },
      include: { owner: { include: { user: { select: { name: true } } } } },
    });
    if (!contact) throw new NotFoundException({ code: "not_found", message: "Contact not found" });
    return { data: this.present(contact) };
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const organizationId = this.organizationId(request);
    const patch = this.fields(body, false);
    if (Object.keys(patch).length === 0) throw new BadRequestException({ code: "validation_error", message: "Provide at least one editable contact field" });
    const ownerUserId = assignedOwnerFilter(request);
    const existing = await this.prisma.contact.findFirst({ where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) }, select: { id: true } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Contact not found" });
    try {
      await this.prisma.contact.updateMany({ where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) }, data: patch });
    } catch (error) {
      if (this.prismaCode(error) === "P2002") throw this.duplicate();
      throw error;
    }
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) },
      include: { owner: { include: { user: { select: { name: true } } } } },
    });
    if (!contact) throw new NotFoundException({ code: "not_found", message: "Contact not found" });
    return { data: this.present(contact) };
  }

  @Delete(":id")
  async archive(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordArchive(request);
    const organizationId = this.organizationId(request);
    const result = await this.prisma.contact.updateMany({
      where: { id, organizationId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Contact not found" });
    return { ok: true };
  }

  private fields(body: Record<string, unknown>, required: true): { name: string; email: string; phone: string | null; title: string | null; company: string | null };
  private fields(body: Record<string, unknown>, required: false): Partial<{ name: string; email: string; phone: string | null; title: string | null; company: string | null }>;
  private fields(body: Record<string, unknown>, required: boolean) {
    const patch: Partial<{ name: string; email: string; phone: string | null; title: string | null; company: string | null }> = {};
    const fields = ["name", "email", "phone", "title", "company"] as const;
    for (const field of fields) {
      if (!required && !(field in (body ?? {}))) continue;
      if (required && field !== "name" && field !== "email" && !(field in (body ?? {}))) {
        patch[field] = null;
        continue;
      }
      const value = body?.[field];
      if ((field === "phone" || field === "title" || field === "company") && (value === null || value === "")) {
        patch[field] = null;
        continue;
      }
      const max = field === "name" ? 120 : field === "email" ? 254 : field === "phone" ? 40 : field === "title" ? 120 : 160;
      if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
        throw this.invalid(`${field} is required and must be at most ${max} characters`);
      }
      const cleaned = value.trim();
      if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) throw this.invalid("Enter a valid email address");
      if (field === "email") patch.email = cleaned.toLowerCase();
      else patch[field] = cleaned;
    }
    return patch;
  }

  private present(contact: { id: string; name: string; email: string; phone: string | null; title: string | null; company: string | null; createdAt: Date; updatedAt: Date; owner: { user: { name: string } } }) {
    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
      company: contact.company,
      owner: contact.owner.user.name,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
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

  private prismaCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  }

  private duplicate() {
    return new ConflictException({ code: "duplicate_contact", message: "A contact with this email already exists in this workspace" });
  }

  private invalid(message: string) {
    return new BadRequestException({ code: "validation_error", message });
  }
}
