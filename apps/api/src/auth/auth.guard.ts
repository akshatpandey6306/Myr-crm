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
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const unsafeRequest = !["GET", "HEAD", "OPTIONS"].includes(request.method ?? "");
    const cookieToken = this.cookieValue(request.headers.cookie, "myr_session");
    if (unsafeRequest) {
      const origin = request.headers.origin;
      const expectedOrigin = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
      if (origin !== undefined && (typeof origin !== "string" || origin !== expectedOrigin)) {
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
      select: { userId: true, user: { select: { emailVerifiedAt: true } } },
    });
    if (!session) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired session" });
    if (isEmailVerificationRequired() && !session.user.emailVerifiedAt && !this.isVerificationExempt(request.path)) {
      throw new ForbiddenException({ code: "email_not_verified", message: "Verify your email address before continuing" });
    }
    request.userId = session.userId;
    request.token = token;
    return true;
  }

  private cookieValue(header: string | string[] | undefined, name: string) {
    if (typeof header !== "string") return undefined;
    const cookie = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return cookie?.slice(name.length + 1);
  }

  private isVerificationExempt(path = "") {
    const route = path.replace(/^\/api\/v\d+/, "");
    return ["/auth/me", "/auth/logout", "/auth/email-verification/resend", "/auth/email-verification/confirm"].includes(route);
  }
}
