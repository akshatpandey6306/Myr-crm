import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { PlatformAdminGuard } from "../src/auth/platform-admin.guard.js";

const originalAdminEmails = process.env.PLATFORM_ADMIN_EMAILS;
const originalAdminEmail = process.env.PLATFORM_ADMIN_EMAIL;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalAdminEmails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = originalAdminEmails;
  if (originalAdminEmail === undefined) delete process.env.PLATFORM_ADMIN_EMAIL;
  else process.env.PLATFORM_ADMIN_EMAIL = originalAdminEmail;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

function makeContext(request: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

describe("PlatformAdminGuard", () => {
  it("allows the one active account configured as platform admin", async () => {
    process.env.PLATFORM_ADMIN_EMAIL = " admin@myrcrm.com ";
    delete process.env.PLATFORM_ADMIN_EMAILS;
    const guard = new PlatformAdminGuard({
      user: { findUnique: async () => ({ email: "ADMIN@myrcrm.com", status: "ACTIVE" }) },
    } as never);

    assert.equal(await guard.canActivate(makeContext({ userId: "user-a" }) as never), true);
  });

  it("rejects a configuration that grants platform access to multiple accounts", async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    process.env.PLATFORM_ADMIN_EMAILS = "admin@myrcrm.com,other@myrcrm.com";
    const guard = new PlatformAdminGuard({
      user: { findUnique: async () => ({ email: "admin@myrcrm.com", status: "ACTIVE" }) },
    } as never);

    await assert.rejects(guard.canActivate(makeContext({ userId: "user-a" }) as never), (error: unknown) =>
      typeof error === "object" && error !== null && "response" in error &&
      (error.response as { code?: string }).code === "platform_admin_misconfigured",
    );
  });

  it("rejects users not on the configured platform admin allowlist", async () => {
    process.env.PLATFORM_ADMIN_EMAIL = "admin@myrcrm.com";
    delete process.env.PLATFORM_ADMIN_EMAILS;
    const guard = new PlatformAdminGuard({
      user: { findUnique: async () => ({ email: "customer@example.com", status: "ACTIVE" }) },
    } as never);

    await assert.rejects(guard.canActivate(makeContext({ userId: "user-a" }) as never), ForbiddenException);
  });

  it("fails closed when the platform admin allowlist is empty", async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    process.env.NODE_ENV = "production";
    const guard = new PlatformAdminGuard({} as never);

    await assert.rejects(guard.canActivate(makeContext({ userId: "user-a" }) as never), ForbiddenException);
  });

  it("allows the seeded development admin when no allowlist is configured", async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    process.env.NODE_ENV = "development";
    const guard = new PlatformAdminGuard({
      user: { findUnique: async () => ({ email: "admin@myrcrm.local", status: "ACTIVE" }) },
    } as never);

    assert.equal(await guard.canActivate(makeContext({ userId: "user-a" }) as never), true);
  });
});
