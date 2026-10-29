import { BadRequestException, Body, Controller, Get, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
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
