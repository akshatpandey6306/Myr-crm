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
  it("limits sign-in to 5 attempts per IP per minute", async () => {
    const attempts = new Map<string, number>();
    const prisma = {
      $queryRaw: async (_query: TemplateStringsArray, keyHash: string) => {
        const count = (attempts.get(keyHash) ?? 0) + 1;
        attempts.set(keyHash, count);
        return [{ attempts: count, window_started_at: new Date() }];
      },
      $executeRaw: async () => 0,
    };
    const guard = new RateLimitGuard(prisma as never);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(await guard.canActivate(context({
        method: "POST",
        path: "/api/v1/auth/login",
        ip: "192.0.2.3",
        body: { email: "riley@example.com" },
      })), true);
    }

    await assert.rejects(guard.canActivate(context({
      method: "POST",
      path: "/api/v1/auth/login",
      ip: "192.0.2.3",
      body: { email: "riley@example.com" },
    })), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 429);
      const response = error.getResponse() as { retryAfterSeconds: number };
      assert.ok(response.retryAfterSeconds > 0 && response.retryAfterSeconds <= 60);
      return true;
    });
  });

  it("limits sign-in to 5 attempts per email per minute across different IPs", async () => {
    const attempts = new Map<string, number>();
    const prisma = {
      $queryRaw: async (_query: TemplateStringsArray, keyHash: string) => {
        const count = (attempts.get(keyHash) ?? 0) + 1;
        attempts.set(keyHash, count);
        return [{ attempts: count, window_started_at: new Date() }];
      },
    };
    const guard = new RateLimitGuard(prisma as never);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(await guard.canActivate(context({
        method: "POST",
        path: "/api/v1/auth/login",
        ip: `192.0.2.${attempt + 10}`,
        body: { email: "riley@example.com" },
      })), true);
    }

    await assert.rejects(guard.canActivate(context({
      method: "POST",
      path: "/api/v1/auth/login",
      ip: "192.0.2.30",
      body: { email: "riley@example.com" },
    })), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 429);
      const response = error.getResponse() as { retryAfterSeconds: number };
      assert.ok(response.retryAfterSeconds > 0 && response.retryAfterSeconds <= 60);
      return true;
    });
  });

  it("limits sign-up to 5 attempts per IP and email per minute", async () => {
    const attempts = new Map<string, number>();
    const prisma = {
      $queryRaw: async (_query: TemplateStringsArray, keyHash: string) => {
        const count = (attempts.get(keyHash) ?? 0) + 1;
        attempts.set(keyHash, count);
        return [{ attempts: count, window_started_at: new Date() }];
      },
      $executeRaw: async () => 0,
    };
    const guard = new RateLimitGuard(prisma as never);
    const request = {
      method: "POST",
      path: "/api/v1/auth/signup",
      ip: "192.0.2.2",
      body: { email: "new-user@example.com" },
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(await guard.canActivate(context(request)), true);
    }

    await assert.rejects(guard.canActivate(context(request)), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 429);
      const response = error.getResponse() as { retryAfterSeconds: number };
      assert.ok(response.retryAfterSeconds > 0 && response.retryAfterSeconds <= 60);
      return true;
    });
  });

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

    for (let attempt = 0; attempt < 5; attempt += 1) {
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

  it("limits expensive imports by user and IP", async () => {
    const attempts = new Map<string, number>();
    const prisma = {
      $queryRaw: async (_query: TemplateStringsArray, keyHash: string) => {
        const count = (attempts.get(keyHash) ?? 0) + 1;
        attempts.set(keyHash, count);
        return [{ attempts: count, window_started_at: new Date() }];
      },
      $executeRaw: async () => 0,
    };
    const guard = new RateLimitGuard(prisma as never);
    const request = {
      method: "POST",
      path: "/api/v1/leads/import",
      ip: "192.0.2.44",
      userId: "user-1",
      body: { rows: [] },
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal(await guard.canActivate(context(request)), true);
    }
    await assert.rejects(guard.canActivate(context(request)), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 429);
      return true;
    });
  });
});
