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
          return { id: "session-a", userId: "user-a", lastSeenAt: new Date(), user: { emailVerifiedAt: new Date() } };
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

  it("allows localhost loopback aliases for local browser login", async () => {
    const previousOrigin = process.env.WEB_ORIGIN;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.NODE_ENV = "development";
    try {
      const handler = () => undefined;
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
      const guard = new AuthGuard({} as never);
      assert.equal(await guard.canActivate(context({
        headers: { origin: "http://127.0.0.1:3000" },
        method: "POST",
        path: "/api/v1/auth/login",
        params: {},
      }, handler)), true);
    } finally {
      if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
      else process.env.WEB_ORIGIN = previousOrigin;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("does not allow localhost aliases for production requests", async () => {
    const previousOrigin = process.env.WEB_ORIGIN;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.NODE_ENV = "production";
    try {
      const handler = () => undefined;
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
      const guard = new AuthGuard({} as never);
      await assert.rejects(guard.canActivate(context({
        headers: { origin: "http://127.0.0.1:3000" },
        method: "POST",
        path: "/api/v1/auth/login",
        params: {},
      }, handler)), ForbiddenException);
    } finally {
      if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
      else process.env.WEB_ORIGIN = previousOrigin;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("allows unverified sessions even when the legacy verification setting is enabled in production", async () => {
    const previousVerificationSetting = process.env.REQUIRE_EMAIL_VERIFICATION;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    process.env.NODE_ENV = "production";
    const guard = new AuthGuard({ session: { findFirst: async () => ({ id: "session-a", userId: "user-a", lastSeenAt: new Date(), user: { emailVerifiedAt: null } }) } } as never);
    const request = { headers: { cookie: "myr_session=demo-session" }, method: "GET", path: "/api/v1/leads", params: {} };

    try {
      assert.equal(await guard.canActivate(context(request)), true);
    } finally {
      if (previousVerificationSetting === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
      else process.env.REQUIRE_EMAIL_VERIFICATION = previousVerificationSetting;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
