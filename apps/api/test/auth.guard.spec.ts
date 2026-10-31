import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { AuthGuard } from "../src/auth/auth.guard.js";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";

function context(request: Record<string, unknown>, handler = () => undefined) {
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("AuthGuard cookie sessions", () => {
  it("authenticates using the HttpOnly session cookie digest", async () => {
    const token = "random-session-value";
    let query: Record<string, unknown> | undefined;
    const guard = new AuthGuard({
      session: {
        findFirst: async (args: Record<string, unknown>) => {
          query = args;
          return { userId: "user-a" };
        },
      },
    } as never);
    const request = {
      headers: { cookie: `other=value; myr_session=${token}` },
      method: "GET",
      path: "/api/v1/auth/me",
      params: {},
    };

    assert.equal(await guard.canActivate(context(request)), true);
    assert.equal(request.userId, "user-a");
    assert.equal(request.token, token);
    assert.deepEqual((query?.where as Record<string, unknown>).tokenHash, createHash("sha256").update(token).digest("hex"));
  });

  it("rejects cross-origin unsafe requests, including public login routes", async () => {
    const previousOrigin = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = "https://crm.example.com";
    try {
      const handler = () => undefined;
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
      const guard = new AuthGuard({} as never);
      await assert.rejects(
        guard.canActivate(context({
          headers: { origin: "https://attacker.example" },
          method: "POST",
          path: "/api/v1/auth/login",
          params: {},
        }, handler)),
        ForbiddenException,
      );
    } finally {
      if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
      else process.env.WEB_ORIGIN = previousOrigin;
    }
  });
});
