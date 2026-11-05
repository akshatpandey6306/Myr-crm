import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { PlatformAdminGuard } from "../src/auth/platform-admin.guard.js";

const originalAdminEmails = process.env.PLATFORM_ADMIN_EMAILS;

afterEach(() => {
  if (originalAdminEmails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = originalAdminEmails;
});

function makeContext(request: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

describe("PlatformAdminGuard", () => {
  it("allows an active user whose email is configured as a platform admin", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = " admin@myrcrm.com, other@myrcrm.com ";
    const guard = new PlatformAdminGuard({
      user: { findUnique: async () => ({ email: "ADMIN@myrcrm.com", status: "ACTIVE" }) },
    } as never);

    assert.equal(await guard.canActivate(makeContext({ userId: "user-a" }) as never), true);
  });

  it("rejects users not on the configured platform admin allowlist", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@myrcrm.com";
    const guard = new PlatformAdminGuard({
      user: { findUnique: async () => ({ email: "customer@example.com", status: "ACTIVE" }) },
    } as never);

    await assert.rejects(guard.canActivate(makeContext({ userId: "user-a" }) as never), ForbiddenException);
  });

  it("fails closed when the platform admin allowlist is empty", async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    const guard = new PlatformAdminGuard({} as never);

    await assert.rejects(guard.canActivate(makeContext({ userId: "user-a" }) as never), ForbiddenException);
  });
});
