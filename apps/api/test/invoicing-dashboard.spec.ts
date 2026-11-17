import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoicingController } from "../src/invoicing/invoicing.controller.js";

describe("InvoicingController dashboard", () => {
  it("returns the same per-status invoice counts from one grouped query", async () => {
    const groupByCalls: Array<Record<string, unknown>> = [];
    const prisma = {
      billingInvoice: {
        aggregate: async ({ where }: { where: Record<string, unknown> }) => where.dueDate
          ? { _sum: { balanceDue: null }, _count: { _all: 0 } }
          : { _sum: { grandTotal: null, amountPaid: null, balanceDue: null }, _count: { _all: 13 } },
        groupBy: async (args: Record<string, unknown>) => {
          groupByCalls.push(args);
          return [
            { paymentStatus: "PAID", _count: { _all: 4 } },
            { paymentStatus: "PARTIALLY_PAID", _count: { _all: 2 } },
            { paymentStatus: "UNPAID", _count: { _all: 7 } },
          ];
        },
        count: async () => { throw new Error("Dashboard should not issue individual status count queries"); },
        findMany: async () => [],
      },
      billingPayment: {
        findMany: async () => [],
        aggregate: async () => ({ _sum: { amount: null } }),
      },
      billingSettings: { findUnique: async () => ({ currency: "INR" }) },
    };
    const controller = new InvoicingController(prisma as never);
    (controller as unknown as { ensureSettings: () => Promise<void> }).ensureSettings = async () => undefined;

    const result = await controller.dashboard({ orgId: "org-a", userId: "user-a", organizationRole: "owner" } as never);
    const data = (result as { data: Record<string, unknown> }).data;

    assert.equal(data.paidCount, 4);
    assert.equal(data.partiallyPaidCount, 2);
    assert.equal(data.unpaidCount, 7);
    assert.equal(data.invoices, 13);
    assert.equal(groupByCalls.length, 1);
    assert.deepEqual(groupByCalls[0]?.by, ["paymentStatus"]);
    assert.deepEqual(groupByCalls[0]?.where, { organizationId: "org-a", status: "ISSUED" });
  });
});
