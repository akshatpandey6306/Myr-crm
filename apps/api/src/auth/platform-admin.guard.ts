import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });

    const configuredEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
    const configuredEmails = configuredEmail
      ? [configuredEmail]
      : (process.env.PLATFORM_ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
    const allowedEmails = new Set(configuredEmails);
    if (allowedEmails.size > 1) {
      throw new ForbiddenException({
        code: "platform_admin_misconfigured",
        message: "Configure exactly one platform administrator account",
      });
    }
    if (!allowedEmails.size && process.env.NODE_ENV !== "production") {
      allowedEmails.add("admin@myrcrm.local");
    }
    if (!allowedEmails.size) {
      throw new ForbiddenException({ code: "forbidden", message: "Platform administration is not configured" });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: request.userId },
      select: { email: true, status: true },
    });
    if (!user || user.status !== "ACTIVE" || !allowedEmails.has(user.email.toLowerCase())) {
      throw new ForbiddenException({ code: "forbidden", message: "Platform administrator access required" });
    }
    return true;
  }
}
