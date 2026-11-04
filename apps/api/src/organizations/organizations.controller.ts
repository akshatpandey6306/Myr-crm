import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Req, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { effectiveSubscriptionStatus } from "../billing/subscription-status.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";
import { AuditService } from "../audit/audit.service.js";

const ASSIGNABLE_ROLES = {
  admin: "ADMIN",
  sales_manager: "SALES_MANAGER",
  sales_rep: "SALES_REP",
  read_only: "READ_ONLY",
} as const;

@Controller("organizations")
export class OrganizationsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @SkipOrganizationContext()
  @Get()
  async list(@Req() request: HttpRequest) {
    const userId = this.userId(request);
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      data: memberships.map(({ organization, role }) => ({ id: organization.id, name: organization.name, role: role.toLowerCase() })),
    };
  }

  @Get("members")
  async listMembers(@Req() request: HttpRequest) {
    const organizationId = this.organizationId(request);
    const memberships = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      },
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: [{ user: { name: "asc" } }, { userId: "asc" }],
    });
    return {
      data: memberships.map(({ id, userId, role, user }) => ({
        id,
        name: user.name,
        email: user.email,
        role: role.toLowerCase(),
        isCurrentUser: Boolean(request.userId && userId === request.userId),
      })),
    };
  }

  @Get("modules")
  modules(@Req() request: HttpRequest) {
    if (!request.orgId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    return { data: { enabledModules: request.enabledModules ?? [] } };
  }

  @Get("invitations")
  async listInvitations(@Req() request: HttpRequest) {
    const organizationId = this.organizationId(request);
    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return {
      data: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role.toLowerCase(),
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      })),
    };
  }

  @Post("invitations")
  async createInvitation(@Req() request: HttpRequest, @Body() body: { email?: unknown; role?: unknown }) {
    const organizationId = this.organizationId(request);
    const requesterRole = request.organizationRole;
    if (!requesterRole || !["owner", "admin"].includes(requesterRole)) {
      throw new ForbiddenException({ code: "forbidden", message: "Only an owner or administrator can invite members" });
    }
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException({ code: "validation_error", message: "A valid email is required" });
    const roleInput = typeof body?.role === "string" ? body.role.toLowerCase() : "sales_rep";
    const role = Object.entries(ASSIGNABLE_ROLES).find(([key]) => key === roleInput)?.[1];
    if (!role) throw new BadRequestException({ code: "validation_error", message: "Choose a valid role" });

    await this.assertSeatAvailable(organizationId);

    const existingMember = await this.prisma.membership.findFirst({ where: { organizationId, user: { email }, status: "ACTIVE" }, select: { userId: true } });
    if (existingMember) throw new ConflictException({ code: "already_member", message: "This user is already a member of the workspace" });

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId,
        email,
        role,
        tokenHash,
        expiresAt,
        createdByUserId: this.userId(request),
      },
    });
    await this.audit.record({
      actorUserId: this.userId(request),
      action: "organization.invitation.create",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { organizationId, email, role: role.toLowerCase() },
    });

    return { data: { id: invitation.id, email, role: role.toLowerCase(), expiresAt: expiresAt.toISOString(), token } };
  }

  @SkipOrganizationContext()
  @Post()
  async create(@Req() request: HttpRequest, @Body() body: { name?: unknown }) {
    const userId = this.userId(request);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 160) {
      throw new BadRequestException({ code: "validation_error", message: "Organization name is required and must be at most 160 characters" });
    }
    const organization = await this.prisma.organization.create({
      data: {
        name,
        memberships: { create: { userId, role: "OWNER" } },
        pipelines: {
          create: {
            name: "Sales pipeline",
            isDefault: true,
            stages: { create: ["Discovery", "Qualified", "Proposal", "Negotiation"].map((stageName, position) => ({ name: stageName, position })) },
          },
        },
      },
      include: { memberships: { where: { userId, status: "ACTIVE" }, select: { role: true } } },
    });
    return { data: { id: organization.id, name: organization.name, role: organization.memberships[0]?.role.toLowerCase() ?? "owner" } };
  }

  private userId(request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    return request.userId;
  }

  private organizationId(request: HttpRequest) {
    if (!request.orgId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    return request.orgId;
  }

  @SkipOrganizationContext()
  @Post("invitations/:token/accept")
  async acceptInvitation(@Req() request: HttpRequest, @Param("token") token: string) {
    const userId = this.userId(request);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new UnauthorizedException({ code: "unauthorized", message: "Account not found" });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      include: { organization: { select: { enabledModules: true } } },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw new BadRequestException({ code: "invalid_invitation", message: "Invalid or expired invitation" });
    }
    if (!invitation.organization.enabledModules.includes("team")) {
      throw new ForbiddenException({ code: "module_disabled", message: "The Team module is not enabled for this workspace." });
    }
    if (invitation.email !== user.email) {
      throw new ForbiddenException({ code: "forbidden", message: "This invitation belongs to a different email address" });
    }

    const existingMembership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId } },
      select: { status: true },
    });
    if (existingMembership?.status === "ACTIVE") throw new ConflictException({ code: "already_member", message: "You are already a member of this workspace" });

    await this.prisma.$transaction(async (tx) => {
      if (existingMembership) {
        await tx.membership.update({ where: { organizationId_userId: { organizationId: invitation.organizationId, userId } }, data: { status: "ACTIVE", role: invitation.role } });
      } else {
        await tx.membership.create({ data: { organizationId: invitation.organizationId, userId, role: invitation.role } });
      }
      await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    });
    await this.audit.record({
      actorUserId: userId,
      action: "organization.invitation.accept",
      targetType: "user",
      targetId: userId,
      metadata: { organizationId: invitation.organizationId, role: invitation.role.toLowerCase() },
    });

    return { data: { organizationId: invitation.organizationId, role: invitation.role.toLowerCase() } };
  }

  @Delete("invitations/:id")
  async revokeInvitation(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const requesterRole = request.organizationRole;
    if (!requesterRole || !["owner", "admin"].includes(requesterRole)) {
      throw new ForbiddenException({ code: "forbidden", message: "Only an owner or administrator can revoke invitations" });
    }
    const invitation = await this.prisma.invitation.findFirst({ where: { id, organizationId } });
    if (!invitation) throw new NotFoundException({ code: "not_found", message: "Invitation not found" });
    await this.prisma.invitation.delete({ where: { id } });
    await this.audit.record({
      actorUserId: this.userId(request),
      action: "organization.invitation.revoke",
      targetType: "invitation",
      targetId: invitation.id,
      metadata: { organizationId, email: invitation.email },
    });
    return { ok: true };
  }

  @Patch("memberships/:id/role")
  async updateMemberRole(
    @Req() request: HttpRequest,
    @Param("id") membershipId: string,
    @Body() body: { role?: unknown },
  ) {
    const organizationId = this.organizationId(request);
    this.assertOwnerOrAdmin(request);
    const roleInput = typeof body?.role === "string" ? body.role.toLowerCase() : "";
    const role = Object.entries(ASSIGNABLE_ROLES).find(([key]) => key === roleInput)?.[1];
    if (!role) throw new BadRequestException({ code: "validation_error", message: "Choose a valid non-owner role" });

    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { id: true, userId: true, role: true },
    });
    if (!membership) throw new NotFoundException({ code: "not_found", message: "Active workspace member not found" });
    if (membership.role === "OWNER") {
      throw new ForbiddenException({ code: "forbidden", message: "Transfer ownership before changing the owner's role" });
    }
    if (request.organizationRole === "admin" && membership.userId === this.userId(request)) {
      throw new ForbiddenException({ code: "forbidden", message: "Administrators cannot change their own role" });
    }
    if (membership.role === role) return { data: { id: membership.id, role: role.toLowerCase() } };

    const updated = await this.prisma.membership.updateMany({
      where: { id: membership.id, organizationId, status: "ACTIVE", role: membership.role },
      data: { role },
    });
    if (updated.count !== 1) {
      throw new ConflictException({ code: "membership_changed", message: "This member's role changed. Refresh and try again." });
    }
    await this.audit.record({
      actorUserId: this.userId(request),
      action: "organization.member.role.update",
      targetType: "membership",
      targetId: membership.id,
      metadata: { organizationId, userId: membership.userId, from: membership.role.toLowerCase(), to: role.toLowerCase() },
    });
    return { data: { id: membership.id, role: role.toLowerCase() } };
  }

  @Post("transfer-ownership")
  async transferOwnership(@Req() request: HttpRequest, @Body() body: { membershipId?: unknown }) {
    const organizationId = this.organizationId(request);
    if (request.organizationRole !== "owner") {
      throw new ForbiddenException({ code: "forbidden", message: "Only the workspace owner can transfer ownership" });
    }
    const membershipId = typeof body?.membershipId === "string" ? body.membershipId : "";
    if (!membershipId) throw new BadRequestException({ code: "validation_error", message: "Choose an active workspace member" });

    const [currentOwner, target] = await Promise.all([
      this.prisma.membership.findFirst({
        where: { organizationId, userId: this.userId(request), role: "OWNER", status: "ACTIVE" },
        select: { id: true, userId: true },
      }),
      this.prisma.membership.findFirst({
        where: { id: membershipId, organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
        select: { id: true, userId: true },
      }),
    ]);
    if (!currentOwner) throw new ForbiddenException({ code: "forbidden", message: "Your active workspace ownership could not be verified" });
    if (!target) throw new NotFoundException({ code: "not_found", message: "Active workspace member not found" });
    if (target.id === currentOwner.id) throw new BadRequestException({ code: "validation_error", message: "Choose another member to receive ownership" });

    await this.prisma.$transaction(async (tx) => {
      const promoted = await tx.membership.updateMany({
        where: { id: target.id, organizationId, status: "ACTIVE", role: { not: "OWNER" } },
        data: { role: "OWNER" },
      });
      if (promoted.count !== 1) {
        throw new ConflictException({ code: "membership_changed", message: "The selected member changed. Refresh and try again." });
      }
      const demoted = await tx.membership.updateMany({
        where: { id: currentOwner.id, organizationId, status: "ACTIVE", role: "OWNER" },
        data: { role: "ADMIN" },
      });
      if (demoted.count !== 1) {
        throw new ConflictException({ code: "ownership_changed", message: "Workspace ownership changed. Refresh and try again." });
      }
    });
    await this.audit.record({
      actorUserId: this.userId(request),
      action: "organization.ownership.transfer",
      targetType: "organization",
      targetId: organizationId,
      metadata: { previousOwnerUserId: currentOwner.userId, newOwnerUserId: target.userId },
    });
    return { data: { organizationId, previousOwnerRole: "admin", newOwnerMembershipId: target.id } };
  }

  @Delete("memberships/:id")
  async removeMember(@Req() request: HttpRequest, @Param("id") membershipId: string) {
    const organizationId = this.organizationId(request);
    this.assertOwnerOrAdmin(request);

    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      select: { id: true, organizationId: true, userId: true, status: true, role: true },
    });
    if (!membership) throw new NotFoundException({ code: "not_found", message: "Membership not found" });
    if (membership.organizationId !== organizationId) throw new ForbiddenException({ code: "forbidden", message: "This member does not belong to the selected workspace" });
    if (membership.role === "OWNER") throw new ForbiddenException({ code: "forbidden", message: "Transfer ownership before removing the workspace owner" });

    const requester = await this.prisma.membership.findFirst({
      where: { organizationId, userId: this.userId(request), status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { role: true, userId: true },
    });
    if (!requester) throw new ForbiddenException({ code: "forbidden", message: "Your workspace membership could not be verified" });
    if (requester.userId === membership.userId && request.organizationRole !== "owner") {
      throw new ForbiddenException({ code: "forbidden", message: "Administrators cannot remove themselves from the workspace" });
    }
    await this.prisma.$transaction(async (tx) => {
      const activeCount = await tx.membership.count({
        where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
      });
      if (activeCount <= 1) {
        throw new ForbiddenException({ code: "forbidden", message: "You cannot remove the last active member of a workspace." });
      }
      const removed = await tx.membership.updateMany({
        where: { id: membership.id, organizationId, status: "ACTIVE", role: membership.role },
        data: { status: "REMOVED" },
      });
      if (removed.count !== 1) {
        throw new ConflictException({ code: "membership_changed", message: "This membership changed. Refresh and try again." });
      }
    }, { isolationLevel: "Serializable" });
    await this.audit.record({
      actorUserId: this.userId(request),
      action: "organization.member.remove",
      targetType: "membership",
      targetId: membership.id,
      metadata: { organizationId, userId: membership.userId, role: membership.role.toLowerCase() },
    });

    return { ok: true };
  }

  private assertOwnerOrAdmin(request: HttpRequest) {
    if (request.organizationRole !== "owner" && request.organizationRole !== "admin") {
      throw new ForbiddenException({ code: "forbidden", message: "Only a workspace owner or administrator can manage members" });
    }
  }

  private async assertSeatAvailable(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionPlan: true, subscriptionStatus: true, subscriptionEndsAt: true },
    });
    if (!organization) throw new NotFoundException({ code: "not_found", message: "Organization not found" });
    const plan = organization.subscriptionPlan
      ? await this.prisma.subscriptionPlan.findUnique({
          where: { code: organization.subscriptionPlan },
          select: { employeeLimit: true },
        })
      : null;
    if (!plan) throw new ForbiddenException({ code: "subscription_required", message: "An active subscription is required to add members" });
    const status = effectiveSubscriptionStatus(organization.subscriptionStatus, organization.subscriptionEndsAt);
    if (status !== "active" && status !== "trial") throw new ForbiddenException({ code: "subscription_required", message: "An active subscription is required to add members" });
    const activeCount = await this.prisma.membership.count({ where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } } });
    const pendingCount = await this.prisma.invitation.count({ where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } } });
    if (plan.employeeLimit !== null && activeCount + pendingCount >= plan.employeeLimit) {
      throw new ConflictException({ code: "seat_limit_reached", message: `This plan allows up to ${plan.employeeLimit} members` });
    }
  }
}
