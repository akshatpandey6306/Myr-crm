import { Body, Controller, ForbiddenException, Get, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { SkipOrganizationContext } from "../auth/public.decorator.js";

@Controller("organizations")
export class OrganizationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("modules")
  async listEnabledModules(@Req() request: HttpRequest) {
    if (!request.userId || !request.orgId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }
    const isAdministrator = request.organizationRole === "owner" || request.organizationRole === "admin";
    return {
      data: {
        enabledModules: [...new Set(request.enabledModules ?? [])],
        assignableModules: isAdministrator ? (request.workspaceEnabledModules ?? []) : [],
      },
    };
  }

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

  @SkipOrganizationContext()
  @Post()
  async create(@Req() request: HttpRequest, @Body() body: { name?: unknown }) {
    this.userId(request);
    throw new ForbiddenException({ code: "central_provisioning_required", message: "Workspaces are provisioned by the platform administrator or an authorized integration partner." });
  }

  private userId(request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    return request.userId;
  }
}
