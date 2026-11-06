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

const administrators = new Set(["owner", "admin"]);
const assignmentManagers = new Set(["owner", "admin", "sales_manager"]);
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
    const { organizationId } = this.requireAdministrator(request);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { name: true, email: true, emailVerifiedAt: true } },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    return {
      data: memberships.map(({ userId, role, createdAt, user }) => ({
        userId,
        name: user.name,
        email: user.email,
        role: role.toLowerCase(),
        emailVerified: Boolean(user.emailVerifiedAt),
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

    await this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.membership.findUnique({
        where: { organizationId_userId: { organizationId: organization.id, userId: requesterId } },
        select: { status: true },
      });
      if (membership?.status === "ACTIVE") {
        throw new ConflictException({ code: "conflict", message: "You are already a member of this workspace" });
      }
      if (membership?.status === "PENDING") {
        throw new ConflictException({ code: "conflict", message: "Your request to join this workspace is already awaiting review" });
      }
      await transaction.membership.upsert({
        where: { organizationId_userId: { organizationId: organization.id, userId: requesterId } },
        update: { status: "PENDING", role: "SALES_REP" },
        create: { organizationId: organization.id, userId: requesterId, role: "SALES_REP", status: "PENDING" },
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
    });
    return { data: { organization: { id: organization.id, name: organization.name }, status: "pending" } };
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
    const updated = await this.prisma.membership.updateMany({
      where: { organizationId, userId: targetUserId, status: "PENDING", user: { status: "ACTIVE" } },
      data: decision === "approve"
        ? { status: "ACTIVE", role: approvedRole }
        : { status: "REMOVED" },
    });
    if (!updated.count) throw new NotFoundException({ code: "not_found", message: "Pending membership request not found" });

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

  private prismaCode(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  }
}
