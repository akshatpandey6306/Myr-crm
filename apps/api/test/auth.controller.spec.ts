import assert from "node:assert/strict";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { describe, it } from "node:test";
import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { AuthController } from "../src/auth/auth.controller.js";

const emailService = {
  isConfigured: () => false,
  sendSignupOtp: async () => undefined,
};

function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
}

describe("AuthController", () => {
  it("disables public signup when self-service registration is not enabled", async () => {
    const previous = process.env.CRM_SELF_SIGNUP_ENABLED;
    delete process.env.CRM_SELF_SIGNUP_ENABLED;
    try {
      const controller = new AuthController({} as never, emailService as never);
      await assert.rejects(controller.signup({ email: "new@example.com", name: "New Owner", password: "password123", organizationName: "Acme" }), ForbiddenException);
    } finally {
      if (previous === undefined) delete process.env.CRM_SELF_SIGNUP_ENABLED;
      else process.env.CRM_SELF_SIGNUP_ENABLED = previous;
    }
  });

  it("holds a new owner account until its signup OTP is verified", async () => {
    const previous = process.env.CRM_SELF_SIGNUP_ENABLED;
    process.env.CRM_SELF_SIGNUP_ENABLED = "true";
    let userCreate: Record<string, unknown> | undefined;
    let tokenCreate: Record<string, unknown> | undefined;
    let verificationOtp = "";
    let otpRecipient = "";
    let tokenWrites = 0;
    const transaction = {
      emailToken: {
        updateMany: async () => { tokenWrites += 1; return { count: 0 }; },
        create: async (args: Record<string, unknown>) => { tokenCreate = args; tokenWrites += 1; },
      },
    };
    const prisma = {
      user: {
        create: async (args: Record<string, unknown>) => { userCreate = args; return { id: "user-a" }; },
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    };
    const controller = new AuthController(prisma as never, {
      isConfigured: () => true,
      sendSignupOtp: async (otp: string, recipient: string) => { verificationOtp = otp; otpRecipient = recipient; },
    } as never);

    const response = await controller.signup({
      name: "Maya Chen",
      email: "Maya@Example.com",
      password: "password123",
      organizationName: "Northwind",
    });

    type SignupPipeline = { name: string; isDefault: boolean; stages: { create: { name: string; position: number }[] } };
    type SignupOrganization = { create: { name: string; subscriptionStatus: string; pipelines: { create: SignupPipeline } } };
    type SignupMemberships = { create: { role: string; status: string; organization: SignupOrganization } };
    const data = userCreate?.data as {
      email: string;
      status: string;
      memberships: SignupMemberships;
      passwordHash: string;
      emailVerifiedAt?: Date;
    };
    assert.equal(data.email, "maya@example.com");
    assert.equal(data.status, "PENDING");
    assert.equal(data.memberships.create.role, "OWNER");
    assert.equal(data.memberships.create.status, "PENDING");
    assert.equal(data.memberships.create.organization.create.name, "Northwind");
    assert.equal(data.memberships.create.organization.create.subscriptionStatus, "PENDING");
    const pipeline = data.memberships.create.organization.create.pipelines.create;
    assert.equal(pipeline.name, "Sales pipeline");
    assert.equal(pipeline.isDefault, true);
    assert.deepEqual(pipeline.stages.create.map((stage) => stage.name), ["Discovery", "Qualified", "Proposal", "Negotiation"]);
    assert.match(data.passwordHash, /^scrypt\$/);
    assert.equal(data.emailVerifiedAt, undefined);
    assert.equal(response.verificationRequired, true);
    assert.equal(response.approvalRequired, false);
    assert.match(response.message, /verification code/);
    assert.equal(verificationOtp.length, 6);
    assert.equal(tokenWrites, 2);
    assert.equal((tokenCreate?.data as { tokenHash: string }).tokenHash, createHash("sha256").update(verificationOtp).digest("hex"));
    assert.equal(otpRecipient, "maya@example.com");
    assert.match(response.message, /maya@example\.com/);
    if (previous === undefined) delete process.env.CRM_SELF_SIGNUP_ENABLED;
    else process.env.CRM_SELF_SIGNUP_ENABLED = previous;
  });

  it("resends an OTP when a workspace signup is retried for an existing pending owner", async () => {
    const previous = process.env.CRM_SELF_SIGNUP_ENABLED;
    process.env.CRM_SELF_SIGNUP_ENABLED = "true";
    let otpRecipient = "";
    let tokenWrites = 0;
    const prisma = {
      user: {
        create: async () => { throw { code: "P2002" }; },
        findFirst: async () => ({ id: "pending-user", email: "maya@example.com" }),
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
        emailToken: {
          updateMany: async () => { tokenWrites += 1; return { count: 1 }; },
          create: async () => { tokenWrites += 1; },
        },
      }),
    };
    const controller = new AuthController(prisma as never, {
      isConfigured: () => true,
      sendSignupOtp: async (_otp: string, recipient: string) => { otpRecipient = recipient; },
    } as never);

    const response = await controller.signup({
      name: "Maya Chen",
      email: "Maya@Example.com",
      password: "password123",
      organizationName: "Northwind",
    });

    assert.equal(response.approvalRequired, false);
    assert.equal(response.verificationRequired, true);
    assert.match(response.message, /maya@example\.com/);
    assert.equal(otpRecipient, "maya@example.com");
    assert.equal(tokenWrites, 2);
    if (previous === undefined) delete process.env.CRM_SELF_SIGNUP_ENABLED;
    else process.env.CRM_SELF_SIGNUP_ENABLED = previous;
  });

  it("activates the pending owner and membership after consuming a valid signup OTP", async () => {
    let userUpdate: Record<string, unknown> | undefined;
    let membershipUpdate: Record<string, unknown> | undefined;
    let tokenConsumption = 0;
    const transaction = {
      emailToken: { updateMany: async () => { tokenConsumption += 1; return { count: 1 }; } },
      user: { updateMany: async (args: Record<string, unknown>) => { userUpdate = args; return { count: 1 }; } },
      membership: { updateMany: async (args: Record<string, unknown>) => { membershipUpdate = args; return { count: 1 }; } },
    };
    const controller = new AuthController({
      user: { findFirst: async () => ({ id: "user-a" }) },
      emailToken: { findFirst: async () => ({ id: "token-a" }) },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
    } as never, emailService as never);

    const response = await controller.verifySignupOtp({ email: "Maya@Example.com", otp: "123456" });

    assert.deepEqual(userUpdate?.where, { id: "user-a", status: "PENDING" });
    assert.deepEqual(userUpdate?.data, { status: "ACTIVE" });
    assert.deepEqual(membershipUpdate?.where, { userId: "user-a", role: "OWNER", status: "PENDING" });
    assert.deepEqual(membershipUpdate?.data, { status: "ACTIVE" });
    assert.equal(tokenConsumption, 2);
    assert.match(response.message, /active/);
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
          memberships: [{ status: "ACTIVE", organization: { id: "org-a", name: "Northwind" } }],
        }),
      },
      session: { create: async (args: Record<string, unknown>) => { sessionCreate = args; return {}; } },
    };
    const controller = new AuthController(prisma as never, emailService as never);
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

  it("allows an unverified user to sign in when the legacy verification setting is enabled", async () => {
    const previousVerificationSetting = process.env.REQUIRE_EMAIL_VERIFICATION;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    process.env.NODE_ENV = "production";
    let sessionCreated = false;
    let cookieSet = false;
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
      session: { create: async () => { sessionCreated = true; } },
    } as never, emailService as never);
    try {
      const result = await controller.login(
        { email: "maya@example.com", password: "password123" },
        { cookie: () => { cookieSet = true; }, clearCookie: () => undefined },
      );

      assert.equal(result.user.email, "maya@example.com");
      assert.equal(sessionCreated, true);
      assert.equal(cookieSet, true);
    } finally {
      if (previousVerificationSetting === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
      else process.env.REQUIRE_EMAIL_VERIFICATION = previousVerificationSetting;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("explicitly disables password reset while email delivery is off", async () => {
    const controller = new AuthController({} as never, emailService as never);
    assert.throws(() => controller.requestPasswordReset(), ServiceUnavailableException);
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
    } as never, emailService as never);

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
    } as never, emailService as never);

    await assert.rejects(controller.confirmPasswordReset({ token: "reset-token", password: "new-password123" }));
  });
});
