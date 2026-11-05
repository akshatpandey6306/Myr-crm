import assert from "node:assert/strict";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { AuthController } from "../src/auth/auth.controller.js";

function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
}

describe("AuthController", () => {
  it("creates an unverified owner account and sends a one-time email-verification link", async () => {
    const previousVerificationSetting = process.env.REQUIRE_EMAIL_VERIFICATION;
    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    let userCreate: Record<string, unknown> | undefined;
    let tokenCreate: Record<string, unknown> | undefined;
    let sentText = "";
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
          userCreate = args;
          return user;
        },
      },
      emailToken: {
        updateMany: async () => ({ count: 0 }),
        create: async (args: Record<string, unknown>) => {
          tokenCreate = args;
          return {};
        },
      },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const controller = new AuthController(prisma as never, { send: async (_to: string, _subject: string, text: string) => { sentText = text; } } as never);

    const response = await controller.signup({
      name: "Maya Chen",
      email: "Maya@Example.com",
      password: "password123",
      organizationName: "Northwind",
    });

    type SignupPipeline = { name: string; isDefault: boolean; stages: { create: { name: string; position: number }[] } };
    type SignupOrganization = { create: { name: string; pipelines: { create: SignupPipeline } } };
    type SignupMemberships = { create: { role: string; organization: SignupOrganization } };
    const data = userCreate?.data as {
      email: string;
      memberships: SignupMemberships;
      passwordHash: string;
    };
    assert.equal(data.email, "maya@example.com");
    assert.equal(data.memberships.create.role, "OWNER");
    assert.equal(data.memberships.create.organization.create.name, "Northwind");
    const pipeline = data.memberships.create.organization.create.pipelines.create;
    assert.equal(pipeline.name, "Sales pipeline");
    assert.equal(pipeline.isDefault, true);
    assert.deepEqual(pipeline.stages.create.map((stage) => stage.name), ["Discovery", "Qualified", "Proposal", "Negotiation"]);
    assert.match(data.passwordHash, /^scrypt\$/);
    assert.equal(response.organization.id, "org-a");
    assert.equal(response.verificationRequired, true);
    assert.equal("token" in response, false);
    assert.equal((tokenCreate?.data as { purpose: string }).purpose, "EMAIL_VERIFICATION");
    const storedHash = (tokenCreate?.data as { tokenHash: string }).tokenHash;
    const sentToken = new URL(sentText.match(/https?:\/\/\S+/)?.[0] ?? "http://localhost").searchParams.get("token");
    assert.ok(sentToken);
    assert.equal(storedHash, createHash("sha256").update(sentToken!).digest("hex"));
    assert.notEqual(storedHash, sentToken);
    if (previousVerificationSetting === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
    else process.env.REQUIRE_EMAIL_VERIFICATION = previousVerificationSetting;
  });

  it("sets a secure HttpOnly session cookie after verified login without returning the session token", async () => {
    let sessionCreate: Record<string, unknown> | undefined;
    let cookie: { name: string; value: string; options: Record<string, unknown> } | undefined;
    const prisma = {
      user: {
        findUnique: async () => ({
          id: "user-a",
          email: "maya@example.com",
          name: "Maya Chen",
          passwordHash: hashPassword("password123"),
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          memberships: [{ organization: { id: "org-a", name: "Northwind" } }],
        }),
      },
      session: { create: async (args: Record<string, unknown>) => { sessionCreate = args; return {}; } },
    };
    const controller = new AuthController(prisma as never, {} as never);
    const response = await controller.login(
      { email: "Maya@Example.com", password: "password123" },
      { cookie: (name, value, options) => { cookie = { name, value, options }; }, clearCookie: () => undefined },
    );

    assert.equal(cookie?.name, "myr_session");
    assert.equal(cookie?.options.httpOnly, true);
    assert.equal(cookie?.options.sameSite, "lax");
    assert.equal(cookie?.options.path, "/");
    assert.equal((sessionCreate?.data as { tokenHash: string }).tokenHash.length, 64);
    assert.equal(createHash("sha256").update(cookie!.value).digest("hex"), (sessionCreate?.data as { tokenHash: string }).tokenHash);
    assert.equal("token" in response, false);
  });

  it("does not allow an unverified user to sign in", async () => {
    const previousVerificationSetting = process.env.REQUIRE_EMAIL_VERIFICATION;
    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    const controller = new AuthController({
      user: {
        findUnique: async () => ({
          id: "user-a",
          email: "maya@example.com",
          name: "Maya Chen",
          passwordHash: hashPassword("password123"),
          status: "ACTIVE",
          emailVerifiedAt: null,
          memberships: [],
        }),
      },
    } as never, {} as never);
    await assert.rejects(
      controller.login(
        { email: "maya@example.com", password: "password123" },
        { cookie: () => undefined, clearCookie: () => undefined },
      ),
      ForbiddenException,
    );
    if (previousVerificationSetting === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
    else process.env.REQUIRE_EMAIL_VERIFICATION = previousVerificationSetting;
  });

  it("marks demo accounts verified without sending verification email when verification is disabled", async () => {
    const previousVerificationSetting = process.env.REQUIRE_EMAIL_VERIFICATION;
    process.env.REQUIRE_EMAIL_VERIFICATION = "false";
    let userData: Record<string, unknown> | undefined;
    let emailTokenWrites = 0;
    const controller = new AuthController({
      user: { create: async (args: { data: Record<string, unknown> }) => { userData = args.data; return { id: "user-a", email: "maya@example.com", memberships: [{ organization: { id: "org-a", name: "Northwind" }, role: "OWNER" }] }; } },
      emailToken: { create: async () => { emailTokenWrites += 1; }, updateMany: async () => ({ count: 0 }) },
    } as never, { send: async () => { emailTokenWrites += 1; } } as never);

    const result = await controller.signup({ name: "Maya Chen", email: "maya@example.com", password: "password123", organizationName: "Northwind" });

    assert.equal(result.verificationRequired, false);
    assert.ok(userData?.emailVerifiedAt instanceof Date);
    assert.equal(emailTokenWrites, 0);
    if (previousVerificationSetting === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
    else process.env.REQUIRE_EMAIL_VERIFICATION = previousVerificationSetting;
  });

  it("returns the same password-reset request message for an unknown account", async () => {
    let where: Record<string, unknown> | undefined;
    const controller = new AuthController({
      user: { findUnique: async (args: { where: Record<string, unknown> }) => { where = args.where; return null; } },
    } as never, {} as never);
    const response = await controller.requestPasswordReset({ email: "UNKNOWN@Example.com" });
    assert.deepEqual(where, { email: "unknown@example.com" });
    assert.match(response.message, /If the account is eligible/);
  });

  it("consumes a password-reset token, changes the password, and revokes existing sessions", async () => {
    let updatedPassword = "";
    let sessionRevocations = 0;
    let consumed = 0;
    const transaction = {
      emailToken: { updateMany: async () => { consumed += 1; return { count: 1 }; } },
      user: { update: async (args: { data: { passwordHash: string } }) => { updatedPassword = args.data.passwordHash; } },
      session: { updateMany: async () => { sessionRevocations += 1; return { count: 2 }; } },
    };
    const controller = new AuthController({
      emailToken: { findFirst: async () => ({ id: "token-a", userId: "user-a" }) },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never, {} as never);

    await controller.confirmPasswordReset({ token: "reset-token", password: "new-password123" });
    assert.match(updatedPassword, /^scrypt\$/);
    assert.equal(sessionRevocations, 1);
    assert.equal(consumed, 2);
  });

  it("rejects a token that was concurrently consumed before password reset", async () => {
    const controller = new AuthController({
      emailToken: { findFirst: async () => ({ id: "token-a", userId: "user-a" }) },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
        emailToken: { updateMany: async () => ({ count: 0 }) },
        user: { update: async () => assert.fail("password must not be changed") },
        session: { updateMany: async () => assert.fail("sessions must not be changed") },
      }),
    } as never, {} as never);

    await assert.rejects(controller.confirmPasswordReset({ token: "reset-token", password: "new-password123" }));
  });
});
