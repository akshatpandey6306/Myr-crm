import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Patch,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";
import { hashPassword } from "../auth/password.js";
import { Prisma } from "../../generated/prisma/client.js";

type EmployeeImportRow = {
  row: number;
  email: string;
  name: string;
  password?: string;
  errors: string[];
};
type EmployeeImportDatabase = Pick<Prisma.TransactionClient, "organization" | "subscriptionPlan" | "membership" | "user">;

const administrators = new Set(["owner", "admin"]);
const assignmentManagers = new Set(["owner", "admin", "sales_manager"]);
const employeeModules: string[] = [];
const configurableModules = new Set([
  "leads", "contacts", "companies", "deals", "activities", "vendors", "billing-invoicing", "automation", "email", "reports", "audit-logs", "settings",
]);
const assignableRoles: Record<string, "ADMIN" | "SALES_MANAGER" | "SALES_REP" | "READ_ONLY"> = {
  admin: "ADMIN",
  sales_manager: "SALES_MANAGER",
  sales_rep: "SALES_REP",
  read_only: "READ_ONLY",
};
@Controller("organizations")
export class MembersController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("members")
  async listMembers(@Req() request: HttpRequest) {
    const { organizationId, userId } = this.requireAdministrator(request);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE", userId: { not: userId }, user: { status: "ACTIVE" } },
      select: {
        userId: true,
        role: true,
        enabledModules: true,
        createdAt: true,
        user: { select: { name: true, email: true, emailVerifiedAt: true } },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    return {
      data: memberships.map(({ userId, role, enabledModules, createdAt, user }) => ({
        userId,
        name: user.name,
        email: user.email,
        role: role.toLowerCase(),
        enabledModules,
        emailVerified: Boolean(user.emailVerifiedAt),
        joinedAt: createdAt.toISOString(),
      })),
    };
  }

  @Get("members/session-history")
  async listMemberSessionHistory(@Req() request: HttpRequest) {
    const { organizationId, userId } = this.requireAdministrator(request);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE", userId: { not: userId }, user: { status: "ACTIVE" } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    });
    const members = new Map(memberships.map(({ userId: memberId, user }) => [memberId, user]));
    if (members.size === 0) return { data: [] };
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: { userId: { in: [...members.keys()] } },
      select: { userId: true, createdAt: true, revokedAt: true, expiresAt: true, lastSeenAt: true, deviceLabel: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return { data: sessions.map((session) => {
      const member = members.get(session.userId)!;
      const endedAt = session.revokedAt ?? (session.expiresAt <= now ? session.expiresAt : null);
      return { name: member.name, email: member.email, loginAt: session.createdAt.toISOString(), logoutAt: endedAt?.toISOString() ?? null, lastSeenAt: session.lastSeenAt.toISOString(), status: session.revokedAt ? "signed_out" : endedAt ? "expired" : "active", device: session.deviceLabel ?? "Unknown device" };
    }) };
  }

  @Post("members")
  async createMember(
    @Req() request: HttpRequest,
    @Body() body: { name?: unknown; email?: unknown; password?: unknown; role?: unknown },
  ) {
    const { organizationId, userId } = this.requireAdministrator(request);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role = typeof body?.role === "string" ? assignableRoles[body.role] : "SALES_REP";
    if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128 || !role) {
      throw new BadRequestException({ code: "validation_error", message: "Enter a name, valid email, password (8–128 characters), and supported employee role" });
    }

    try {
      const member = await this.prisma.$transaction(async (transaction) => {
        const organization = await transaction.organization.findUnique({
          where: { id: organizationId },
          select: { subscriptionPlan: true },
        });
        if (!organization) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });
        const plan = organization.subscriptionPlan
          ? await transaction.subscriptionPlan.findUnique({ where: { code: organization.subscriptionPlan }, select: { employeeLimit: true } })
          : null;
        const activeCount = await transaction.membership.count({ where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } } });
        if (plan?.employeeLimit !== null && plan?.employeeLimit !== undefined && activeCount >= plan.employeeLimit) {
          throw new ConflictException({ code: "member_limit_reached", message: "This workspace plan's team-member limit has been reached." });
        }
        const existing = await transaction.user.findUnique({ where: { email }, select: { id: true } });
        if (existing) throw new ConflictException({ code: "email_in_use", message: "An account already uses this email address." });
        const created = await transaction.user.create({
          data: {
            email,
            name,
            passwordHash: hashPassword(password),
            emailVerifiedAt: new Date(),
            memberships: { create: { organizationId, role, status: "ACTIVE", enabledModules: [] } },
          },
          select: { id: true, email: true, name: true },
        });
        await transaction.auditLog.create({ data: { organizationId, actorUserId: userId, action: "CREATE", resourceType: "member", resourceId: created.id } });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { data: { ...member, role: role.toLowerCase(), enabledModules: [], emailVerified: true, joinedAt: new Date().toISOString() } };
    } catch (error) {
      if (this.prismaCode(error) === "P2002") throw new ConflictException({ code: "email_in_use", message: "An account already uses this email address." });
      if (this.prismaCode(error) === "P2034") throw new ConflictException({ code: "member_limit_reached", message: "Workspace membership changed while creating the employee. Refresh and try again." });
      throw error;
    }
  }

  @Post("members/import/validate")
  async validateMemberImport(@Req() request: HttpRequest, @Body() body: { rows?: unknown }) {
    const { organizationId } = this.requireAdministrator(request);
    if (!Array.isArray(body?.rows)) throw new BadRequestException({ code: "validation_error", message: "Employee rows are required" });
    const rows = this.parseEmployeeImportRows(body.rows, false);
    const validatedRows = await this.validateEmployeeImport(organizationId, rows, this.prisma);
    const responseRows = validatedRows.map(({ row, email, name, errors }) => ({ row, email, name, errors }));
    return {
      data: {
        rows: responseRows,
        validCount: responseRows.filter(({ errors }) => errors.length === 0).length,
        canImport: responseRows.length > 0 && responseRows.every(({ errors }) => errors.length === 0),
      },
    };
  }

  @Post("members/import")
  async importMembers(@Req() request: HttpRequest, @Body() body: { rows?: unknown }) {
    const { organizationId, userId } = this.requireAdministrator(request);
    if (!Array.isArray(body?.rows)) throw new BadRequestException({ code: "validation_error", message: "Employee rows are required" });
    const rows = this.parseEmployeeImportRows(body.rows, true);
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const validatedRows = await this.validateEmployeeImport(organizationId, rows, transaction);
        const invalidRows = validatedRows.filter(({ errors }) => errors.length > 0);
        if (invalidRows.length > 0) {
          throw new ConflictException({
            code: "employee_import_conflict",
            message: "Employee import validation changed. Review the rows and retry.",
            rows: invalidRows.map(({ row, email, errors }) => ({ row, email, errors })),
          });
        }

        const createdRows = [];
        for (const row of validatedRows) {
          if (!row.password) throw new BadRequestException({ code: "validation_error", message: "Every employee row requires a password" });
          const user = await transaction.user.create({
            data: {
              email: row.email,
              name: row.name,
              passwordHash: hashPassword(row.password),
              emailVerifiedAt: new Date(),
              memberships: {
                create: {
                  organizationId,
                  role: "SALES_REP",
                  status: "ACTIVE",
                  enabledModules: employeeModules,
                },
              },
            },
            select: { id: true },
          });
          createdRows.push({ row: row.row, userId: user.id });
        }
        return createdRows;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { data: { createdCount: created.length, rows: created.map(({ row, userId: createdUserId }) => ({ row, userId: createdUserId })) } };
    } catch (error) {
      if (this.prismaCode(error) === "P2002") {
        throw new ConflictException({
          code: "employee_import_conflict",
          message: "An account email was registered while this import was being processed. No employees were imported; validate the file again.",
        });
      }
      if (this.prismaCode(error) === "P2034") {
        throw new ConflictException({
          code: "member_limit_reached",
          message: "Workspace membership changed while importing employees. No employees were imported; validate the file again.",
        });
      }
      throw error;
    }
  }

  @Get("members/export")
  async exportMembers(@Req() request: HttpRequest) {
    const { organizationId, userId } = this.requireAdministrator(request);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE", userId: { not: userId }, user: { status: "ACTIVE" } },
      select: { role: true, createdAt: true, user: { select: { name: true, email: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    await this.prisma.auditLog.create({
      data: { organizationId, actorUserId: request.userId!, action: "CREATE", resourceType: "member_export" },
    });
    return {
      data: memberships.map(({ role, createdAt, user }) => ({
        email: user.email,
        name: user.name,
        role: role.toLowerCase(),
        joinedAt: createdAt.toISOString(),
      })),
    };
  }

  @Get("assignees")
  async listAssignees(@Req() request: HttpRequest) {
    const { organizationId } = this.requireAdministrator(request, assignmentManagers);
    const members = await this.prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { userId: true, user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return { data: members.map(({ userId, user }) => ({ id: userId, name: user.name })) };
  }

  @Patch("members/:userId")
  async updateMemberRole(
    @Req() request: HttpRequest,
    @Param("userId") targetUserId: string,
    @Body() body: { role?: unknown },
  ) {
    const { organizationId } = this.requireAdministrator(request);
    const role = typeof body?.role === "string" ? assignableRoles[body.role] : undefined;
    if (!role) {
      throw new BadRequestException({ code: "validation_error", message: "Choose admin, sales_manager, sales_rep, or read_only" });
    }
    const updated = await this.prisma.membership.updateMany({
      where: { organizationId, userId: targetUserId, status: "ACTIVE", role: { not: "OWNER" } },
      data: { role },
    });
    if (!updated.count) {
      const target = await this.prisma.membership.findFirst({
        where: { organizationId, userId: targetUserId, status: "ACTIVE" },
        select: { role: true },
      });
      if (!target) throw new NotFoundException({ code: "not_found", message: "Organization member not found" });
      throw new ForbiddenException({ code: "owner_transfer_required", message: "Transfer ownership before changing the Owner role" });
    }
    return { data: { userId: targetUserId, role: role.toLowerCase() } };
  }

  @Patch("members/:userId/modules")
  async updateMemberModules(
    @Req() request: HttpRequest,
    @Param("userId") targetUserId: string,
    @Body() body: { enabledModules?: unknown },
  ) {
    const { organizationId, userId } = this.requireAdministrator(request);
    if (!Array.isArray(body?.enabledModules) ||
      body.enabledModules.some((module) => typeof module !== "string" || !configurableModules.has(module))) {
      throw new BadRequestException({
        code: "validation_error",
        message: "Choose only supported CRM modules; Team & access is always administrator-only",
      });
    }
    const target = await this.prisma.membership.findFirst({
      where: { organizationId, userId: targetUserId, status: "ACTIVE", role: { notIn: ["OWNER", "ADMIN"] } },
      select: { enabledModules: true },
    });
    if (!target) {
      throw new NotFoundException({ code: "not_found", message: "Active employee not found" });
    }
    const requestedModules = [...new Set(body.enabledModules as string[])];
    const workspaceModules = new Set(request.workspaceEnabledModules ?? []);
    const unavailable = requestedModules.filter((module) => !workspaceModules.has(module));
    if (unavailable.length) {
      throw new BadRequestException({
        code: "module_not_enabled",
        message: "Employees can only be assigned modules enabled for this workspace",
        details: { modules: unavailable },
      });
    }
    await this.prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      data: { enabledModules: requestedModules },
    });
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        action: "UPDATE",
        resourceType: "membership_modules",
        resourceId: targetUserId,
      },
    });
    return { data: { userId: targetUserId, enabledModules: requestedModules } };
  }

  @Patch("members/:userId/transfer-ownership")
  async transferOwnership(@Req() request: HttpRequest, @Param("userId") targetUserId: string) {
    const { organizationId, userId } = this.requireAdministrator(request);
    if (request.organizationRole !== "owner") {
      throw new ForbiddenException({ code: "forbidden", message: "Only the current Owner can transfer ownership" });
    }
    if (targetUserId === userId) throw new BadRequestException({ code: "validation_error", message: "Choose another active member" });
    try {
      await this.prisma.$transaction(async (transaction) => {
        const [currentOwner, target] = await Promise.all([
          transaction.membership.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
            select: { role: true, status: true },
          }),
          transaction.membership.findUnique({
            where: { organizationId_userId: { organizationId, userId: targetUserId } },
            select: { role: true, status: true },
          }),
        ]);
        if (currentOwner?.status !== "ACTIVE" || currentOwner.role !== "OWNER") {
          throw new ForbiddenException({ code: "forbidden", message: "Only the current Owner can transfer ownership" });
        }
        if (target?.status !== "ACTIVE") throw new NotFoundException({ code: "not_found", message: "Organization member not found" });
        await transaction.membership.update({
          where: { organizationId_userId: { organizationId, userId } },
          data: { role: "ADMIN" },
        });
        await transaction.membership.update({
          where: { organizationId_userId: { organizationId, userId: targetUserId } },
          data: { role: "OWNER" },
        });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2034") {
        throw new ConflictException({ code: "conflict", message: "Organization ownership changed concurrently. Refresh and try again." });
      }
      throw error;
    }
    return { data: { userId: targetUserId, role: "owner" } };
  }

  @Delete("members/:userId")
  async removeMember(@Req() request: HttpRequest, @Param("userId") targetUserId: string) {
    const { organizationId, userId } = this.requireAdministrator(request);
    if (targetUserId === userId && request.organizationRole === "owner") {
      throw new ForbiddenException({ code: "owner_transfer_required", message: "Transfer ownership before leaving this organization" });
    }
    const result = await this.prisma.membership.updateMany({
      where: { organizationId, userId: targetUserId, status: "ACTIVE", role: { not: "OWNER" } },
      data: { status: "REMOVED" },
    });
    if (!result.count) {
      const target = await this.prisma.membership.findFirst({
        where: { organizationId, userId: targetUserId, status: "ACTIVE" },
        select: { role: true },
      });
      if (!target) throw new NotFoundException({ code: "not_found", message: "Organization member not found" });
      throw new ForbiddenException({ code: "owner_transfer_required", message: "Transfer ownership before removing the Owner" });
    }
    return { data: { userId: targetUserId, status: "removed" } };
  }

  @SkipOrganizationContext()
  @Get("join-requests")
  async listMyJoinRequests(@Req() request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const memberships = await this.prisma.membership.findMany({
      where: { userId: request.userId, status: { in: ["ACTIVE", "PENDING"] } },
      select: {
        status: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      data: memberships.map((membership) => ({
        organization: membership.organization,
        status: membership.status.toLowerCase(),
        requestedAt: membership.createdAt.toISOString(),
      })),
    };
  }

  @SkipOrganizationContext()
  @Post("join-requests")
  async requestToJoin(@Req() request: HttpRequest, @Body() body: { joinCode?: unknown }) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const requesterId = request.userId;
    const joinCode = typeof body?.joinCode === "string" ? body.joinCode.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(joinCode)) {
      throw new BadRequestException({ code: "validation_error", message: "Enter a valid workspace join code" });
    }
    const organization = await this.prisma.organization.findFirst({
      where: { joinCode, status: "ACTIVE" },
      select: { id: true, name: true },
    });
    if (!organization) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });

    const existingMembership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: organization.id, userId: requesterId } },
      select: { status: true },
    });
    if (existingMembership?.status === "ACTIVE") {
      return { data: { organization, status: "active" } };
    }

    const requestStatus = await this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.membership.findUnique({
        where: { organizationId_userId: { organizationId: organization.id, userId: requesterId } },
        select: { status: true },
      });
      if (membership?.status === "ACTIVE") return "active" as const;
      if (membership?.status === "PENDING") {
        throw new ConflictException({ code: "conflict", message: "Your request to join this workspace is already awaiting review" });
      }
      await transaction.membership.upsert({
        where: { organizationId_userId: { organizationId: organization.id, userId: requesterId } },
        update: { status: "PENDING", role: "SALES_REP", enabledModules: [] },
        create: { organizationId: organization.id, userId: requesterId, role: "SALES_REP", status: "PENDING", enabledModules: [] },
      });
      const administrators = await transaction.membership.findMany({
        where: { organizationId: organization.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
        select: { userId: true },
      });
      const user = await transaction.user.findUnique({
        where: { id: requesterId },
        select: { name: true, email: true },
      });
      if (!user) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user not found" });
      if (administrators.length) {
        await transaction.notification.createMany({
          data: administrators.map(({ userId }) => ({
            organizationId: organization.id,
            recipientUserId: userId,
            resourceId: requesterId,
            type: "MEMBER_JOIN_REQUEST",
            title: "New team member request",
            body: `${user.name} (${user.email}) requested to join the workspace.`,
          })),
        });
      }
      return "pending" as const;
    });
    return { data: { organization: { id: organization.id, name: organization.name }, status: requestStatus } };
  }

  @Get("join-code")
  async getJoinCode(@Req() request: HttpRequest) {
    const { organizationId } = this.requireAdministrator(request);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { joinCode: true },
    });
    if (!organization) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });
    return { data: { joinCode: organization.joinCode } };
  }

  @Get("membership-requests")
  async listMembershipRequests(@Req() request: HttpRequest) {
    const { organizationId } = this.requireAdministrator(request);
    const requests = await this.prisma.membership.findMany({
      where: { organizationId, status: "PENDING", user: { status: "ACTIVE" } },
      select: {
        userId: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      data: requests.map((membership) => ({
        userId: membership.userId,
        name: membership.user.name,
        email: membership.user.email,
        requestedAt: membership.createdAt.toISOString(),
      })),
    };
  }

  @Patch("membership-requests/:userId")
  async reviewMembershipRequest(
    @Req() request: HttpRequest,
    @Param("userId") targetUserId: string,
    @Body() body: { decision?: unknown; role?: unknown },
  ) {
    const { organizationId, userId } = this.requireAdministrator(request);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
      throw new BadRequestException({ code: "validation_error", message: "A valid user ID is required" });
    }
    if (body?.decision !== "approve" && body?.decision !== "decline") {
      throw new BadRequestException({ code: "validation_error", message: "Choose approve or decline" });
    }
    const approvedRole = typeof body.role === "string" ? assignableRoles[body.role] : "SALES_REP";
    if (body.decision === "approve" && !approvedRole) {
      throw new BadRequestException({ code: "validation_error", message: "Choose an assignable organization role" });
    }
    const decision = body.decision;
    try {
      await this.prisma.$transaction(async (transaction) => {
        if (decision === "approve") {
          const organization = await transaction.organization.findUnique({
            where: { id: organizationId },
            select: { subscriptionStatus: true, subscriptionEndsAt: true, subscriptionPlan: true },
          });
          if (!organization) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });
          const plan = organization.subscriptionPlan
            ? await transaction.subscriptionPlan.findUnique({
                where: { code: organization.subscriptionPlan },
                select: { employeeLimit: true },
              })
            : null;
          const memberLimit = plan?.employeeLimit ?? null;
          if (memberLimit !== null) {
            const activeCount = await transaction.membership.count({
              where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
            });
            if (activeCount >= memberLimit) {
              throw new ConflictException({
                code: "member_limit_reached",
                message: "This workspace plan's team-member limit has been reached.",
              });
            }
          }
        }
        const updated = await transaction.membership.updateMany({
          where: { organizationId, userId: targetUserId, status: "PENDING", user: { status: "ACTIVE" } },
          data: decision === "approve"
            ? { status: "ACTIVE", role: approvedRole, enabledModules: [] }
            : { status: "REMOVED" },
        });
        if (!updated.count) throw new NotFoundException({ code: "not_found", message: "Pending membership request not found" });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2034") {
        throw new ConflictException({ code: "member_limit_reached", message: "Workspace membership changed while approving this request. Refresh and try again." });
      }
      throw error;
    }

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        action: "UPDATE",
        resourceType: "membership_request",
        resourceId: targetUserId,
      },
    });
    await this.prisma.notification.updateMany({
      where: {
        organizationId,
        recipientUserId: userId,
        resourceId: targetUserId,
        type: "MEMBER_JOIN_REQUEST",
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { data: { userId: targetUserId, decision, role: approvedRole?.toLowerCase() } };
  }

  private requireAdministrator(request: HttpRequest, allowedRoles = administrators) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    if (!request.orgId) throw new BadRequestException({ code: "org_required", message: "Organization context required" });
    if (!request.organizationRole || !allowedRoles.has(request.organizationRole)) {
      throw new ForbiddenException({
        code: "forbidden",
        message: allowedRoles === administrators
          ? "Only the Organization Owner or Admin can manage members and requests"
          : "Only organization managers can view assignable team members",
      });
    }
    return { organizationId: request.orgId, userId: request.userId };
  }

  private parseEmployeeImportRows(value: unknown[], requirePassword: boolean): EmployeeImportRow[] {
    if (value.length < 1 || value.length > 500) {
      throw new BadRequestException({ code: "validation_error", message: "Import between 1 and 500 employees at a time" });
    }
    return value.map((value, index) => {
      const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const password = typeof row.password === "string" ? row.password : undefined;
      const errors: string[] = [];
      if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) errors.push("Enter a valid work email.");
      if (!name || name.length > 120) errors.push("Name is required and must be at most 120 characters.");
      if (requirePassword && (!password || password.length < 8 || password.length > 128)) {
        errors.push("Password must contain 8 to 128 characters.");
      }
      return { row: index + 2, email, name, ...(password === undefined ? {} : { password }), errors };
    });
  }

  private async validateEmployeeImport(
    organizationId: string,
    rows: EmployeeImportRow[],
    db: EmployeeImportDatabase,
  ) {
    const seenEmails = new Set<string>();
    for (const row of rows) {
      if (row.email && seenEmails.has(row.email)) row.errors.push("Email is duplicated in this file.");
      if (row.email) seenEmails.add(row.email);
    }
    const emails = rows.filter(({ errors }) => errors.length === 0).map(({ email }) => email);
    const existingUsers = emails.length
      ? await db.user.findMany({ where: { email: { in: emails } }, select: { email: true } })
      : [];
    const existingEmails = new Set(existingUsers.map(({ email }) => email.toLowerCase()));
    for (const row of rows) {
      if (row.email && existingEmails.has(row.email)) row.errors.push("An account already uses this email.");
    }

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true, subscriptionEndsAt: true, subscriptionPlan: true },
    });
    if (!organization) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });
    const plan = organization.subscriptionPlan
      ? await db.subscriptionPlan.findUnique({
        where: { code: organization.subscriptionPlan },
        select: { employeeLimit: true },
      })
      : null;
    const memberLimit = plan?.employeeLimit ?? null;
    if (memberLimit !== null) {
      const activeCount = await db.membership.count({
        where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
      });
      let availableSeats = Math.max(0, memberLimit - activeCount);
      for (const row of rows) {
        if (row.errors.length > 0) continue;
        if (availableSeats > 0) availableSeats -= 1;
        else row.errors.push("Workspace seat limit would be exceeded.");
      }
    }
    return rows;
  }

  private prismaCode(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  }
}
