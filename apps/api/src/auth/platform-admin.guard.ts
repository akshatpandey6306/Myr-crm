import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });

    const allowedEmails = new Set(
      (process.env.PLATFORM_ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
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
