import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { IS_PUBLIC_KEY, SKIP_ORG_CONTEXT_KEY } from "./public.decorator.js";

@Injectable()
export class OrgGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();
    if (Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? Reflect.getMetadata(IS_PUBLIC_KEY, controller)) return true;
    if (Reflect.getMetadata(SKIP_ORG_CONTEXT_KEY, handler) ?? Reflect.getMetadata(SKIP_ORG_CONTEXT_KEY, controller)) return true;
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const userId = request.userId;
    if (!userId) return true; // AuthGuard reports the authentication error.

    const path = request.path || "";
    if (path.includes("/auth/") || path.includes("/health")) return true;
    const headerOrganizationId = request.headers["x-organization-id"];
    const organizationId =
      (request.params && (request.params.orgId || request.params.organizationId)) ||
      (typeof headerOrganizationId === "string" ? headerOrganizationId : undefined);
    if (!organizationId) throw new NotFoundException({ code: "org_not_found", message: "Organization context required" });

    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { organizationId: true, role: true },
    });
    if (!membership) throw new NotFoundException({ code: "not_found", message: "Organization not found" });
    request.orgId = membership.organizationId;
    request.organizationRole = membership.role.toLowerCase() as HttpRequest["organizationRole"];
    return true;
  }
}
