import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DealsController } from "../src/deals/deals.controller.js";

const request = (role: "owner" | "sales_rep" = "owner") => ({
  userId: "user-a",
  orgId: "org-a",
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/deals",
});

const dealRecord = {
  id: "deal-a",
  name: "Enterprise plan",
  value: { toString: () => "24000.00" },
  closeDate: new Date("2026-11-14T00:00:00.000Z"),
  status: "OPEN",
  company: { id: "company-a", name: "Northstar Labs" },
  pipeline: { id: "pipeline-a", name: "Sales pipeline" },
  stage: { id: "stage-a", name: "Discovery", position: 0 },
  createdAt: new Date(),
  updatedAt: new Date(),
  owner: { user: { name: "Maya Chen" } },
};

describe("DealsController", () => {
  it("scopes deal lists and representative access to the verified organization and owner", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      deal: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 1; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return [dealRecord]; },
      },
    };
    const controller = new DealsController(prisma as never);
    const result = await controller.list(request("sales_rep"), "Enterprise", "pipeline-a", "open", "1", "10");

    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.ownerUserId, "user-a");
    assert.equal(where?.pipelineId, "pipeline-a");
    assert.equal(where?.archivedAt, null);
    assert.equal(result.meta.total, 1);
    assert.equal(result.data[0]?.value, "24000.00");
    assert.equal(result.data[0]?.status, "open");
  });

  it("creates deals using verified identity and same-organization company and stage", async () => {
    let args: Record<string, unknown> | undefined;
    const prisma = {
      pipeline: { findFirst: async () => ({ id: "pipeline-a" }) },
      pipelineStage: { findFirst: async () => ({ id: "stage-a" }) },
      company: { findFirst: async () => ({ id: "company-a" }) },
      deal: { create: async (value: Record<string, unknown>) => { args = value; return dealRecord; } },
    };
    const controller = new DealsController(prisma as never);
    await controller.create(request(), {
      name: " Enterprise plan ",
      value: "24000",
      closeDate: "2026-11-14",
      pipelineId: "pipeline-a",
      stageId: "stage-a",
      companyId: "company-a",
      organizationId: "org-b",
      ownerUserId: "user-b",
      createdByUserId: "user-b",
    });

    const data = args?.data as Record<string, unknown>;
    assert.equal(data.organizationId, "org-a");
    assert.equal(data.ownerUserId, "user-a");
    assert.equal(data.createdByUserId, "user-a");
    assert.equal(data.companyId, "company-a");
    assert.equal(data.value, "24000.00");
    assert.equal(data.closeDate instanceof Date, true);
  });

  it("rejects a stage that does not belong to the selected tenant pipeline", async () => {
    const prisma = {
      pipeline: { findFirst: async () => ({ id: "pipeline-a" }) },
      pipelineStage: { findFirst: async () => null },
    };
    const controller = new DealsController(prisma as never);
    await assert.rejects(
      controller.create(request(), { name: "Deal", pipelineId: "pipeline-a", stageId: "stage-from-another-pipeline" }),
      BadRequestException,
    );
  });

  it("rejects invalid money amounts and calendar dates", async () => {
    const controller = new DealsController({} as never);
    await assert.rejects(controller.create(request(), { name: "Deal", value: -1 }), BadRequestException);
    await assert.rejects(controller.create(request(), { name: "Deal", closeDate: "2026-02-30" }), BadRequestException);
  });

  it("returns not found when updating a deal outside the verified organization", async () => {
    const prisma = { deal: { findFirst: async () => null } };
    const controller = new DealsController(prisma as never);
    await assert.rejects(controller.update(request(), "deal-b", { name: "Changed" }), NotFoundException);
  });
});
