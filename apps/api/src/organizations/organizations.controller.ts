import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { SUBSCRIPTION_PLANS } from "../billing/billing.controller.js";
import { effectiveSubscriptionStatus } from "../billing/subscription-status.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";

@Controller("organizations")
export class OrganizationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
        userId: true,
        role: true,
        user: { select: { name: true } },
      },
      orderBy: [{ user: { name: "asc" } }, { userId: "asc" }],
    });
    return {
      data: memberships.map(({ userId, role, user }) => ({
        id: userId,
        name: user.name,
        role: role.toLowerCase(),
      })),
    };
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
    if (!requesterRole || !["owner", "admin", "sales_manager"].includes(requesterRole)) {
      throw new ForbiddenException({ code: "forbidden", message: "Your organization role cannot invite members" });
    }
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !/^\\S+@\\S+\\.\\S+$/.test(email)) throw new BadRequestException({ code: "validation_error", message: "A valid email is required" });
    const roleInput = typeof body?.role === "string" ? body.role.toLowerCase() : "sales_rep";
    const roleMap: Record<string, "ADMIN" | "SALES_MANAGER" | "SALES_REP" | "READ_ONLY"> = {
      admin: "ADMIN",
      sales_manager: "SALES_MANAGER",
      sales_rep: "SALES_REP",
      read_only: "READ_ONLY",
    };
    const role = roleMap[roleInput];
    if (!role) throw new BadRequestException({ code: "validation_error", message: "Choose a valid role" });
    if (role === "ADMIN" && requesterRole !== "owner") throw new ForbiddenException({ code: "forbidden", message: "Only the owner can invite administrators" });

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
}

  @SkipOrganizationContext()
  @Post("invitations/:token/accept")
  async acceptInvitation(@Req() request: HttpRequest, @Param("token") token: string) {
    const userId = this.userId(request);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new UnauthorizedException({ code: "unauthorized", message: "Account not found" });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw new BadRequestException({ code: "invalid_invitation", message: "Invalid or expired invitation" });
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

    return { data: { organizationId: invitation.organizationId, role: invitation.role.toLowerCase() } };
  }

  @Delete("invitations/:id")
  async revokeInvitation(@Req() request: HttpRequest, @Param("id") id: string) {
    const organizationId = this.organizationId(request);
    const requesterRole = request.organizationRole;
    if (!requesterRole || !["owner", "admin", "sales_manager"].includes(requesterRole)) {
      throw new ForbiddenException({ code: "forbidden", message: "Your organization role cannot revoke invitations" });
    }
    const invitation = await this.prisma.invitation.findFirst({ where: { id, organizationId } });
    if (!invitation) throw new NotFoundException({ code: "not_found", message: "Invitation not found" });
    await this.prisma.invitation.delete({ where: { id } });
    return { ok: true };
  }

  private async assertSeatAvailable(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionPlan: true, subscriptionStatus: true, subscriptionEndsAt: true },
    });
    if (!organization) throw new NotFoundException({ code: "not_found", message: "Organization not found" });
    const plan = SUBSCRIPTION_PLANS.find((item) => item.code === organization.subscriptionPlan);
    if (!plan) throw new ForbiddenException({ code: "subscription_required", message: "An active subscription is required to add members" });
    const status = effectiveSubscriptionStatus(organization.subscriptionStatus, organization.subscriptionEndsAt);
    if (status !== "active" && status !== "trial") throw new ForbiddenException({ code: "subscription_required", message: "An active subscription is required to add members" });
    const activeCount = await this.prisma.membership.count({ where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } } });
    const pendingCount = await this.prisma.invitation.count({ where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } } });
    if (activeCount + pendingCount >= plan.seats) {
      throw new ConflictException({ code: "seat_limit_reached", message: `This plan allows up to ${plan.seats} members` });
    }
  }

