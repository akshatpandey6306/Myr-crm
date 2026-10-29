import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) ?? Reflect.getMetadata(IS_PUBLIC_KEY, context.getClass());
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Missing bearer token" });
    }
    const token = authorization.slice("Bearer ".length).trim();
    if (!token || token.length > 256) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired token" });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: "ACTIVE" } },
      select: { userId: true },
    });
    if (!session) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired token" });
    request.userId = session.userId;
    request.token = token;
    return true;
  }
}
