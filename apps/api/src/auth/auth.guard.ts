import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { isEmailVerificationRequired } from "./email-verification.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) ?? Reflect.getMetadata(IS_PUBLIC_KEY, context.getClass());
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const authorization = request.headers.authorization;
    const cookieToken = typeof authorization === "string" ? undefined : this.sessionCookie(request.headers.cookie);
    const cookieAuthenticated = Boolean(cookieToken);
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : typeof authorization === "string" ? "" : cookieToken;
    if (!token) throw new UnauthorizedException({ code: "unauthorized", message: "Missing session" });
    if (token.length > 256) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired token" });
    if (cookieAuthenticated && request.method && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()) && !this.hasTrustedOrigin(request.headers.origin)) {
      throw new ForbiddenException({ code: "forbidden", message: "Request origin is not allowed" });
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: "ACTIVE" } },
      select: { userId: true, user: { select: { emailVerifiedAt: true } } },
    });
    if (!session) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired token" });
    request.userId = session.userId;
    request.token = token;
    if (isEmailVerificationRequired() && !session.user.emailVerifiedAt && !this.isVerificationExempt(request)) {
      throw new ForbiddenException({
        code: "email_verification_required",
        message: "Verify your email address to access your workspace.",
      });
    }
    return true;
  }

  private isVerificationExempt(request: HttpRequest) {
    const path = request.path.replace(/^\/api\/v\d+/, "");
    return ["/auth/me", "/auth/logout", "/auth/refresh", "/auth/resend-verification"].some(
      (allowed) => path === allowed,
    );
  }

  private sessionCookie(cookieHeader: string | string[] | undefined) {
    if (typeof cookieHeader !== "string") return undefined;
    for (const cookie of cookieHeader.split(";")) {
      const separator = cookie.indexOf("=");
      if (separator < 0 || cookie.slice(0, separator).trim() !== "myr.session") continue;
      return cookie.slice(separator + 1).trim();
    }
    return undefined;
  }

  private hasTrustedOrigin(originHeader: string | string[] | undefined) {
    if (typeof originHeader !== "string") return false;
    try {
      const origin = new URL(originHeader).origin;
      const allowedOrigin = new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000").origin;
      return origin === allowedOrigin;
    } catch {
      return false;
    }
  }
}
