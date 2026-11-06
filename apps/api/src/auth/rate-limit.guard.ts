import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

type Policy = { limit: number; windowSeconds: number; emailKey?: boolean; userKey?: boolean };

const policies = new Map<string, Policy>([
  ["POST /auth/login", { limit: 10, windowSeconds: 900, emailKey: true }],
  ["POST /auth/signup", { limit: 5, windowSeconds: 3600, emailKey: true }],
  ["POST /auth/password-reset/request", { limit: 5, windowSeconds: 3600, emailKey: true }],
  ["POST /auth/password-reset/confirm", { limit: 10, windowSeconds: 3600 }],
  ["POST /billing/request-activation", { limit: 3, windowSeconds: 3600, userKey: true }],
  ["POST /auth/email-verification/resend", { limit: 5, windowSeconds: 3600, emailKey: true }],
  ["POST /auth/email-verification/confirm", { limit: 10, windowSeconds: 3600 }],
  ["POST /organizations/join-requests", { limit: 5, windowSeconds: 3600, userKey: true }],
]);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private operations = 0;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<HttpRequest & { method: string; ip?: string; body?: Record<string, unknown> }>();
    const path = request.path.replace(/^\/api\/v1/, "");
    const policy = policies.get(`${request.method} ${path}`);
    if (!policy) return true;

    const ip = request.ip || "unknown";
    const keys = [`ip:${ip}`];
    if (policy.emailKey && typeof request.body?.email === "string") {
      keys.push(`email:${request.body.email.trim().toLowerCase()}`);
    }
    if (policy.userKey && request.userId) keys.push(`user:${request.userId}`);

    for (const key of keys) {
      const keyHash = createHash("sha256").update(`${request.method}:${path}:${key}`).digest("hex");
      const [bucket] = await this.prisma.$queryRaw<{ attempts: number; window_started_at: Date }[]>`
        INSERT INTO "rate_limit_buckets" ("key_hash", "window_started_at", "attempts", "expires_at")
        VALUES (${keyHash}, now(), 1, now() + (${policy.windowSeconds} * interval '1 second'))
        ON CONFLICT ("key_hash") DO UPDATE SET
          "attempts" = CASE
            WHEN "rate_limit_buckets"."window_started_at" <= now() - (${policy.windowSeconds} * interval '1 second') THEN 1
            ELSE "rate_limit_buckets"."attempts" + 1
          END,
          "window_started_at" = CASE
            WHEN "rate_limit_buckets"."window_started_at" <= now() - (${policy.windowSeconds} * interval '1 second') THEN now()
            ELSE "rate_limit_buckets"."window_started_at"
          END,
          "expires_at" = now() + (${policy.windowSeconds} * interval '1 second')
        RETURNING "attempts", "window_started_at"
      `;
      if (bucket && bucket.attempts > policy.limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((bucket.window_started_at.getTime() + policy.windowSeconds * 1000 - Date.now()) / 1000),
        );
        throw new HttpException({
          code: "rate_limited",
          message: "Too many attempts. Please wait before trying again.",
          retryAfterSeconds,
        }, HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    this.operations += 1;
    if (this.operations % 100 === 0) {
      await this.prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "expires_at" < now()`;
    }
    return true;
  }
}
