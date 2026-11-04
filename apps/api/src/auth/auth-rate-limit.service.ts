import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class AuthRateLimitService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private lastCleanupAt = 0;

  async assertAllowed(key: string, limit: number, windowMs: number) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + windowMs);
    const keyHash = createHash("sha256").update(key).digest("hex");

    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "auth_rate_limit_buckets" ("key_hash", "count", "reset_at", "updated_at")
      VALUES (${keyHash}, 1, ${resetAt}, ${now})
      ON CONFLICT ("key_hash") DO UPDATE SET
        "count" = CASE
          WHEN "auth_rate_limit_buckets"."reset_at" <= ${now} THEN 1
          ELSE "auth_rate_limit_buckets"."count" + 1
        END,
        "reset_at" = CASE
          WHEN "auth_rate_limit_buckets"."reset_at" <= ${now} THEN ${resetAt}
          ELSE "auth_rate_limit_buckets"."reset_at"
        END,
        "updated_at" = ${now}
      RETURNING "count"
    `;

    if (Date.now() - this.lastCleanupAt >= 60_000) {
      await this.prisma.$executeRaw`
        DELETE FROM "auth_rate_limit_buckets" WHERE "reset_at" < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
      `;
      this.lastCleanupAt = Date.now();
    }

    if ((rows[0]?.count ?? 0) > limit) {
      throw new HttpException(
        { code: "rate_limited", message: "Too many requests. Try again later." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
