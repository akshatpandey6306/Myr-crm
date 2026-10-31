import { createHash, randomBytes, scryptSync } from "node:crypto";
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
import { AuthEmailService } from "../auth/email.service.js";
import { Public, SkipOrganizationContext } from "../auth/public.decorator.js";

const administrators = new Set(["owner", "admin"]);
const assignmentManagers = new Set(["owner", "admin", "sales_manager"]);
const assignableRoles: Record<string, "ADMIN" | "SALES_MANAGER" | "SALES_REP" | "READ_ONLY"> = {
  admin: "ADMIN",
  sales_manager: "SALES_MANAGER",
  sales_rep: "SALES_REP",
  read_only: "READ_ONLY",
};
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

@Controller("organizations")
export class MembersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthEmailService) private readonly email: AuthEmailService,
  ) {}

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

  @Post("invitations")
  async createInvitation(@Req() request: HttpRequest, @Body() body: { email?: unknown; role?: unknown }) {
    const { organizationId, userId } = this.requireAdministrator(request);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = typeof body?.role === "string" ? assignableRoles[body.role] : undefined;
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !role) {
      throw new BadRequestException({ code: "validation_error", message: "Enter a valid email and choose an assignable organization role" });
    }
    const existingMembership = await this.prisma.membership.findFirst({
      where: { organizationId, status: "ACTIVE", user: { email } },
      select: { id: true },
    });
    if (existingMembership) throw new ConflictException({ code: "conflict", message: "This person is already an active organization member" });

    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const invitation = await this.prisma.$transaction(async (transaction) => {
      await transaction.organizationInvitation.updateMany({
        where: { organizationId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      return transaction.organizationInvitation.create({
        data: {
          organizationId,
          email,
          role,
          tokenHash: this.hashToken(token),
          invitedByUserId: userId,
          expiresAt,
        },
        select: { id: true, email: true, role: true, expiresAt: true },
      });
    });
    const link = new URL("/accept-invitation", (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, ""));
    link.searchParams.set("token", token);
    await this.email.send(email, "You are invited to Myr CRM", `Accept your workspace invitation using this one-time link:\n\n${link.toString()}\n\nThis link expires in 7 days.`);
    return {
      data: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role.toLowerCase(),
        expiresAt: invitation.expiresAt.toISOString(),
      },
    };
  }

  @Get("invitations")
  async listInvitations(@Req() request: HttpRequest) {
    const { organizationId } = this.requireAdministrator(request);
    const invitations = await this.prisma.organizationInvitation.findMany({
      where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return {
      data: invitations.map((invitation) => ({
        ...invitation,
        role: invitation.role.toLowerCase(),
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      })),
    };
  }

  @Delete("invitations/:id")
  async revokeInvitation(@Req() request: HttpRequest, @Param("id") id: string) {
    const { organizationId } = this.requireAdministrator(request);
    const result = await this.prisma.organizationInvitation.updateMany({
      where: { id, organizationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException({ code: "not_found", message: "Invitation not found" });
    return { data: { id, status: "revoked" } };
  }

  @Public()
  @SkipOrganizationContext()
  @Post("invitations/accept")
  async acceptInvitation(@Body() body: { token?: unknown; name?: unknown; password?: unknown }) {
    const token = typeof body?.token === "string" ? body.token : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!token || token.length > 128) throw new BadRequestException({ code: "invalid_invitation", message: "This invitation is invalid or expired" });
    const now = new Date();
    const invitation = await this.prisma.organizationInvitation.findFirst({
      where: { tokenHash: this.hashToken(token), acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, organizationId: true, email: true, role: true },
    });
    if (!invitation) throw new BadRequestException({ code: "invalid_invitation", message: "This invitation is invalid or expired" });

    const existingUser = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, status: true },
    });
    if (existingUser?.status === "DISABLED") {
      throw new ForbiddenException({ code: "account_disabled", message: "This account cannot accept organization invitations" });
    }
    if (!existingUser && (!name || name.length > 120 || password.length < 8 || password.length > 128)) {
      throw new BadRequestException({ code: "validation_error", message: "For a new account, provide your name and a password of 8 to 128 characters" });
    }

    const acceptedUser = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.organizationInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException({ code: "invalid_invitation", message: "This invitation is invalid or expired" });

      const user = existingUser
        ? await transaction.user.update({
          where: { id: existingUser.id },
          data: { emailVerifiedAt: now },
          select: { id: true, email: true, name: true },
        })
        : await transaction.user.create({
          data: {
            email: invitation.email,
            name,
            passwordHash: this.hashPassword(password),
            emailVerifiedAt: now,
          },
          select: { id: true, email: true, name: true },
        });

      const currentMembership = await transaction.membership.findUnique({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
        select: { status: true },
      });
      if (currentMembership?.status === "ACTIVE") {
        throw new ConflictException({ code: "conflict", message: "This account is already an active organization member" });
      }
      await transaction.membership.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
        update: { status: "ACTIVE", role: invitation.role },
        create: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: invitation.organizationId,
          actorUserId: user.id,
          action: "UPDATE",
          resourceType: "invitation",
          resourceId: invitation.id,
        },
      });
      return user;
    });
    return {
      message: "Invitation accepted. Sign in to open your workspace.",
      user: { id: acceptedUser.id, email: acceptedUser.email, name: acceptedUser.name },
    };
  }

  private requireAdministrator(request: HttpRequest, allowedRoles = administrators) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    if (!request.orgId) throw new BadRequestException({ code: "org_required", message: "Organization context required" });
    if (!request.organizationRole || !allowedRoles.has(request.organizationRole)) {
      throw new ForbiddenException({
        code: "forbidden",
        message: allowedRoles === administrators
          ? "Only the Organization Owner or Admin can manage members and invitations"
          : "Only organization managers can view assignable team members",
      });
    }
    return { organizationId: request.orgId, userId: request.userId };
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
  }

  private prismaCode(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  }
}
