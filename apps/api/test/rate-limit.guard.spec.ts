import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { RateLimitGuard } from "../src/auth/rate-limit.guard.js";

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("RateLimitGuard", () => {
  it("limits auth attempts by hashed IP and email keys", async () => {
    const attempts = new Map<string, number>();
    const keyHashes: string[] = [];
    const prisma = {
      $queryRaw: async (_query: TemplateStringsArray, keyHash: string) => {
        keyHashes.push(keyHash);
        const count = (attempts.get(keyHash) ?? 0) + 1;
        attempts.set(keyHash, count);
        return [{ attempts: count, window_started_at: new Date() }];
      },
    };
    const guard = new RateLimitGuard(prisma as never);
    const request = {
      method: "POST",
      path: "/api/v1/auth/login",
      ip: "192.0.2.1",
      body: { email: "riley@example.com" },
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal(await guard.canActivate(context(request)), true);
    }
    await assert.rejects(guard.canActivate(context(request)), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 429);
      return true;
    });
    assert.ok(keyHashes.length >= 11);
    assert.ok(keyHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)));
    assert.equal(keyHashes.includes("riley@example.com"), false);
  });
});
