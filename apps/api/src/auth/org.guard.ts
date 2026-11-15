import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { IS_PUBLIC_KEY, SKIP_ORG_CONTEXT_KEY } from "./public.decorator.js";
import { effectiveSubscriptionStatus } from "../billing/subscription-status.js";

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
      select: {
        organizationId: true,
        role: true,
        enabledModules: true,
        organization: {
          select: {
            status: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true,
            enabledModules: true,
          },
        },
      },
    });
    if (!membership) throw new NotFoundException({ code: "not_found", message: "Organization not found" });
    if (membership.organization.status !== "ACTIVE") {
      throw new ForbiddenException({ code: "organization_suspended", message: "This workspace has been suspended. Contact your account administrator." });
    }
    const subscription = membership.organization;
    const currentSubscriptionStatus = effectiveSubscriptionStatus(subscription.subscriptionStatus, subscription.subscriptionEndsAt);
    if (currentSubscriptionStatus !== "active" && currentSubscriptionStatus !== "trial") {
      throw new ForbiddenException({
        code: currentSubscriptionStatus === "expired" ? "subscription_expired" : "subscription_required",
        message: "An active subscription is required to access this workspace.",
      });
    }
    request.orgId = membership.organizationId;
    request.organizationRole = membership.role.toLowerCase() as HttpRequest["organizationRole"];
    const workspaceModules = membership.organization.enabledModules ?? [
      "leads", "contacts", "companies", "deals", "activities", "vendors", "billing-invoicing", "team", "automation", "email", "reports", "audit-logs", "settings",
    ];
    const isAdministrator = membership.role === "OWNER" || membership.role === "ADMIN";
    const enabledModules = isAdministrator
      ? workspaceModules
      : workspaceModules.filter((module) => module !== "team" && (membership.enabledModules ?? ["leads", "contacts", "companies", "deals", "activities", "vendors"]).includes(module));
    request.enabledModules = enabledModules;
    const module = this.moduleForPath(path);
    if (module && !enabledModules.includes(module)) {
      throw new ForbiddenException({ code: "module_disabled", message: `The ${module} module is not enabled for this workspace.` });
    }
    return true;
  }

  private moduleForPath(path: string) {
    const route = path.replace(/^\/api\/v\d+/, "").split("?")[0] ?? "";
    const moduleRoutes: Array<[string, string[]]> = [
      ["leads", ["/leads"]],
      ["contacts", ["/contacts"]],
      ["companies", ["/companies"]],
      ["vendors", ["/vendors"]],
      ["billing-invoicing", ["/invoicing"]],
      ["deals", ["/deals", "/pipelines"]],
      ["activities", ["/activities"]],
      ["team", ["/organizations/members", "/organizations/membership-requests", "/organizations/join-code"]],
      ["automation", ["/automations"]],
      ["email", ["/emails"]],
      ["reports", ["/reports"]],
      ["audit-logs", ["/audit-logs"]],
      ["settings", ["/settings"]],
    ];
    return moduleRoutes.find(([, prefixes]) =>
      prefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`)),
    )?.[0];
  }
}
