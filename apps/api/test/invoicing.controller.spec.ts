import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { InvoicingController } from "../src/invoicing/invoicing.controller.js";

type Mock = (...args: any[]) => Promise<any>;
type FakePrisma = {
  [model: string]: any;
  $transaction: (callback: (transaction: FakePrisma) => Promise<unknown>) => Promise<unknown>;
};

const request = (role: "owner" | "sales_rep" = "owner") => ({
  userId: "user-a",
  orgId: "org-a",
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/invoicing",
});

const decimal = (value: string) => value;

function settings() {
  return {
    organizationId: "org-a",
    currency: "USD",
    currencyPrecision: 2,
    countryCode: "US",
    taxSystem: "GENERIC",
    defaultTaxRate: decimal("0.0000"),
    defaultDueDays: 30,
    defaultTerms: "Payment due within 30 days",
    invoicePrefix: "INV",
    quotePrefix: "QUO",
    receiptPrefix: "REC",
    invoiceNextNumber: 1,
    quoteNextNumber: 1,
    receiptNextNumber: 1,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice-a",
    invoiceNumber: null,
    customerType: "CUSTOM",
    customerName: "Acme",
    customerEmail: "billing@acme.test",
    customerPhone: null,
    invoiceDate: new Date("2026-01-01T00:00:00.000Z"),
    dueDate: new Date("2026-12-01T00:00:00.000Z"),
    currency: "USD",
    status: "DRAFT",
    paymentStatus: "UNPAID",
    subtotal: decimal("100.0000"),
    discountAmount: decimal("0.0000"),
    taxAmount: decimal("0.0000"),
    additionalCharges: decimal("0.0000"),
    shippingAmount: decimal("0.0000"),
    roundOff: decimal("0.0000"),
    grandTotal: decimal("100.0000"),
    amountPaid: decimal("0.0000"),
    balanceDue: decimal("100.0000"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    items: [],
    payments: [],
    contactId: null,
    companyId: null,
    billingAddress: null,
    shippingAddress: null,
    placeOfSupply: null,
    purchaseOrderNumber: null,
    referenceNumber: null,
    discountType: "FIXED",
    discountValue: decimal("0.0000"),
    notes: null,
    internalNotes: null,
    terms: null,
    ...overrides,
  };
}

function invoiceItem() {
  return {
    id: "item-a",
    itemName: "Consulting",
    description: null,
    sku: null,
    hsnSacCode: null,
    quantity: decimal("1.0000"),
    unit: "unit",
    unitPrice: decimal("100.0000"),
    discountAmount: decimal("0.0000"),
    discountType: "FIXED",
    discountValue: decimal("0.0000"),
    invoiceDiscountAllocation: decimal("0.0000"),
    taxRate: decimal("0.0000"),
    taxAmount: decimal("0.0000"),
    lineTotal: decimal("100.0000"),
    position: 0,
  };
}

function quotation(overrides: Record<string, unknown> = {}) {
  return {
    id: "quotation-a",
    quotationNumber: null,
    customerType: "CUSTOM",
    customerName: "Acme",
    customerEmail: "billing@acme.test",
    customerPhone: null,
    validUntil: null,
    currency: "USD",
    status: "DRAFT",
    subtotal: decimal("100.0000"),
    discountAmount: decimal("0.0000"),
    taxAmount: decimal("0.0000"),
    grandTotal: decimal("100.0000"),
    convertedInvoiceId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    createdByUserId: "user-a",
    customerId: null,
    contactId: null,
    companyId: null,
    billingAddress: null,
    shippingAddress: null,
    discountType: "FIXED",
    discountValue: decimal("0.0000"),
    notes: null,
    terms: null,
    items: [],
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-a",
    name: "Consulting",
    sku: "CONSULT",
    description: null,
    category: "Services",
    unit: "hour",
    sellingPrice: decimal("100.0000"),
    purchasePrice: null,
    taxRate: decimal("0.0000"),
    hsnSacCode: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-a",
    paymentNumber: "PAY-2026-0001",
    amount: decimal("100.0000"),
    paymentDate: new Date("2026-01-02T00:00:00.000Z"),
    method: "CASH",
    transactionReference: null,
    receipt: {
      id: "receipt-a",
      receiptNumber: "REC-2026-0001",
      previousBalance: decimal("100.0000"),
      remainingBalance: decimal("0.0000"),
    },
    invoice: { invoiceNumber: "INV-2026-0001" },
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "receipt-a",
    receiptNumber: "REC-2026-0001",
    customerName: "Acme",
    invoiceNumber: "INV-2026-0001",
    amount: decimal("100.0000"),
    paymentDate: new Date("2026-01-02T00:00:00.000Z"),
    paymentMethod: "CASH",
    transactionReference: null,
    previousBalance: decimal("100.0000"),
    remainingBalance: decimal("0.0000"),
    payment: { notes: null, invoice: { currency: "USD" } },
    ...overrides,
  };
}

function createPrisma(overrides: Record<string, Record<string, Mock>> = {}): FakePrisma {
  const prisma: FakePrisma = {
    organizationSettings: { findUnique: async () => ({ currency: "USD" }) },
    billingSettings: {
      findUnique: async () => settings(),
      upsert: async () => settings(),
      update: async () => ({}),
    },
    contact: { findFirst: async () => null, findMany: async () => [] },
    company: { findFirst: async () => null, findMany: async () => [] },
    billingProduct: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => product(),
      updateMany: async () => ({ count: 1 }),
    },
    billingInvoice: {
      aggregate: async () => ({ _sum: { grandTotal: "0", amountPaid: "0", balanceDue: "0" }, _count: { _all: 0 } }),
      count: async () => 0,
      findFirst: async () => invoice(),
      findMany: async () => [],
      create: async () => invoice(),
      updateMany: async () => ({ count: 1 }),
    },
    billingInvoiceItem: { createMany: async () => ({}), deleteMany: async () => ({ count: 0 }) },
    billingPayment: {
      aggregate: async () => ({ _sum: { amount: "0" } }),
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => payment(),
    },
    billingReceipt: { findMany: async () => [], create: async () => receipt() },
    billingQuotation: {
      count: async () => 0,
      findFirst: async () => quotation(),
      findMany: async () => [],
      create: async () => quotation(),
      updateMany: async () => ({ count: 1 }),
    },
    billingQuotationItem: { createMany: async () => ({}) },
    billingAuditEvent: { create: async () => ({}) },
    $transaction: async (callback) => callback(prisma),
  };
  for (const [model, methods] of Object.entries(overrides)) Object.assign(prisma[model], methods);
  return prisma;
}

const controller = (prisma: FakePrisma) => new InvoicingController(prisma as never);

describe("InvoicingController", () => {
  it("gets billing settings and returns normalized currency values", async () => {
    const result = await controller(createPrisma()).getSettings(request() as never);
    assert.equal(result.data.currency, "USD");
    assert.equal(result.data.defaultTaxRate, "0.0000");
  });

  it("updates settings for managers and rejects read-only users", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingSettings: { update: async (args) => { updateArgs = args; return {}; } },
    });
    const api = controller(prisma);

    await api.updateSettings(request() as never, { invoicePrefix: "NEW", defaultDueDays: 14 });
    assert.deepEqual(updateArgs?.data, { invoicePrefix: "NEW", defaultDueDays: 14 });
    await assert.rejects(api.updateSettings({ ...request(), organizationRole: "read_only" } as never, {}), ForbiddenException);
    await assert.rejects(api.updateSettings(request() as never, { invoicePrefix: "" }), BadRequestException);
  });

  it("keeps all billing dashboard records within a sales representative's ownership", async () => {
    let invoiceWhere: Record<string, unknown> | undefined;
    let paymentWhere: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingInvoice: {
        findMany: async ({ where }) => { invoiceWhere = where; return []; },
      },
      billingPayment: {
        findMany: async ({ where }) => { paymentWhere = where; return []; },
      },
    });

    await controller(prisma).dashboard(request("sales_rep") as never);

    assert.deepEqual(invoiceWhere, { organizationId: "org-a", status: "ISSUED", ownerUserId: "user-a" });
    assert.deepEqual(paymentWhere, { organizationId: "org-a", invoice: { ownerUserId: "user-a" } });
  });

  it("lists billing customers within workspace and representative ownership", async () => {
    const filters: Record<string, unknown>[] = [];
    const prisma = createPrisma({
      contact: { findMany: async ({ where }) => { filters.push(where); return []; } },
      company: { findMany: async ({ where }) => { filters.push(where); return []; } },
    });

    await controller(prisma).listBillingCustomers(request("sales_rep") as never, "Acme");

    assert.equal(filters.length, 2);
    assert.ok(filters.every((where) => where.organizationId === "org-a" && where.ownerUserId === "user-a"));
  });

  it("lists products, creates one with a default unit, and updates only the selected workspace product", async () => {
    let createArgs: Record<string, unknown> | undefined;
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingProduct: {
        findFirst: async () => product(),
        findMany: async () => [product()],
        create: async (args) => { createArgs = args; return product({ unit: "unit" }); },
        updateMany: async (args) => { updateArgs = args; return { count: 1 }; },
      },
    });
    const api = controller(prisma);

    const listed = await api.listProducts(request() as never);
    assert.equal(listed.data[0].sellingPrice, "100.0000");
    const created = await api.createProduct(request() as never, { name: "Consulting", sku: "CONSULT", sellingPrice: "100" });
    assert.equal((createArgs?.data as Record<string, unknown>).unit, "unit");
    assert.equal(created.data.unit, "unit");
    await api.updateProduct(request() as never, "product-a", { name: "Advisory" });
    assert.deepEqual(updateArgs?.where, { id: "product-a", organizationId: "org-a" });
  });

  it("lists invoices with pagination, status, and owner filters", async () => {
    let filter: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingInvoice: {
        count: async ({ where }) => { filter = where; return 0; },
        findMany: async ({ where }) => { filter = where; return []; },
      },
    });

    const result = await controller(prisma).listInvoices(request("sales_rep") as never, undefined, "OVERDUE", "2", "10");

    assert.equal(filter?.organizationId, "org-a");
    assert.equal(filter?.ownerUserId, "user-a");
    assert.equal(filter?.status, "ISSUED");
    assert.deepEqual(result.meta, { page: 2, pageSize: 10, total: 0, totalPages: 0 });
  });

  it("gets invoices only for the current workspace and representative", async () => {
    let filter: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingInvoice: {
        findFirst: async ({ where }) => { filter = where; return invoice(); },
      },
    });

    await controller(prisma).getInvoice(request("sales_rep") as never, "invoice-a");

    assert.deepEqual(filter, { id: "invoice-a", organizationId: "org-a", ownerUserId: "user-a" });
  });

  it("creates a draft invoice from validated input and server-controlled tenant data", async () => {
    let createArgs: Record<string, unknown> | undefined;
    let itemArgs: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingInvoice: {
        create: async (args) => { createArgs = args; return { id: "invoice-a" }; },
      },
      billingInvoiceItem: {
        createMany: async (args) => { itemArgs = args; return {}; },
      },
    });

    const result = await controller(prisma).createInvoice(request() as never, {
      customerType: "CUSTOM",
      customerName: "Acme",
      items: [{ itemName: "Consulting", quantity: "1", unitPrice: "100" }],
      organizationId: "org-b",
      ownerUserId: "user-b",
    });

    const data = createArgs?.data as Record<string, unknown>;
    assert.equal(data.organizationId, "org-a");
    assert.equal(data.ownerUserId, "user-a");
    assert.equal(data.status, "DRAFT");
    assert.equal(data.grandTotal, "100.0000");
    assert.equal((itemArgs?.data as Record<string, unknown>[])[0]?.invoiceId, "invoice-a");
    assert.equal(result.data.id, "invoice-a");
  });

  it("updates only an owned draft and replaces its line items", async () => {
    const queries: Record<string, unknown>[] = [];
    let deleted: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingInvoice: {
        findFirst: async ({ where }) => { queries.push(where); return invoice(); },
      },
      billingInvoiceItem: {
        deleteMany: async ({ where }) => { deleted = where; return { count: 1 }; },
      },
    });

    await controller(prisma).updateInvoice(request("sales_rep") as never, "invoice-a", {
      customerName: "Acme",
      items: [{ itemName: "Consulting", quantity: "1", unitPrice: "100" }],
    });

    assert.deepEqual(queries[0], { id: "invoice-a", organizationId: "org-a", status: "DRAFT", ownerUserId: "user-a" });
    assert.deepEqual(deleted, { organizationId: "org-a", invoiceId: "invoice-a" });
  });

  it("rejects a draft edit if its state changes before the update commits", async () => {
    let itemsDeleted = false;
    const prisma = createPrisma({
      billingInvoice: { updateMany: async () => ({ count: 0 }) },
      billingInvoiceItem: {
        deleteMany: async () => { itemsDeleted = true; return { count: 1 }; },
      },
    });

    await assert.rejects(
      controller(prisma).updateInvoice(request() as never, "invoice-a", {
        customerName: "Acme",
        items: [{ itemName: "Consulting", quantity: "1", unitPrice: "100" }],
      }),
      ConflictException,
    );
    assert.equal(itemsDeleted, false);
  });

  it("issues non-empty drafts and reserves an invoice number atomically", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingInvoice: {
        findFirst: async () => invoice({ items: [invoiceItem()] }),
        updateMany: async (args) => { updateArgs = args; return { count: 1 }; },
      },
      billingSettings: {
        upsert: async () => ({ invoicePrefix: "INV", invoiceNextNumber: 2 }),
      },
    });

    await controller(prisma).issueInvoice(request() as never, "invoice-a");

    assert.deepEqual(updateArgs?.where, { id: "invoice-a", organizationId: "org-a", status: "DRAFT", invoiceNumber: null });
    assert.equal((updateArgs?.data as Record<string, unknown>).status, "ISSUED");
    assert.equal((updateArgs?.data as Record<string, unknown>).invoiceNumber, "INV-2026-0001");
    const emptyDraft = createPrisma({
      billingInvoice: { findFirst: async () => invoice({ grandTotal: decimal("0.0000") }) },
    });
    await assert.rejects(controller(emptyDraft).issueInvoice(request() as never, "invoice-empty"), BadRequestException);
  });

  it("cancels unpaid invoices with an audit event and rejects missing invoices", async () => {
    let audit: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingAuditEvent: { create: async ({ data }) => { audit = data; return {}; } },
    });

    const result = await controller(prisma).cancelInvoice(request() as never, "invoice-a", { reason: "Duplicate" });
    assert.deepEqual(result, { ok: true });
    assert.equal(audit?.action, "cancelled");
    await assert.rejects(controller(createPrisma({
      billingInvoice: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async () => null,
      },
    })).cancelInvoice(request() as never, "missing", {}), NotFoundException);
  });

  it("records a payment, updates the balance, and creates a receipt", async () => {
    let invoiceUpdate: Record<string, unknown> | undefined;
    let paymentCreate: Record<string, unknown> | undefined;
    let receiptCreate: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingInvoice: {
        findFirst: async () => invoice({ status: "ISSUED", invoiceNumber: "INV-2026-0001" }),
        updateMany: async (args) => { invoiceUpdate = args; return { count: 1 }; },
      },
      billingPayment: {
        findFirst: async () => null,
        create: async (args) => { paymentCreate = args; return payment(); },
      },
      billingReceipt: {
        create: async (args) => { receiptCreate = args; return receipt(); },
      },
      billingSettings: {
        upsert: async () => ({ receiptPrefix: "REC", receiptNextNumber: 2 }),
      },
    });

    const result = await controller(prisma).recordPayment({
      ...request(),
      headers: { "idempotency-key": "payment-once" },
    } as never, "invoice-a", { amount: "100", method: "cash" });

    assert.equal((invoiceUpdate?.data as Record<string, unknown>).paymentStatus, "PAID");
    assert.equal((paymentCreate?.data as Record<string, unknown>).idempotencyKey, "payment-once");
    assert.equal((receiptCreate?.data as Record<string, unknown>).invoiceNumber, "INV-2026-0001");
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.receipt.receiptNumber, "REC-2026-0001");
  });

  it("rejects invalid payment data and enforces payment idempotency", async () => {
    const api = controller(createPrisma());
    await assert.rejects(api.recordPayment(request() as never, "invoice-a", { amount: "0", method: "cash" }), BadRequestException);
    await assert.rejects(api.recordPayment(request() as never, "invoice-a", { amount: "10", method: "cash" }), BadRequestException);
    await assert.rejects(
      controller(createPrisma({
        billingPayment: { findFirst: async () => payment({ invoiceId: "invoice-b" }) },
      })).recordPayment({ ...request(), headers: { "idempotency-key": "used" } } as never, "invoice-a", { amount: "100", method: "cash" }),
      ConflictException,
    );
  });

  it("lists payments and receipts scoped to sales-rep-owned invoices", async () => {
    let paymentWhere: Record<string, unknown> | undefined;
    let receiptWhere: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingPayment: { findMany: async ({ where }) => { paymentWhere = where; return []; } },
      billingReceipt: { findMany: async ({ where }) => { receiptWhere = where; return []; } },
    });
    const api = controller(prisma);

    await api.listPayments(request("sales_rep") as never);
    await api.listReceipts(request("sales_rep") as never);

    assert.deepEqual(paymentWhere, { organizationId: "org-a", invoice: { ownerUserId: "user-a" } });
    assert.deepEqual(receiptWhere, { organizationId: "org-a", payment: { invoice: { ownerUserId: "user-a" } } });
  });

  it("lists quotations with ownership and pagination filters", async () => {
    let filter: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingQuotation: {
        count: async ({ where }) => { filter = where; return 0; },
        findMany: async ({ where }) => { filter = where; return []; },
      },
    });

    const result = await controller(prisma).listQuotations(request("sales_rep") as never, undefined, "SENT", "3", "5");

    assert.equal(filter?.organizationId, "org-a");
    assert.equal(filter?.createdByUserId, "user-a");
    assert.equal(filter?.status, "SENT");
    assert.deepEqual(result.meta, { page: 3, pageSize: 5, total: 0, totalPages: 0 });
  });

  it("creates a draft quotation and assigns its creator from the authenticated request", async () => {
    let createArgs: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingQuotation: {
        create: async (args) => { createArgs = args; return { id: "quotation-a" }; },
      },
    });

    const result = await controller(prisma).createQuotation(request() as never, {
      customerType: "CUSTOM",
      customerName: "Acme",
      items: [{ itemName: "Consulting", quantity: "1", unitPrice: "100" }],
      createdByUserId: "user-b",
    });

    assert.equal((createArgs?.data as Record<string, unknown>).createdByUserId, "user-a");
    assert.equal((createArgs?.data as Record<string, unknown>).status, "DRAFT");
    assert.equal(result.data.id, "quotation-a");
  });

  it("transitions quotations to sent and rejects invalid state changes", async () => {
    let quoteUpdate: Record<string, unknown> | undefined;
    const prisma = createPrisma({
      billingQuotation: {
        findFirst: async () => quotation(),
        updateMany: async (args) => { quoteUpdate = args; return { count: 1 }; },
      },
      billingSettings: {
        upsert: async () => ({ quotePrefix: "QUO", quoteNextNumber: 2 }),
      },
    });
    const api = controller(prisma);

    await api.updateQuotationStatus(request() as never, "quotation-a", { status: "sent" });
    assert.equal((quoteUpdate?.data as Record<string, unknown>).quotationNumber, "QUO-2026-0001");
    await assert.rejects(api.updateQuotationStatus(request() as never, "quotation-a", { status: "accepted" }), ConflictException);
    await assert.rejects(api.updateQuotationStatus(request() as never, "quotation-a", { status: "unknown" }), BadRequestException);
  });

  it("converts an accepted quotation into a numbered invoice exactly once", async () => {
    let invoiceCreate: Record<string, unknown> | undefined;
    let quotationUpdate: Record<string, unknown> | undefined;
    const accepted = quotation({
      status: "ACCEPTED",
      quotationNumber: "QUO-2026-0001",
      items: [{
        id: "quotation-item-a",
        productId: null,
        itemName: "Consulting",
        description: null,
        sku: null,
        hsnSacCode: null,
        quantity: decimal("1.0000"),
        unit: "hour",
        unitPrice: decimal("100.0000"),
        discountAmount: decimal("0.0000"),
        discountType: "FIXED",
        discountValue: decimal("0.0000"),
        invoiceDiscountAllocation: decimal("0.0000"),
        taxRate: decimal("0.0000"),
        taxAmount: decimal("0.0000"),
        lineTotal: decimal("100.0000"),
        position: 0,
      }],
    });
    const prisma = createPrisma({
      billingQuotation: {
        findFirst: async () => accepted,
        updateMany: async (args) => { quotationUpdate = args; return { count: 1 }; },
      },
      billingInvoice: {
        create: async (args) => { invoiceCreate = args; return { id: "invoice-converted" }; },
        findFirst: async () => invoice({ id: "invoice-converted", status: "ISSUED" }),
      },
      billingSettings: {
        upsert: async () => ({ invoicePrefix: "INV", invoiceNextNumber: 2, defaultDueDays: 30, defaultTerms: "Terms" }),
      },
    });

    const result = await controller(prisma).convertQuotation(request() as never, "quotation-a");

    assert.equal((invoiceCreate?.data as Record<string, unknown>).invoiceNumber, "INV-2026-0001");
    assert.equal((invoiceCreate?.data as Record<string, unknown>).status, "ISSUED");
    assert.equal((quotationUpdate?.data as Record<string, unknown>).status, "CONVERTED");
    assert.equal(result.data.id, "invoice-converted");
  });
});
