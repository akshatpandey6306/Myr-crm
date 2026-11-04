import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "../src/auth/auth.guard.js";

function makeContext(request: Record<string, unknown>) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe("AuthGuard", () => {
  it("authenticates using the HttpOnly session cookie", async () => {
    const request: { headers: { cookie: string }; userId?: string; token?: string } = {
      headers: { cookie: "theme=dark; myr.session=session-token" },
    };
    let sessionQuery: Record<string, unknown> | undefined;
    const prisma = {
      session: {
        findFirst: async (args: Record<string, unknown>) => {
          sessionQuery = args;
          return { userId: "user-a", user: { emailVerifiedAt: new Date() } };
        },
      },
    };
    const guard = new AuthGuard(prisma as never);

    assert.equal(await guard.canActivate(makeContext(request) as never), true);
    assert.equal(request.userId, "user-a");
    assert.equal(request.token, "session-token");
    assert.equal((sessionQuery?.where as Record<string, unknown>).tokenHash, "c101e911469c969171040b50d70543313cf968fdef5bacc780776f8fb399ab36");
  });

  it("continues accepting bearer tokens for API clients", async () => {
    const request: { headers: { authorization: string }; token?: string } = { headers: { authorization: "Bearer legacy-token" } };
    const prisma = { session: { findFirst: async () => ({ userId: "user-a", user: { emailVerifiedAt: new Date() } }) } };
    const guard = new AuthGuard(prisma as never);

    assert.equal(await guard.canActivate(makeContext(request) as never), true);
    assert.equal(request.token, "legacy-token");
  });

  it("requires the configured web origin for cookie-authenticated mutations", async () => {
    const request = {
      headers: { cookie: "myr.session=session-token", origin: "https://attacker.example" },
      method: "POST",
    };
    const guard = new AuthGuard({} as never);

    await assert.rejects(guard.canActivate(makeContext(request) as never), ForbiddenException);
  });

  it("rejects requests without a bearer token or session cookie", async () => {
    const guard = new AuthGuard({} as never);

    await assert.rejects(guard.canActivate(makeContext({ headers: {} }) as never), UnauthorizedException);
  });

  it("blocks unverified production sessions outside account recovery endpoints", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const guard = new AuthGuard({
        session: { findFirst: async () => ({ userId: "user-a", user: { emailVerifiedAt: null } }) },
      } as never);
      await assert.rejects(guard.canActivate(makeContext({
        headers: { authorization: "Bearer token" },
        path: "/api/v1/leads",
      }) as never), (error: unknown) =>
        error instanceof ForbiddenException && error.getResponse() instanceof Object &&
        JSON.stringify(error.getResponse()).includes("email_verification_required"),
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
