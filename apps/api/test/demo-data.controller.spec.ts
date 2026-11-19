import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DemoDataService } from "../src/demo-data/demo-data.controller.js";

type Call = { model: string; method: string; args: Record<string, unknown> };
type Response = (args: Record<string, unknown>) => unknown;

function fakePrisma(responses: Record<string, Response> = {}) {
  const calls: Call[] = [];
  const models = new Map<string, object>();
  let prisma: object;
  prisma = new Proxy({}, {
    get: (_target, property) => {
      if (property === "$transaction") return async (callback: (transaction: object) => Promise<unknown>) => callback(prisma);
      if (typeof property !== "string") return undefined;
      let model = models.get(property);
      if (!model) {
        model = new Proxy({}, {
          get: (_model, method) => {
            if (typeof method !== "string") return undefined;
            return async (args: Record<string, unknown> = {}) => {
              calls.push({ model: property, method, args });
              const response = responses[`${property}.${method}`];
              if (response) return response(args);
              if (property === "billingSettings" && method === "upsert") return { currency: "USD" };
              if (method === "findUnique") return { currency: "USD" };
              if (method === "findMany") return [];
              if (method === "count") return 0;
              return { count: 0 };
            };
          },
        });
        models.set(property, model);
      }
      return model;
    },
  });
  return { prisma, calls };
}

function call(calls: Call[], model: string, method: string) {
  const result = calls.find((entry) => entry.model === model && entry.method === method);
  assert.ok(result, `Expected ${model}.${method} to be called`);
  return result.args;
}

describe("DemoDataService billing and vendor samples", () => {
  it("backfills billing and vendor samples for workspaces seeded by the previous version", async () => {
    const { prisma, calls } = fakePrisma({
      "organizationDemoData.findUnique": () => ({ loadedAt: new Date(), clearedAt: null }),
      "billingInvoice.count": () => 0,
    });
    const service = new DemoDataService(prisma as never);

    await service.ensureWorkspaceSamples("org-a", "user-a");

    assert.equal((call(calls, "vendor", "createMany").data as unknown[]).length, 3);
    assert.equal((call(calls, "billingInvoice", "createMany").data as unknown[]).length, 3);
  });

  it("loads sample vendors, products, invoices, quotations, payments, and receipts", async () => {
    const { prisma, calls } = fakePrisma();
    const service = new DemoDataService(prisma as never);

    await service.load("org-a", "user-a");

    assert.equal((call(calls, "vendor", "createMany").data as unknown[]).length, 3);
    assert.equal((call(calls, "billingProduct", "createMany").data as unknown[]).length, 3);
    const invoices = call(calls, "billingInvoice", "createMany").data as Record<string, unknown>[];
    assert.equal(invoices.length, 3);
    assert.equal(invoices[0]?.paymentStatus, "PARTIALLY_PAID");
    assert.equal(invoices[2]?.status, "DRAFT");
    assert.equal((call(calls, "billingQuotation", "createMany").data as unknown[]).length, 1);
    assert.equal((call(calls, "billingPayment", "createMany").data as unknown[]).length, 1);
    assert.equal((call(calls, "billingReceipt", "createMany").data as unknown[]).length, 1);
  });

  it("clears only workspace-scoped demo billing and vendor records", async () => {
    const { prisma, calls } = fakePrisma({
      "billingPayment.findMany": () => [{ id: "payment-a" }],
    });
    const service = new DemoDataService(prisma as never);

    await service.clear("org-a");

    for (const model of ["vendor", "billingProduct", "billingInvoice", "billingQuotation", "billingPayment"]) {
      assert.equal(call(calls, model, "deleteMany").where && (call(calls, model, "deleteMany").where as Record<string, unknown>).organizationId, "org-a");
    }
    const receiptWhere = call(calls, "billingReceipt", "deleteMany").where as Record<string, unknown>;
    assert.equal(receiptWhere.organizationId, "org-a");
    assert.deepEqual((receiptWhere.paymentId as { in: string[] }).in, ["payment-a"]);
  });
});
