import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { OrgGuard } from "../src/auth/org.guard.js";

function makeContext(request: Record<string, unknown>) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe("OrgGuard", () => {
  it("accepts only an active organization membership and sets the verified scope", async () => {
    const request = {
      headers: { "x-organization-id": "org-a" },
      params: {},
      path: "/api/v1/leads",
      userId: "user-a",
    };
    const prisma = { membership: { findFirst: async () => ({ organizationId: "org-a", role: "SALES_REP" }) } };
    const guard = new OrgGuard(prisma as never);

    assert.equal(await guard.canActivate(makeContext(request) as never), true);
    assert.equal(request.orgId, "org-a");
    assert.equal(request.organizationRole, "sales_rep");
  });

  it("rejects an organization ID that the authenticated user is not a member of", async () => {
    const request = {
      headers: { "x-organization-id": "org-b" },
      params: {},
      path: "/api/v1/leads",
      userId: "user-a",
    };
    const prisma = { membership: { findFirst: async () => null } };
    const guard = new OrgGuard(prisma as never);

    await assert.rejects(guard.canActivate(makeContext(request) as never), NotFoundException);
    assert.equal(request.orgId, undefined);
  });
});
