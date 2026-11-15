import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { ProvisioningController } from "../src/provisioning/provisioning.controller.js";

describe("ProvisioningController", () => {
  it("requires the configured service credential before touching persistence", async () => {
    const prior = process.env.CRM_PROVISIONING_TOKEN;
    process.env.CRM_PROVISIONING_TOKEN = "a-long-test-secret";
    const controller = new ProvisioningController({} as never, {} as never);
    await assert.rejects(() => controller.status(undefined, "request-1"), UnauthorizedException);
    if (prior === undefined) delete process.env.CRM_PROVISIONING_TOKEN;
    else process.env.CRM_PROVISIONING_TOKEN = prior;
  });

  it("returns a stored result for an exact idempotent replay without creating another workspace", async () => {
    const existing = { requestId: "prov-1", idempotencyKey: "order-1-crm", orderId: "order-1", status: "SUCCEEDED", organizationId: "org-1", ownerUserId: "user-1", planCode: "growth" };
    let createCalled = false;
    const controller = new ProvisioningController({
      provisioningRequest: { findFirst: async () => existing },
      $transaction: async () => { createCalled = true; },
    } as never, {} as never);
    const prior = process.env.CRM_PROVISIONING_TOKEN;
    process.env.CRM_PROVISIONING_TOKEN = "a-long-test-secret";
    try {
      const result = await controller.provision("Bearer a-long-test-secret", "order-1-crm", {
        requestId: "prov-1", orderId: "order-1", product: "crm",
        plan: { code: "growth" }, organization: { name: "Acme" }, owner: { name: "Owner", email: "owner@example.com" },
      });
      assert.equal(result.status, "SUCCEEDED");
      assert.equal(result.tenant?.id, "org-1");
      assert.equal(createCalled, false);
    } finally {
      if (prior === undefined) delete process.env.CRM_PROVISIONING_TOKEN;
      else process.env.CRM_PROVISIONING_TOKEN = prior;
    }
  });
});
