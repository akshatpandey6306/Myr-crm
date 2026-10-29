import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { PipelinesController } from "../src/pipelines/pipelines.controller.js";

const request = (role: "owner" | "sales_rep" = "owner") => ({
  userId: "user-a",
  orgId: "org-a",
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/pipelines",
});

describe("PipelinesController", () => {
  it("lists only pipelines in the verified organization with ordered stages", async () => {
    let args: Record<string, unknown> | undefined;
    const pipeline = { id: "pipeline-a", name: "Sales", isDefault: true, stages: [{ id: "stage-a", name: "Discovery", position: 0 }] };
    const prisma = { pipeline: { findMany: async (value: Record<string, unknown>) => { args = value; return [pipeline]; } } };
    const controller = new PipelinesController(prisma as never);
    const result = await controller.list(request());

    assert.deepEqual(args?.where, { organizationId: "org-a" });
    assert.deepEqual(result.data[0], pipeline);
  });

  it("prevents sales representatives from changing pipeline configuration", async () => {
    const controller = new PipelinesController({ pipeline: {} } as never);
    await assert.rejects(controller.create(request("sales_rep"), { name: "Renewals" }), ForbiddenException);
  });

  it("adds a stage only to a pipeline in the verified organization", async () => {
    let args: Record<string, unknown> | undefined;
    const prisma = {
      pipeline: { findFirst: async () => ({ id: "pipeline-a" }) },
      pipelineStage: {
        findFirst: async () => ({ position: 3 }),
        create: async (value: Record<string, unknown>) => { args = value; return { id: "stage-b", name: "Legal review", position: 4 }; },
      },
    };
    const controller = new PipelinesController(prisma as never);
    const result = await controller.addStage(request(), "pipeline-a", { name: "Legal review" });

    assert.deepEqual(args?.data, { organizationId: "org-a", pipelineId: "pipeline-a", name: "Legal review", position: 4 });
    assert.equal(result.data.name, "Legal review");
  });
});
