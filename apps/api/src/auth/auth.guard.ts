import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const unsafeRequest = !["GET", "HEAD", "OPTIONS"].includes(request.method ?? "");
    const cookieToken = this.cookieValue(request.headers.cookie, "myr_session");
    if (unsafeRequest) {
      const origin = request.headers.origin;
      const expectedOrigin = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
      const allowedOrigins = new Set([expectedOrigin]);
      const localOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1)(:\d+)?$/.exec(expectedOrigin);
      if (process.env.NODE_ENV !== "production" && localOrigin) {
        const port = localOrigin[1] ?? "";
        for (const hostname of ["localhost", "127.0.0.1"]) {
          allowedOrigins.add(`http://${hostname}${port}`);
        }
      }
      if (origin !== undefined && (typeof origin !== "string" || !allowedOrigins.has(origin))) {
        throw new ForbiddenException({ code: "csrf_rejected", message: "Request origin could not be verified" });
      }
      if (cookieToken && process.env.NODE_ENV === "production" && origin !== expectedOrigin) {
        throw new ForbiddenException({ code: "csrf_rejected", message: "Request origin could not be verified" });
      }
    }
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) ?? Reflect.getMetadata(IS_PUBLIC_KEY, context.getClass());
    if (isPublic) return true;
    const token = cookieToken;
    if (!token) throw new UnauthorizedException({ code: "unauthorized", message: "Missing session cookie" });
    if (token.length > 256) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired session" });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: "ACTIVE" } },
      select: { userId: true },
    });
    if (!session) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired session" });
    request.userId = session.userId;
    request.token = token;
    return true;
  }

  private cookieValue(header: string | string[] | undefined, name: string) {
    if (typeof header !== "string") return undefined;
    const cookie = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return cookie?.slice(name.length + 1);
  }
}
