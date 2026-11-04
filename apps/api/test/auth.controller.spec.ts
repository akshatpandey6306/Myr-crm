import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { AuthController } from "../src/auth/auth.controller.js";
import { AuthRateLimitService } from "../src/auth/auth-rate-limit.service.js";

const originalNodeEnv = process.env.NODE_ENV;
const originalRequireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION;
const noRateLimit = { assertAllowed: async () => undefined };
const testEmail = {
  isConfigured: () => false,
  sendVerification: async () => undefined,
  sendPasswordReset: async () => undefined,
};

function controller(prisma: object, rateLimits: object = noRateLimit, email: object = testEmail) {
  return new AuthController(prisma as never, rateLimits as AuthRateLimitService, email as never);
}

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalRequireEmailVerification === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
  else process.env.REQUIRE_EMAIL_VERIFICATION = originalRequireEmailVerification;
});

describe("AuthController signup", () => {
  it("creates the user, owner membership, organization, and expiring session in one nested write", async () => {
    let createArgs: Record<string, unknown> | undefined;
    const organization = { id: "org-a", name: "Northwind" };
    const user = {
      id: "user-a",
      email: "maya@example.com",
      name: "Maya Chen",
      memberships: [{ organization, role: "OWNER" }],
    };
    const prisma = {
      user: {
        create: async (args: Record<string, unknown>) => {
          createArgs = args;
          return user;
        },
      },
    };
    const auth = controller(prisma);
    let setCookie = "";
    const httpResponse = { setHeader: (name: string, value: string) => { if (name === "Set-Cookie") setCookie = value; } };

    const signupResponse = await auth.signup({ headers: {}, params: {}, path: "" }, {
      name: "Maya Chen",
      email: "Maya@Example.com",
      password: "password123",
      organizationName: "Northwind",
    }, httpResponse as never);

    const data = createArgs?.data as {
      memberships: {
        create: {
          role: string;
          organization: {
            create: {
              name: string;
              pipelines: {
                create: {
                  name: string;
                  isDefault: boolean;
                  stages: { create: { name: string; position: number }[] };
                };
              };
            };
          };
        };
      };
      sessions: { create: { tokenHash: string; expiresAt: Date } };
      passwordHash: string;
    };
    assert.equal((createArgs?.data as { email: string }).email, "maya@example.com");
    assert.equal(data.memberships.create.role, "OWNER");
    assert.equal(data.memberships.create.organization.create.name, "Northwind");
    const defaultPipeline = data.memberships.create.organization.create.pipelines.create;
    assert.equal(defaultPipeline.name, "Sales pipeline");
    assert.equal(defaultPipeline.isDefault, true);
    assert.deepEqual(defaultPipeline.stages.create.map((stage) => stage.name), ["Discovery", "Qualified", "Proposal", "Negotiation"]);
    assert.match(data.passwordHash, /^scrypt\$/);
    assert.equal(data.sessions.create.tokenHash.length, 64);
    assert.ok(data.sessions.create.expiresAt.getTime() > Date.now());
    assert.equal(signupResponse.organization.id, "org-a");
    assert.equal(signupResponse.token.length, 43);
    assert.notEqual(data.sessions.create.tokenHash, signupResponse.token);
    assert.ok(Array.isArray(setCookie) && setCookie.some((cookie) => cookie.startsWith("myr.session=")));
    assert.ok(Array.isArray(setCookie) && setCookie.some((cookie) => cookie.startsWith("myr.refresh=")));
  });

  it("does not return email verification tokens in production", async () => {
    process.env.NODE_ENV = "production";
    const auth = controller({
      user: {
        create: async () => ({
          id: "user-a",
          email: "maya@example.com",
          name: "Maya Chen",
          memberships: [{ organization: { id: "org-a", name: "Northwind" }, role: "OWNER" }],
        }),
      },
    } as never);

    const result = await auth.signup({ headers: {}, params: {}, path: "" }, {
      name: "Maya Chen",
      email: "maya@example.com",
      password: "password123",
      organizationName: "Northwind",
    }, { setHeader: () => undefined } as never);

    assert.equal("emailVerificationToken" in result, false);
    assert.equal(result.emailVerificationRequired, true);
  });

  it("skips verification email and marks signup verified when verification is disabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.REQUIRE_EMAIL_VERIFICATION = "false";
    let verificationEmailSent = false;
    const auth = controller({
      user: {
        create: async (args: { data: { emailVerifiedAt?: Date } }) => {
          assert.ok(args.data.emailVerifiedAt instanceof Date);
          return {
            id: "user-a",
            email: "maya@example.com",
            name: "Maya Chen",
            memberships: [{ organization: { id: "org-a", name: "Northwind" }, role: "OWNER" }],
          };
        },
      },
    }, noRateLimit, {
      ...testEmail,
      sendVerification: async () => {
        verificationEmailSent = true;
      },
    });

    const result = await auth.signup({ headers: {}, params: {}, path: "" }, {
      name: "Maya Chen",
      email: "maya@example.com",
      password: "password123",
      organizationName: "Northwind",
    }, { setHeader: () => undefined } as never);

    assert.equal(verificationEmailSent, false);
    assert.equal("emailVerificationRequired" in result, false);
  });
});

describe("AuthController login throttling", () => {
  it("counts failed login attempts toward the rate limit", async () => {
    const calls = new Map<string, number>();
    const auth = controller({ user: { findUnique: async () => null } }, {
      assertAllowed: async (key: string, limit: number) => {
        const count = (calls.get(key) ?? 0) + 1;
        calls.set(key, count);
        if (count > limit) throw new HttpException({ code: "rate_limited" }, 429);
      },
    });
    const request = { email: "unknown@example.com", password: "incorrect" };
    const response = { setHeader: () => undefined };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await assert.rejects(auth.login({ headers: {}, params: {}, path: "" }, request, response as never));
    }
    await assert.rejects(auth.login({ headers: {}, params: {}, path: "" }, request, response as never), (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 429,
    );
  });
});

describe("AuthController password reset", () => {
  it("does not return reset tokens in production", async () => {
    process.env.NODE_ENV = "production";
    const auth = controller({
      user: {
        findUnique: async () => ({ id: "user-a" }),
        update: async () => undefined,
      },
    });

    const result = await auth.requestPasswordReset({ email: "maya@example.com" });

    assert.deepEqual(result, { ok: true });
  });

  it("revokes existing sessions when resetting a password", async () => {
    let updatedUser: Record<string, unknown> | undefined;
    let revokedSessions: Record<string, unknown> | undefined;
    const auth = controller({
      user: { findFirst: async () => ({ id: "user-a" }) },
      $transaction: async (operation: (tx: never) => Promise<void>) => operation({
        user: { updateMany: async (args: Record<string, unknown>) => { updatedUser = args; return { count: 1 }; } },
        session: { updateMany: async (args: Record<string, unknown>) => { revokedSessions = args; } },
        refreshToken: { updateMany: async () => ({ count: 1 }) },
      } as never),
    });

    assert.deepEqual(await auth.resetPassword({ token: "reset-token", password: "new-password" }), { ok: true });
    assert.deepEqual(revokedSessions?.where, { userId: "user-a", revokedAt: null });
    assert.equal(typeof (updatedUser?.data as Record<string, unknown>).passwordHash, "string");
    assert.equal((updatedUser?.data as Record<string, unknown>).passwordResetTokenHash, null);
  });

  it("rotates a session once and rejects reuse", async () => {
    let active = true;
    const created: Record<string, unknown>[] = [];
    const auth = controller({
      refreshToken: { findFirst: async () => ({ id: "refresh-a", userId: "user-a" }) },
      $transaction: async (operation: (tx: never) => Promise<unknown>) => operation({
        session: {
          create: async (args: Record<string, unknown>) => { created.push(args); },
        },
        refreshToken: {
          updateMany: async () => {
            if (!active) return { count: 0 };
            active = false;
            return { count: 1 };
          },
          create: async (args: Record<string, unknown>) => { created.push(args); },
        },
      } as never),
    });
    const request = { headers: {}, params: {}, path: "/api/v1/auth/refresh" };
    const cookies: (string | string[])[] = [];
    const response = { setHeader: (_name: string, value: string | string[]) => cookies.push(value) };

    const first = await auth.refresh(request, { refreshToken: "old-token" }, response as never);
    assert.equal(typeof first.token, "string");
    assert.equal(typeof first.refreshToken, "string");
    assert.equal(created.length, 2);
    assert.ok(Array.isArray(cookies[0]) && cookies[0].some((cookie) => cookie.startsWith("myr.session=")));
    await assert.rejects(auth.refresh(request, { refreshToken: "old-token" }, response as never));
  });
});
