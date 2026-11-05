import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { AuthRateLimitService } from "../src/auth/auth-rate-limit.service.js";

describe("AuthRateLimitService", () => {
  it("uses a persistent bucket and rejects requests beyond its limit", async () => {
    let count = 0;
    let cleanupCalls = 0;
    const prisma = {
      $queryRaw: async () => [{ count: ++count }],
      $executeRaw: async () => { cleanupCalls += 1; return 0; },
    };
    const limits = new AuthRateLimitService(prisma as never);

    await limits.assertAllowed("login:maya@example.com", 1, 60_000);
    await assert.rejects(limits.assertAllowed("login:maya@example.com", 1, 60_000), (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 429,
    );
    assert.equal(cleanupCalls, 1);
  });
});
