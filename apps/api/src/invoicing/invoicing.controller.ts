import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { BillingCustomerType, BillingDiscountType, BillingPaymentMethod, BillingQuotationStatus, Prisma } from "../../generated/prisma/client.js";
import { assignedOwnerFilter, requireRecordWrite } from "../auth/record-permissions.js";
import type { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  BillingCalculationError,
  calculateBillingTotals,
  formatBillingAmount,
  parseBillingAmount,
  type BillingCalculationResult,
  type BillingLineInput,
} from "./billing-calculations.js";

type JsonRecord = Record<string, unknown>;
type BillingTransaction = Prisma.TransactionClient;
type DocumentKind = "invoice" | "quotation";
type ProductData = Partial<{
  name: string;
  sku: string;
  description: string | null;
  category: string | null;
  unit: string;
  sellingPrice: string;
  purchasePrice: string | null;
  taxRate: string;
  hsnSacCode: string | null;
  isActive: boolean;
}>;
type NewProductData = ProductData & { name: string; sku: string; sellingPrice: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const paymentMethods = new Set(["CASH", "UPI", "BANK_TRANSFER", "CARD", "CHEQUE", "PAYMENT_GATEWAY", "OTHER"]);
const taxSystems = new Set(["GENERIC", "INDIA_GST"]);
const discountTypes = new Set(["FIXED", "PERCENTAGE"]);
const managerRoles = new Set(["owner", "admin", "sales_manager"]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prismaCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function nullableText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new BadRequestException({ code: "validation_error", message: `${field} must be at most ${maxLength} characters` });
  }
  return value.trim() || null;
}

function parseDate(value: unknown, field: string, fallback?: Date): Date {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({ code: "validation_error", message: `${field} must be a date in YYYY-MM-DD format` });
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || dateOnly(parsed) !== value) {
    throw new BadRequestException({ code: "validation_error", message: `${field} is not a valid date` });
  }
  return parsed;
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toApiInvoice(invoice: {
  id: string;
  invoiceNumber: string | null;
  customerType: BillingCustomerType;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  invoiceDate: Date;
  dueDate: Date;
  currency: string;
  status: string;
  paymentStatus: string;
  subtotal: { toString(): string };
  discountAmount: { toString(): string };
  taxAmount: { toString(): string };
  additionalCharges: { toString(): string };
  shippingAmount: { toString(): string };
  roundOff: { toString(): string };
  grandTotal: { toString(): string };
  amountPaid: { toString(): string };
  balanceDue: { toString(): string };
  createdAt: Date;
  items?: Array<{
    id: string;
    itemName: string;
    description: string | null;
    sku: string | null;
    hsnSacCode: string | null;
    quantity: { toString(): string };
    unit: string;
    unitPrice: { toString(): string };
    discountAmount: { toString(): string };
    discountType: BillingDiscountType;
    discountValue: { toString(): string };
    invoiceDiscountAllocation: { toString(): string };
    taxRate: { toString(): string };
    taxAmount: { toString(): string };
    lineTotal: { toString(): string };
    position: number;
  }>;
  payments?: Array<{
    id: string;
    paymentNumber: string;
    amount: { toString(): string };
    paymentDate: Date;
    method: BillingPaymentMethod;
    transactionReference: string | null;
    receipt?: { id: string; receiptNumber: string } | null;
  }>;
}) {
  const balanceDue = invoice.balanceDue.toString();
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerType: invoice.customerType.toLowerCase(),
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    customerPhone: invoice.customerPhone,
    invoiceDate: dateOnly(invoice.invoiceDate),
    dueDate: dateOnly(invoice.dueDate),
    currency: invoice.currency.trim(),
    status: invoice.status.toLowerCase(),
    paymentStatus: invoice.paymentStatus.toLowerCase(),
    isOverdue: invoice.status === "ISSUED" && invoice.dueDate < todayUtc() && parseBillingAmount(balanceDue) > 0n,
    subtotal: invoice.subtotal.toString(),
    discountAmount: invoice.discountAmount.toString(),
    taxAmount: invoice.taxAmount.toString(),
    additionalCharges: invoice.additionalCharges.toString(),
    shippingAmount: invoice.shippingAmount.toString(),
    roundOff: invoice.roundOff.toString(),
    grandTotal: invoice.grandTotal.toString(),
    amountPaid: invoice.amountPaid.toString(),
    balanceDue,
    createdAt: invoice.createdAt.toISOString(),
    items: invoice.items?.map((item) => ({
      id: item.id,
      itemName: item.itemName,
      description: item.description,
      sku: item.sku,
      hsnSacCode: item.hsnSacCode,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice.toString(),
      discountAmount: item.discountAmount.toString(),
      discountType: item.discountType.toLowerCase(),
      discountValue: item.discountValue.toString(),
      invoiceDiscountAllocation: item.invoiceDiscountAllocation.toString(),
      taxRate: item.taxRate.toString(),
      taxAmount: item.taxAmount.toString(),
      lineTotal: item.lineTotal.toString(),
      position: item.position,
    })),
    payments: invoice.payments?.map((payment) => ({
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      amount: payment.amount.toString(),
      paymentDate: payment.paymentDate.toISOString(),
      method: payment.method.toLowerCase(),
      transactionReference: payment.transactionReference,
      receipt: payment.receipt ?? null,
    })),
  };
}

@Controller("invoicing")
export class InvoicingController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("settings")
  async getSettings(@Req() request: HttpRequest) {
    const { organizationId } = this.context(request);
    return { data: await this.ensureSettings(organizationId) };
  }

  @Patch("settings")
  async updateSettings(@Req() request: HttpRequest, @Body() body: unknown) {
    this.requireManager(request, "Only workspace administrators can change billing settings");
    const { organizationId } = this.context(request);
    if (!isRecord(body)) throw this.invalid("A settings object is required");

    const current = await this.ensureSettings(organizationId);
    const data: Record<string, unknown> = {};
    for (const [field, max] of [
      ["businessName", 160], ["businessEmail", 254], ["businessPhone", 40], ["businessAddress", 4000],
      ["gstin", 32], ["registrationStateCode", 8], ["invoicePrefix", 12], ["quotePrefix", 12],
      ["receiptPrefix", 12], ["defaultTerms", 6000],
    ] as const) {
      if (!(field in body)) continue;
      const value = nullableText(body[field], field, max);
      if (field === "businessEmail" && value && !EMAIL_PATTERN.test(value)) throw this.invalid("businessEmail must be a valid email address");
      if (["invoicePrefix", "quotePrefix", "receiptPrefix"].includes(field) && !value) throw this.invalid(`${field} cannot be empty`);
      data[field] = value;
    }

    if ("currency" in body) {
      const currency = stringValue(body.currency)?.toUpperCase();
      if (!currency || !/^[A-Z]{3}$/.test(currency)) throw this.invalid("currency must be a three-letter ISO currency code");
      if (currency !== current.currency) {
        const documentCount = await this.prisma.billingInvoice.count({ where: { organizationId } });
        if (documentCount > 0) throw new ConflictException({ code: "currency_in_use", message: "Currency cannot be changed after invoices have been created." });
      }
      data.currency = currency;
    }
    if ("currencyPrecision" in body) {
      const precision = body.currencyPrecision;
      if (!Number.isInteger(precision) || Number(precision) < 0 || Number(precision) > 4) {
        throw this.invalid("currencyPrecision must be an integer between 0 and 4");
      }
      data.currencyPrecision = precision;
    }
    if ("countryCode" in body) {
      const countryCode = stringValue(body.countryCode)?.toUpperCase();
      if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) throw this.invalid("countryCode must be a two-letter ISO country code");
      data.countryCode = countryCode;
    }
    if ("taxSystem" in body) {
      const taxSystem = stringValue(body.taxSystem)?.toUpperCase();
      if (!taxSystem || !taxSystems.has(taxSystem)) throw this.invalid("taxSystem must be GENERIC or INDIA_GST");
      data.taxSystem = taxSystem;
    }
    if ("defaultDueDays" in body) {
      const days = body.defaultDueDays;
      if (!Number.isInteger(days) || Number(days) < 0 || Number(days) > 365) throw this.invalid("defaultDueDays must be between 0 and 365");
      data.defaultDueDays = days;
    }
    if ("defaultTaxRate" in body) {
      const rate = this.validMoney(body.defaultTaxRate, "defaultTaxRate");
      if (parseBillingAmount(rate) > 100n * 10_000n) throw this.invalid("defaultTaxRate cannot exceed 100%");
      data.defaultTaxRate = rate;
    }
    await this.prisma.billingSettings.update({ where: { organizationId }, data });
    await this.audit(request, "settings", organizationId, "updated", { fields: Object.keys(data) });
    return { data: await this.ensureSettings(organizationId) };
  }

  @Get("dashboard")
  async dashboard(@Req() request: HttpRequest) {
    const { organizationId } = this.context(request);
    await this.ensureSettings(organizationId);
    const ownerUserId = assignedOwnerFilter(request);
    const where = { organizationId, status: "ISSUED" as const, ...(ownerUserId ? { ownerUserId } : {}) };
    const now = todayUtc();
    const monthRanges = Array.from({ length: 6 }, (_, index) => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      return { start, end };
    });
    const [all, paymentStatusRows, overdue, recentInvoices, recentPayments, monthlyRevenueRows] = await Promise.all([
      this.prisma.billingInvoice.aggregate({ where, _sum: { grandTotal: true, amountPaid: true, balanceDue: true }, _count: { _all: true } }),
      this.prisma.billingInvoice.groupBy({ by: ["paymentStatus"], where, _count: { _all: true } }),
      this.prisma.billingInvoice.aggregate({ where: { ...where, dueDate: { lt: todayUtc() }, balanceDue: { gt: 0 } }, _sum: { balanceDue: true }, _count: { _all: true } }),
      this.prisma.billingInvoice.findMany({ where, orderBy: { createdAt: "desc" }, take: 5 }),
      this.prisma.billingPayment.findMany({
        where: { organizationId, ...(ownerUserId ? { invoice: { ownerUserId } } : {}) },
        orderBy: { paymentDate: "desc" },
        take: 5,
        include: { invoice: { select: { invoiceNumber: true, customerName: true } }, receipt: { select: { receiptNumber: true } } },
      }),
      Promise.all(monthRanges.map((range) => this.prisma.billingPayment.aggregate({
        where: {
        organizationId,
        ...(ownerUserId ? { invoice: { ownerUserId } } : {}),
        paymentDate: { gte: range.start, lt: range.end },
        },
        _sum: { amount: true },
      }))),
    ]);
    const paymentStatusCounts = Object.fromEntries(paymentStatusRows.map((row) => [row.paymentStatus, row._count._all]));
    const settings = await this.prisma.billingSettings.findUnique({ where: { organizationId }, select: { currency: true } });
    return {
      data: {
        currency: settings?.currency.trim() ?? "USD",
        invoices: all._count._all,
        invoiced: all._sum.grandTotal?.toString() ?? "0.0000",
        received: all._sum.amountPaid?.toString() ?? "0.0000",
        outstanding: all._sum.balanceDue?.toString() ?? "0.0000",
        overdueAmount: overdue._sum.balanceDue?.toString() ?? "0.0000",
        overdueCount: overdue._count._all,
        paidCount: paymentStatusCounts.PAID ?? 0,
        partiallyPaidCount: paymentStatusCounts.PARTIALLY_PAID ?? 0,
        unpaidCount: paymentStatusCounts.UNPAID ?? 0,
        monthlyRevenue: monthlyRevenueRows.map((row, index) => ({
          month: monthRanges[index]!.start.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
          amount: row._sum.amount?.toString() ?? "0.0000",
        })),
        recentInvoices: recentInvoices.map((invoice) => toApiInvoice(invoice)),
        recentPayments: recentPayments.map((payment) => ({
          id: payment.id,
          paymentNumber: payment.paymentNumber,
          amount: payment.amount.toString(),
          paymentDate: payment.paymentDate.toISOString(),
          method: payment.method.toLowerCase(),
          customerName: payment.invoice.customerName,
          invoiceNumber: payment.invoice.invoiceNumber,
          receiptNumber: payment.receipt?.receiptNumber ?? null,
        })),
      },
    };
  }

  @Get("customers")
  async listBillingCustomers(@Req() request: HttpRequest, @Query("q") query?: string) {
    const { organizationId } = this.context(request);
    const search = query?.trim();
    if (search && search.length > 120) throw this.invalid("q must be at most 120 characters");
    const ownerUserId = assignedOwnerFilter(request);
    const [contacts, companies] = await Promise.all([
      this.prisma.contact.findMany({
        where: {
          organizationId,
          archivedAt: null,
          ...(ownerUserId ? { ownerUserId } : {}),
          ...(search ? { OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { company: { contains: search, mode: "insensitive" } },
          ] } : {}),
        },
        orderBy: { name: "asc" },
        take: 100,
        select: { id: true, name: true, email: true, phone: true, company: true },
      }),
      this.prisma.company.findMany({
        where: {
          organizationId,
          archivedAt: null,
          ...(ownerUserId ? { ownerUserId } : {}),
          ...(search ? { OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { industry: { contains: search, mode: "insensitive" } },
          ] } : {}),
        },
        orderBy: { name: "asc" },
        take: 100,
        select: { id: true, name: true, phone: true },
      }),
    ]);
    return {
      data: {
        contacts: contacts.map((contact) => ({ ...contact, type: "contact" })),
        companies: companies.map((company) => ({ ...company, email: null, type: "company" })),
      },
    };
  }

  @Get("products")
  async listProducts(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("includeInactive") includeInactive?: string,
  ) {
    const { organizationId } = this.context(request);
    const search = query?.trim();
    if (search && search.length > 120) throw this.invalid("q must be at most 120 characters");
    const products = await this.prisma.billingProduct.findMany({
      where: {
        organizationId,
        ...(includeInactive === "true" ? {} : { isActive: true }),
        ...(search ? { OR: [
          { name: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
          { category: { contains: search, mode: "insensitive" } },
        ] } : {}),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 100,
    });
    return { data: products.map((product) => this.presentProduct(product)) };
  }

  @Post("products")
  async createProduct(@Req() request: HttpRequest, @Body() body: unknown) {
    this.requireManager(request, "Only workspace administrators or sales managers can manage products");
    const { organizationId, userId } = this.context(request);
    if (!isRecord(body)) throw this.invalid("A product object is required");
    const data = this.productFields(body, true);
    try {
      const product = await this.prisma.billingProduct.create({
        data: { ...data, organizationId, createdByUserId: userId },
      });
      await this.audit(request, "product", product.id, "created", { sku: product.sku });
      return { data: this.presentProduct(product) };
    } catch (error) {
      if (prismaCode(error) === "P2002") throw new ConflictException({ code: "duplicate_sku", message: "A product with this SKU already exists in this workspace." });
      throw error;
    }
  }

  @Patch("products/:id")
  async updateProduct(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: unknown) {
    this.requireManager(request, "Only workspace administrators or sales managers can manage products");
    const { organizationId } = this.context(request);
    if (!isRecord(body)) throw this.invalid("A product object is required");
    const data = this.productFields(body, false);
    if (!Object.keys(data).length) throw this.invalid("Provide at least one product field to update");
    try {
      const result = await this.prisma.billingProduct.updateMany({ where: { id, organizationId }, data });
      if (!result.count) throw new NotFoundException({ code: "not_found", message: "Product not found" });
      const product = await this.prisma.billingProduct.findFirst({ where: { id, organizationId } });
      if (!product) throw new NotFoundException({ code: "not_found", message: "Product not found" });
      await this.audit(request, "product", id, "updated", { fields: Object.keys(data) });
      return { data: this.presentProduct(product) };
    } catch (error) {
      if (prismaCode(error) === "P2002") throw new ConflictException({ code: "duplicate_sku", message: "A product with this SKU already exists in this workspace." });
      throw error;
    }
  }

  @Get("invoices")
  async listInvoices(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("status") status?: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
  ) {
    const { organizationId } = this.context(request);
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const search = query?.trim();
    if (search && search.length > 120) throw this.invalid("q must be at most 120 characters");
    const statusValue = status?.trim().toUpperCase();
    if (statusValue && !["ALL", "DRAFT", "ISSUED", "PAID", "PARTIALLY_PAID", "UNPAID", "OVERDUE", "CANCELLED"].includes(statusValue)) {
      throw this.invalid("Invalid invoice status filter");
    }
    const where = {
      organizationId,
      ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}),
      ...(statusValue === "OVERDUE"
        ? { status: "ISSUED" as const, balanceDue: { gt: 0 }, dueDate: { lt: todayUtc() } }
        : statusValue === "PAID" ? { paymentStatus: "PAID" as const }
          : statusValue === "PARTIALLY_PAID" ? { paymentStatus: "PARTIALLY_PAID" as const }
            : statusValue === "UNPAID" ? { paymentStatus: "UNPAID" as const, status: "ISSUED" as const }
              : statusValue && statusValue !== "ALL" ? { status: statusValue as "DRAFT" | "ISSUED" | "CANCELLED" } : {}),
      ...(search ? { OR: [
        { invoiceNumber: { contains: search, mode: "insensitive" as const } },
        { customerName: { contains: search, mode: "insensitive" as const } },
        { customerEmail: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const [total, invoices] = await Promise.all([
      this.prisma.billingInvoice.count({ where }),
      this.prisma.billingInvoice.findMany({
        where,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data: invoices.map((invoice) => toApiInvoice(invoice)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Post("invoices")
  async createInvoice(@Req() request: HttpRequest, @Body() body: unknown) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    if (!isRecord(body)) throw this.invalid("An invoice object is required");
    const invoice = await this.prisma.$transaction(async (transaction) => {
      const settings = await this.ensureSettings(organizationId, transaction);
      const document = await this.prepareDocument(transaction, request, body, settings, "invoice");
      const created = await transaction.billingInvoice.create({
        data: {
          organizationId,
          ...document.customer,
          invoiceDate: document.invoiceDate,
          dueDate: document.dueDate,
          currency: document.currency,
          status: "DRAFT",
          paymentStatus: "UNPAID",
          subtotal: document.calculation.subtotal,
          discountAmount: document.calculation.discountAmount,
          discountType: document.calculation.discountType,
          discountValue: document.calculation.discountValue,
          taxAmount: document.calculation.taxAmount,
          additionalCharges: document.calculation.additionalCharges,
          shippingAmount: document.calculation.shippingAmount,
          roundOff: document.calculation.roundOff,
          grandTotal: document.calculation.grandTotal,
          balanceDue: document.calculation.grandTotal,
          purchaseOrderNumber: document.purchaseOrderNumber,
          referenceNumber: document.referenceNumber,
          placeOfSupply: document.placeOfSupply,
          notes: document.notes,
          internalNotes: document.internalNotes,
          terms: document.terms ?? settings.defaultTerms,
          createdByUserId: userId,
          ownerUserId: userId,
        },
      });
      await transaction.billingInvoiceItem.createMany({
        data: document.calculation.lines.map((line) => ({ ...line, organizationId, invoiceId: created.id })),
      });
      await this.createAudit(transaction, request, "invoice", created.id, "draft_created", { grandTotal: document.calculation.grandTotal });
      return transaction.billingInvoice.findFirst({
        where: { id: created.id, organizationId },
        include: { items: { orderBy: { position: "asc" } } },
      });
    });
    if (!invoice) throw new NotFoundException({ code: "not_found", message: "Invoice could not be loaded after creation" });
    return { data: toApiInvoice(invoice) };
  }

  @Get("invoices/:id")
  async getInvoice(@Req() request: HttpRequest, @Param("id") id: string) {
    const invoice = await this.findInvoice(request, id, true);
    return { data: toApiInvoice(invoice) };
  }

  @Patch("invoices/:id")
  async updateInvoice(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: unknown) {
    requireRecordWrite(request);
    if (!isRecord(body)) throw this.invalid("An invoice object is required");
    const { organizationId } = this.context(request);
    const invoice = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.billingInvoice.findFirst({
        where: { id, organizationId, status: "DRAFT", ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) },
        include: { items: true },
      });
      if (!existing) throw new NotFoundException({ code: "not_found", message: "Draft invoice not found" });
      const settings = await this.ensureSettings(organizationId, transaction);
      const document = await this.prepareDocument(transaction, request, body, settings, "invoice", existing);
      const updated = await transaction.billingInvoice.updateMany({
        where: { id, organizationId, status: "DRAFT" },
        data: {
          ...document.customer,
          invoiceDate: document.invoiceDate,
          dueDate: document.dueDate,
          currency: document.currency,
          subtotal: document.calculation.subtotal,
          discountAmount: document.calculation.discountAmount,
          discountType: document.calculation.discountType,
          discountValue: document.calculation.discountValue,
          taxAmount: document.calculation.taxAmount,
          additionalCharges: document.calculation.additionalCharges,
          shippingAmount: document.calculation.shippingAmount,
          roundOff: document.calculation.roundOff,
          grandTotal: document.calculation.grandTotal,
          balanceDue: document.calculation.grandTotal,
          purchaseOrderNumber: document.purchaseOrderNumber,
          referenceNumber: document.referenceNumber,
          placeOfSupply: document.placeOfSupply,
          notes: document.notes,
          internalNotes: document.internalNotes,
          terms: document.terms ?? settings.defaultTerms,
        },
      });
      if (!updated.count) {
        throw new ConflictException({ code: "invoice_state_conflict", message: "This invoice changed. Refresh and retry." });
      }
      await transaction.billingInvoiceItem.deleteMany({ where: { organizationId, invoiceId: id } });
      await transaction.billingInvoiceItem.createMany({
        data: document.calculation.lines.map((line) => ({ ...line, organizationId, invoiceId: id })),
      });
      await this.createAudit(transaction, request, "invoice", id, "draft_updated", { grandTotal: document.calculation.grandTotal });
      return transaction.billingInvoice.findFirst({
        where: { id, organizationId },
        include: { items: { orderBy: { position: "asc" } } },
      });
    });
    if (!invoice) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    return { data: toApiInvoice(invoice) };
  }

  @Post("invoices/:id/issue")
  async issueInvoice(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordWrite(request);
    const { organizationId } = this.context(request);
    const invoice = await this.prisma.$transaction(async (transaction) => {
      const draft = await transaction.billingInvoice.findFirst({
        where: { id, organizationId, status: "DRAFT", ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}) },
        include: { items: true },
      });
      if (!draft) throw new NotFoundException({ code: "not_found", message: "Draft invoice not found" });
      if (!draft.items.length || parseBillingAmount(draft.grandTotal.toString()) <= 0n) {
        throw this.invalid("An invoice needs at least one item and a total greater than zero before it can be issued");
      }
      const settings = await transaction.billingSettings.upsert({
        where: { organizationId },
        create: { organizationId, invoiceNextNumber: 2 },
        update: { invoiceNextNumber: { increment: 1 } },
        select: { invoicePrefix: true, invoiceNextNumber: true },
      });
      const sequence = settings.invoiceNextNumber - 1;
      const invoiceNumber = this.documentNumber(settings.invoicePrefix, sequence, draft.invoiceDate);
      const updated = await transaction.billingInvoice.updateMany({
        where: { id, organizationId, status: "DRAFT", invoiceNumber: null },
        data: { status: "ISSUED", invoiceNumber, issuedAt: new Date() },
      });
      if (!updated.count) throw new ConflictException({ code: "invoice_already_issued", message: "This invoice has already been issued." });
      await this.createAudit(transaction, request, "invoice", id, "issued", { invoiceNumber });
      return transaction.billingInvoice.findFirst({ where: { id, organizationId }, include: { items: { orderBy: { position: "asc" } } } });
    }).catch((error: unknown) => {
      if (prismaCode(error) === "P2002") throw new ConflictException({ code: "invoice_number_conflict", message: "Could not reserve a unique invoice number. Please retry." });
      throw error;
    });
    if (!invoice) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    return { data: toApiInvoice(invoice) };
  }

  @Post("invoices/:id/cancel")
  async cancelInvoice(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: unknown) {
    requireRecordWrite(request);
    const { organizationId } = this.context(request);
    const reason = isRecord(body) ? nullableText(body.reason, "reason", 500) : null;
    const result = await this.prisma.billingInvoice.updateMany({
      where: {
        id,
        organizationId,
        status: { in: ["DRAFT", "ISSUED"] },
        amountPaid: 0,
        ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request), status: "DRAFT" } : {}),
      },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (!result.count) {
      const existing = await this.prisma.billingInvoice.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
      throw new ConflictException({ code: "invoice_not_cancellable", message: "Only unpaid invoices can be cancelled. Record a credit note or refund for a paid invoice." });
    }
    await this.audit(request, "invoice", id, "cancelled", { reason });
    return { ok: true };
  }

  @Post("invoices/:id/payments")
  async recordPayment(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: unknown) {
    this.requireManager(request, "Only workspace administrators or sales managers can record payments");
    const { organizationId, userId } = this.context(request);
    if (!isRecord(body)) throw this.invalid("A payment object is required");
    const amount = this.validMoney(body.amount, "amount");
    if (parseBillingAmount(amount) <= 0n) throw this.invalid("Payment amount must be greater than zero");
    const method = stringValue(body.method)?.toUpperCase();
    if (!method || !paymentMethods.has(method)) throw this.invalid("Choose a supported payment method");
    const idempotencyHeader = request.headers["idempotency-key"];
    const idempotencyKey = (typeof idempotencyHeader === "string" ? idempotencyHeader : stringValue(body.idempotencyKey))?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw this.invalid("A unique Idempotency-Key header is required when recording a payment");
    }
    const paymentDate = body.paymentDate ? new Date(String(body.paymentDate)) : new Date();
    if (!Number.isFinite(paymentDate.getTime())) throw this.invalid("paymentDate is invalid");
    const transactionReference = nullableText(body.transactionReference, "transactionReference", 120);
    const notes = nullableText(body.notes, "notes", 2000);

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const duplicate = await transaction.billingPayment.findFirst({
          where: { organizationId, idempotencyKey },
          include: { receipt: true, invoice: { select: { invoiceNumber: true } } },
        });
        if (duplicate) {
          if (duplicate.invoiceId !== id || parseBillingAmount(duplicate.amount.toString()) !== parseBillingAmount(amount) || duplicate.method !== method) {
            throw new ConflictException({ code: "idempotency_conflict", message: "This idempotency key was already used for a different payment." });
          }
          return { payment: duplicate, replayed: true };
        }
        const invoice = await transaction.billingInvoice.findFirst({
          where: { id, organizationId, status: "ISSUED" },
        });
        if (!invoice) throw new NotFoundException({ code: "invoice_not_found", message: "Issued invoice not found" });
        const previousBalance = parseBillingAmount(invoice.balanceDue.toString());
        const amountScaled = parseBillingAmount(amount);
        if (amountScaled > previousBalance) throw this.invalid("Payment amount cannot exceed the remaining invoice balance");
        const remainingBalance = previousBalance - amountScaled;
        const update = await transaction.billingInvoice.updateMany({
          where: { id, organizationId, status: "ISSUED", balanceDue: invoice.balanceDue },
          data: {
            amountPaid: { increment: amount },
            balanceDue: formatBillingAmount(remainingBalance),
            paymentStatus: remainingBalance === 0n ? "PAID" : "PARTIALLY_PAID",
          },
        });
        if (!update.count) throw new ConflictException({ code: "invoice_balance_changed", message: "The invoice balance changed. Refresh and retry the payment." });

        const settings = await transaction.billingSettings.upsert({
          where: { organizationId },
          create: { organizationId, receiptNextNumber: 2 },
          update: { receiptNextNumber: { increment: 1 } },
          select: { receiptPrefix: true, receiptNextNumber: true },
        });
        const sequence = settings.receiptNextNumber - 1;
        const paymentNumber = this.documentNumber("PAY", sequence, paymentDate);
        const receiptNumber = this.documentNumber(settings.receiptPrefix, sequence, paymentDate);
        const payment = await transaction.billingPayment.create({
          data: {
            organizationId,
            invoiceId: id,
            paymentNumber,
            amount,
            paymentDate,
            method: method as BillingPaymentMethod,
            transactionReference,
            idempotencyKey,
            notes,
            createdByUserId: userId,
          },
        });
        const receipt = await transaction.billingReceipt.create({
          data: {
            organizationId,
            paymentId: payment.id,
            receiptNumber,
            customerName: invoice.customerName,
            invoiceNumber: invoice.invoiceNumber ?? "",
            amount,
            paymentDate,
            paymentMethod: method as BillingPaymentMethod,
            transactionReference,
            previousBalance: formatBillingAmount(previousBalance),
            remainingBalance: formatBillingAmount(remainingBalance),
          },
        });
        await this.createAudit(transaction, request, "payment", payment.id, "recorded", { invoiceId: id, amount, receiptId: receipt.id });
        return { payment: { ...payment, receipt, invoice: { invoiceNumber: invoice.invoiceNumber } }, replayed: false };
      });
      return {
        data: {
          id: result.payment.id,
          paymentNumber: result.payment.paymentNumber,
          amount: result.payment.amount.toString(),
          paymentDate: result.payment.paymentDate.toISOString(),
          method: result.payment.method.toLowerCase(),
          transactionReference: result.payment.transactionReference,
          receipt: result.payment.receipt ? {
            id: result.payment.receipt.id,
            receiptNumber: result.payment.receipt.receiptNumber,
            previousBalance: result.payment.receipt.previousBalance.toString(),
            remainingBalance: result.payment.receipt.remainingBalance.toString(),
          } : null,
          invoiceNumber: result.payment.invoice.invoiceNumber,
          replayed: result.replayed,
        },
      };
    } catch (error) {
      if (prismaCode(error) === "P2002") throw new ConflictException({ code: "duplicate_payment", message: "This payment was already recorded. Refresh the invoice to see its receipt." });
      throw error;
    }
  }

  @Get("payments")
  async listPayments(@Req() request: HttpRequest, @Query("q") query?: string) {
    const { organizationId } = this.context(request);
    const search = query?.trim();
    if (search && search.length > 120) throw this.invalid("q must be at most 120 characters");
    const payments = await this.prisma.billingPayment.findMany({
      where: {
        organizationId,
        ...(assignedOwnerFilter(request) ? { invoice: { ownerUserId: assignedOwnerFilter(request) } } : {}),
        ...(search ? { OR: [
          { paymentNumber: { contains: search, mode: "insensitive" } },
          { transactionReference: { contains: search, mode: "insensitive" } },
          { invoice: { customerName: { contains: search, mode: "insensitive" } } },
        ] } : {}),
      },
      orderBy: { paymentDate: "desc" },
      take: 100,
      include: { invoice: { select: { invoiceNumber: true, customerName: true, currency: true } }, receipt: true },
    });
    return { data: payments.map((payment) => ({
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      amount: payment.amount.toString(),
      paymentDate: payment.paymentDate.toISOString(),
      method: payment.method.toLowerCase(),
      transactionReference: payment.transactionReference,
      customerName: payment.invoice.customerName,
      invoiceNumber: payment.invoice.invoiceNumber,
      currency: payment.invoice.currency.trim(),
      receiptNumber: payment.receipt?.receiptNumber ?? null,
    })) };
  }

  @Get("receipts")
  async listReceipts(@Req() request: HttpRequest, @Query("q") query?: string) {
    const { organizationId } = this.context(request);
    const search = query?.trim();
    if (search && search.length > 120) throw this.invalid("q must be at most 120 characters");
    const receipts = await this.prisma.billingReceipt.findMany({
      where: {
        organizationId,
        ...(assignedOwnerFilter(request) ? { payment: { invoice: { ownerUserId: assignedOwnerFilter(request) } } } : {}),
        ...(search ? { OR: [
          { receiptNumber: { contains: search, mode: "insensitive" } },
          { invoiceNumber: { contains: search, mode: "insensitive" } },
          { customerName: { contains: search, mode: "insensitive" } },
        ] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { payment: { select: { notes: true, invoice: { select: { currency: true } } } } },
    });
    return { data: receipts.map((receipt) => ({
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      customerName: receipt.customerName,
      invoiceNumber: receipt.invoiceNumber,
      amount: receipt.amount.toString(),
      currency: receipt.payment.invoice.currency.trim(),
      paymentDate: receipt.paymentDate.toISOString(),
      method: receipt.paymentMethod.toLowerCase(),
      transactionReference: receipt.transactionReference,
      previousBalance: receipt.previousBalance.toString(),
      remainingBalance: receipt.remainingBalance.toString(),
      notes: receipt.payment.notes,
    })) };
  }

  @Get("quotations")
  async listQuotations(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("status") status?: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
  ) {
    const { organizationId } = this.context(request);
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const search = query?.trim();
    const statusValue = status?.trim().toUpperCase();
    if (search && search.length > 120) throw this.invalid("q must be at most 120 characters");
    if (statusValue && !["ALL", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"].includes(statusValue)) {
      throw this.invalid("Invalid quotation status filter");
    }
    const where = {
      organizationId,
      ...(assignedOwnerFilter(request) ? { createdByUserId: assignedOwnerFilter(request) } : {}),
      ...(statusValue && statusValue !== "ALL" ? { status: statusValue as BillingQuotationStatus } : {}),
      ...(search ? { OR: [
        { quotationNumber: { contains: search, mode: "insensitive" as const } },
        { customerName: { contains: search, mode: "insensitive" as const } },
        { customerEmail: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const [total, quotations] = await Promise.all([
      this.prisma.billingQuotation.count({ where }),
      this.prisma.billingQuotation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data: quotations.map((quote) => this.presentQuotation(quote)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Post("quotations")
  async createQuotation(@Req() request: HttpRequest, @Body() body: unknown) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    if (!isRecord(body)) throw this.invalid("A quotation object is required");
    const quote = await this.prisma.$transaction(async (transaction) => {
      const settings = await this.ensureSettings(organizationId, transaction);
      const document = await this.prepareDocument(transaction, request, body, settings, "quotation");
      const created = await transaction.billingQuotation.create({
        data: {
          organizationId,
          ...document.customer,
          validUntil: body.validUntil ? parseDate(body.validUntil, "validUntil") : null,
          currency: document.currency,
          status: "DRAFT",
          subtotal: document.calculation.subtotal,
          discountAmount: document.calculation.discountAmount,
          discountType: document.calculation.discountType,
          discountValue: document.calculation.discountValue,
          taxAmount: document.calculation.taxAmount,
          grandTotal: document.calculation.grandTotal,
          terms: document.terms ?? settings.defaultTerms,
          notes: document.notes,
          createdByUserId: userId,
        },
      });
      await transaction.billingQuotationItem.createMany({
        data: document.calculation.lines.map((line) => ({ ...line, organizationId, quotationId: created.id })),
      });
      await this.createAudit(transaction, request, "quotation", created.id, "draft_created", { grandTotal: document.calculation.grandTotal });
      return transaction.billingQuotation.findFirst({ where: { id: created.id, organizationId }, include: { items: { orderBy: { position: "asc" } } } });
    });
    if (!quote) throw new NotFoundException({ code: "not_found", message: "Quotation could not be loaded after creation" });
    return { data: this.presentQuotation(quote) };
  }

  @Post("quotations/:id/status")
  async updateQuotationStatus(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: unknown) {
    requireRecordWrite(request);
    const { organizationId } = this.context(request);
    const status = isRecord(body) ? stringValue(body.status)?.toUpperCase() : undefined;
    if (!status || !["SENT", "ACCEPTED", "REJECTED"].includes(status)) throw this.invalid("Quotation status must be SENT, ACCEPTED, or REJECTED");
    const updated = await this.prisma.$transaction(async (transaction) => {
      const quote = await transaction.billingQuotation.findFirst({
        where: { id, organizationId, ...(assignedOwnerFilter(request) ? { createdByUserId: assignedOwnerFilter(request) } : {}) },
      });
      if (!quote) throw new NotFoundException({ code: "not_found", message: "Quotation not found" });
      if (quote.status === "CONVERTED" || quote.convertedInvoiceId) {
        throw new ConflictException({ code: "quotation_state_conflict", message: "A converted quotation cannot be changed." });
      }
      if (status === "SENT" && quote.status !== "DRAFT" && quote.status !== "SENT") {
        throw new ConflictException({ code: "quotation_state_conflict", message: "Only draft quotations can be sent." });
      }
      if ((status === "ACCEPTED" || status === "REJECTED") && quote.status !== "SENT") {
        throw new ConflictException({ code: "quotation_state_conflict", message: "Only sent quotations can be accepted or rejected." });
      }
      if (status === "ACCEPTED" && quote.validUntil && quote.validUntil < todayUtc()) {
        throw new ConflictException({ code: "quotation_expired", message: "This quotation has expired and cannot be accepted." });
      }
      let quotationNumber = quote.quotationNumber;
      if (status === "SENT" && !quotationNumber) {
        const settings = await transaction.billingSettings.upsert({
          where: { organizationId },
          create: { organizationId, quoteNextNumber: 2 },
          update: { quoteNextNumber: { increment: 1 } },
          select: { quotePrefix: true, quoteNextNumber: true },
        });
        quotationNumber = this.documentNumber(settings.quotePrefix, settings.quoteNextNumber - 1, quote.createdAt);
      }
      const result = await transaction.billingQuotation.updateMany({
        where: {
          id,
          organizationId,
          status: quote.status,
          convertedInvoiceId: null,
          quotationNumber: quote.quotationNumber,
        },
        data: { status: status as BillingQuotationStatus, quotationNumber },
      });
      if (!result.count) throw new ConflictException({ code: "quotation_state_conflict", message: "This quotation changed. Refresh and retry." });
      await this.createAudit(transaction, request, "quotation", id, "status_changed", { status });
      return transaction.billingQuotation.findFirst({ where: { id, organizationId } });
    });
    if (!updated) throw new NotFoundException({ code: "not_found", message: "Quotation not found" });
    return { data: this.presentQuotation(updated) };
  }

  @Post("quotations/:id/convert")
  async convertQuotation(@Req() request: HttpRequest, @Param("id") id: string) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const invoice = await this.prisma.$transaction(async (transaction) => {
      const quote = await transaction.billingQuotation.findFirst({
        where: {
          id,
          organizationId,
          status: "ACCEPTED",
          convertedInvoiceId: null,
          ...(assignedOwnerFilter(request) ? { createdByUserId: assignedOwnerFilter(request) } : {}),
        },
        include: { items: { orderBy: { position: "asc" } } },
      });
      if (!quote) {
        const existing = await transaction.billingQuotation.findFirst({ where: { id, organizationId }, select: { convertedInvoiceId: true } });
        if (!existing) throw new NotFoundException({ code: "not_found", message: "Accepted quotation not found" });
        throw new ConflictException({
          code: "quotation_already_converted",
          message: existing.convertedInvoiceId ? "This quotation has already been converted." : "Only accepted quotations can be converted.",
        });
      }
      if (quote.validUntil && quote.validUntil < todayUtc()) {
        throw new ConflictException({ code: "quotation_expired", message: "This quotation has expired and cannot be converted." });
      }
      if (!quote.items.length || parseBillingAmount(quote.grandTotal.toString()) <= 0n) {
        throw this.invalid("An accepted quotation must contain an item and have a total greater than zero before conversion");
      }
      const settings = await transaction.billingSettings.upsert({
        where: { organizationId },
        create: { organizationId, invoiceNextNumber: 2 },
        update: { invoiceNextNumber: { increment: 1 } },
        select: { invoicePrefix: true, invoiceNextNumber: true, defaultDueDays: true, defaultTerms: true },
      });
      const sequence = settings.invoiceNextNumber - 1;
      const invoiceDate = todayUtc();
      const dueDate = new Date(invoiceDate.getTime() + settings.defaultDueDays * 86_400_000);
      const invoiceNumber = this.documentNumber(settings.invoicePrefix, sequence, invoiceDate);
      const created = await transaction.billingInvoice.create({
        data: {
          organizationId,
          invoiceNumber,
          customerType: quote.customerType,
          contactId: quote.contactId,
          companyId: quote.companyId,
          customerName: quote.customerName,
          customerEmail: quote.customerEmail,
          customerPhone: quote.customerPhone,
          billingAddress: quote.billingAddress,
          shippingAddress: quote.shippingAddress,
          invoiceDate,
          dueDate,
          currency: quote.currency,
          status: "ISSUED",
          paymentStatus: "UNPAID",
          subtotal: quote.subtotal,
          discountAmount: quote.discountAmount,
          discountType: quote.discountType,
          discountValue: quote.discountValue,
          taxAmount: quote.taxAmount,
          grandTotal: quote.grandTotal,
          balanceDue: quote.grandTotal,
          notes: quote.notes,
          terms: quote.terms ?? settings.defaultTerms,
          referenceNumber: quote.quotationNumber,
          issuedAt: new Date(),
          createdByUserId: userId,
          ownerUserId: quote.createdByUserId,
        },
      });
      await transaction.billingInvoiceItem.createMany({
        data: quote.items.map((item) => ({
          organizationId,
          invoiceId: created.id,
          productId: item.productId,
          itemName: item.itemName,
          description: item.description,
          sku: item.sku,
          hsnSacCode: item.hsnSacCode,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          discountType: item.discountType,
          discountValue: item.discountValue,
          invoiceDiscountAllocation: item.invoiceDiscountAllocation,
          taxRate: item.taxRate,
          taxAmount: item.taxAmount,
          lineTotal: item.lineTotal,
          position: item.position,
        })),
      });
      const converted = await transaction.billingQuotation.updateMany({
        where: { id, organizationId, status: "ACCEPTED", convertedInvoiceId: null },
        data: { status: "CONVERTED", convertedInvoiceId: created.id },
      });
      if (!converted.count) throw new ConflictException({ code: "quotation_already_converted", message: "This quotation has already been converted." });
      await this.createAudit(transaction, request, "quotation", id, "converted", { invoiceId: created.id, invoiceNumber });
      await this.createAudit(transaction, request, "invoice", created.id, "issued_from_quotation", { quotationId: id });
      return transaction.billingInvoice.findFirst({ where: { id: created.id, organizationId }, include: { items: { orderBy: { position: "asc" } } } });
    }).catch((error: unknown) => {
      if (prismaCode(error) === "P2002") throw new ConflictException({ code: "document_number_conflict", message: "Could not reserve a unique invoice number. Please retry." });
      throw error;
    });
    if (!invoice) throw new NotFoundException({ code: "not_found", message: "Invoice not found after conversion" });
    return { data: toApiInvoice(invoice) };
  }

  private context(request: HttpRequest) {
    if (!request.orgId || !request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated workspace context required" });
    return { organizationId: request.orgId, userId: request.userId };
  }

  private requireManager(request: HttpRequest, message: string) {
    requireRecordWrite(request);
    if (!request.organizationRole || !managerRoles.has(request.organizationRole)) {
      throw new ForbiddenException({ code: "forbidden", message });
    }
  }

  private invalid(message: string) {
    return new BadRequestException({ code: "validation_error", message });
  }

  private async ensureSettings(organizationId: string, database: PrismaService | BillingTransaction = this.prisma) {
    const organizationSettings = await database.organizationSettings.findUnique({
      where: { organizationId },
      select: { currency: true },
    });
    const settings = await database.billingSettings.upsert({
      where: { organizationId },
      create: { organizationId, currency: organizationSettings?.currency.trim() || "USD" },
      update: {},
    });
    return {
      ...settings,
      currency: settings.currency.trim(),
      defaultTaxRate: settings.defaultTaxRate.toString(),
    };
  }

  private validMoney(value: unknown, field: string): string {
    if (typeof value !== "string" && typeof value !== "number") throw this.invalid(`${field} must be a non-negative number`);
    try {
      const scaled = parseBillingAmount(value, field);
      return formatBillingAmount(scaled);
    } catch (error) {
      if (error instanceof BillingCalculationError) throw this.invalid(error.message);
      throw error;
    }
  }

  private productFields(body: JsonRecord, required: true): NewProductData;
  private productFields(body: JsonRecord, required: false): ProductData;
  private productFields(body: JsonRecord, required: boolean): ProductData {
    const data: ProductData = {};
    const textFields = [
      ["name", 160], ["sku", 64], ["description", 4000], ["category", 120], ["unit", 24], ["hsnSacCode", 32],
    ] as const;
    for (const [field, max] of textFields) {
      if (!required && !(field in body)) continue;
      if (required && field === "unit" && !(field in body)) {
        data.unit = "unit";
        continue;
      }
      const value = nullableText(body[field], field, max);
      if ((field === "name" || field === "sku" || field === "unit") && !value) throw this.invalid(`${field} is required`);
      if (field === "name" && value) data.name = value;
      else if (field === "sku" && value) data.sku = value;
      else if (field === "unit" && value) data.unit = value;
      else if (field === "description") data.description = value;
      else if (field === "category") data.category = value;
      else if (field === "hsnSacCode") data.hsnSacCode = value;
    }
    for (const field of ["sellingPrice", "purchasePrice", "taxRate"] as const) {
      if (!required && !(field in body)) continue;
      if (field === "purchasePrice" && (body[field] === undefined || body[field] === null || body[field] === "")) {
        data.purchasePrice = null;
        continue;
      }
      const value = this.validMoney(body[field] ?? (field === "taxRate" ? "0" : undefined), field);
      if (field === "taxRate" && parseBillingAmount(value) > 100n * 10_000n) throw this.invalid("taxRate cannot exceed 100%");
      if (field === "sellingPrice") data.sellingPrice = value;
      else if (field === "purchasePrice") data.purchasePrice = value;
      else data.taxRate = value;
    }
    if ("isActive" in body) {
      if (typeof body.isActive !== "boolean") throw this.invalid("isActive must be a boolean");
      data.isActive = body.isActive;
    }
    if (required && !("taxRate" in body)) data.taxRate = "0";
    if (required && (!data.name || !data.sku || !data.sellingPrice)) throw this.invalid("name, sku, and sellingPrice are required");
    return data;
  }

  private presentProduct(product: {
    id: string;
    name: string;
    sku: string;
    description: string | null;
    category: string | null;
    unit: string;
    sellingPrice: { toString(): string };
    purchasePrice: { toString(): string } | null;
    taxRate: { toString(): string };
    hsnSacCode: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      description: product.description,
      category: product.category,
      unit: product.unit,
      sellingPrice: product.sellingPrice.toString(),
      purchasePrice: product.purchasePrice?.toString() ?? null,
      taxRate: product.taxRate.toString(),
      hsnSacCode: product.hsnSacCode,
      isActive: product.isActive,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  private async prepareDocument(
    database: BillingTransaction,
    request: HttpRequest,
    body: JsonRecord,
    settings: Awaited<ReturnType<InvoicingController["ensureSettings"]>>,
    kind: DocumentKind,
    existing?: {
      invoiceDate: Date;
      dueDate: Date;
      customerType: BillingCustomerType;
      contactId: string | null;
      companyId: string | null;
      customerName: string;
      customerEmail: string | null;
      customerPhone: string | null;
      billingAddress: string | null;
      shippingAddress: string | null;
      placeOfSupply?: string | null;
      purchaseOrderNumber?: string | null;
      referenceNumber?: string | null;
      currency: string;
      subtotal: { toString(): string };
      discountType: BillingDiscountType;
      discountValue: { toString(): string };
      notes: string | null;
      internalNotes?: string | null;
      terms: string | null;
    },
  ) {
    const settingsTaxRate = settings.defaultTaxRate;
    const customer = await this.customerSnapshot(database, request, body, existing);
    const invoiceDate = parseDate(body.invoiceDate, "invoiceDate", existing?.invoiceDate ?? todayUtc());
    const dueDate = kind === "invoice"
      ? parseDate(body.dueDate, "dueDate", existing?.dueDate ?? new Date(invoiceDate.getTime() + settings.defaultDueDays * 86_400_000))
      : invoiceDate;
    if (kind === "invoice" && dueDate < invoiceDate) throw this.invalid("dueDate cannot be earlier than invoiceDate");
    const currency = (stringValue(body.currency) ?? existing?.currency ?? settings.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency !== settings.currency) {
      throw this.invalid(`Invoice currency must match this workspace's billing currency (${settings.currency})`);
    }
    if (!Array.isArray(body.items)) throw this.invalid("items must be an array");
    const items: BillingLineInput[] = [];
    for (const [position, rawItem] of body.items.entries()) {
      if (!isRecord(rawItem)) throw this.invalid(`Item ${position + 1} must be an object`);
      const productId = stringValue(rawItem.productId);
      let product: Awaited<ReturnType<BillingTransaction["billingProduct"]["findFirst"]>> = null;
      if (productId) {
        if (!UUID_PATTERN.test(productId)) throw this.invalid(`Item ${position + 1} has an invalid product ID`);
        product = await database.billingProduct.findFirst({ where: { id: productId, organizationId: request.orgId, isActive: true } });
        if (!product) throw new NotFoundException({ code: "product_not_found", message: `Active product for item ${position + 1} was not found in this workspace` });
      }
      const itemName = stringValue(rawItem.itemName) ?? product?.name;
      if (!itemName || itemName.length > 160) throw this.invalid(`Item ${position + 1} needs a name of at most 160 characters`);
      items.push({
        itemName,
        description: stringValue(rawItem.description) ?? product?.description,
        productId: product?.id ?? null,
        sku: stringValue(rawItem.sku) ?? product?.sku,
        hsnSacCode: stringValue(rawItem.hsnSacCode) ?? product?.hsnSacCode,
        quantity: (rawItem.quantity ?? "1") as string | number,
        unit: stringValue(rawItem.unit) ?? product?.unit ?? "unit",
        unitPrice: (rawItem.unitPrice ?? product?.sellingPrice.toString() ?? "0") as string | number,
        discountType: (stringValue(rawItem.discountType)?.toUpperCase() ?? "FIXED") as BillingDiscountType,
        discountValue: (rawItem.discountValue ?? "0") as string | number,
        taxRate: (rawItem.taxRate ?? product?.taxRate.toString() ?? settingsTaxRate) as string | number,
      });
    }
    const discountType = (stringValue(body.discountType)?.toUpperCase() ?? "FIXED") as BillingDiscountType;
    if (!discountTypes.has(discountType)) throw this.invalid("discountType must be FIXED or PERCENTAGE");
    let calculation: BillingCalculationResult;
    try {
      calculation = calculateBillingTotals({
        items,
        discountType,
        discountValue: (body.discountValue ?? "0") as string | number,
        additionalCharges: kind === "invoice" ? (body.additionalCharges ?? "0") as string | number : "0",
        shippingAmount: kind === "invoice" ? (body.shippingAmount ?? "0") as string | number : "0",
        roundOff: kind === "invoice" ? (body.roundOff ?? "0") as string | number : "0",
        currencyPrecision: settings.currencyPrecision,
      });
    } catch (error) {
      if (error instanceof BillingCalculationError) throw this.invalid(error.message);
      throw error;
    }
    const fieldValue = (field: string, previous?: string | null, max = 1000) => {
      if (!(field in body) && existing) return previous ?? null;
      return nullableText(body[field], field, max);
    };
    return {
      customer,
      invoiceDate,
      dueDate,
      currency,
      calculation,
      purchaseOrderNumber: kind === "invoice" ? fieldValue("purchaseOrderNumber", existing?.purchaseOrderNumber, 80) : null,
      referenceNumber: kind === "invoice" ? fieldValue("referenceNumber", existing?.referenceNumber, 80) : null,
      placeOfSupply: kind === "invoice" ? fieldValue("placeOfSupply", existing?.placeOfSupply, 120) : null,
      notes: fieldValue("notes", existing?.notes, 4000),
      internalNotes: kind === "invoice" ? fieldValue("internalNotes", existing?.internalNotes, 4000) : null,
      terms: fieldValue("terms", existing?.terms, 6000),
    };
  }

  private async customerSnapshot(
    database: BillingTransaction,
    request: HttpRequest,
    body: JsonRecord,
    existing?: {
      customerType: BillingCustomerType;
      contactId: string | null;
      companyId: string | null;
      customerName: string;
      customerEmail: string | null;
      customerPhone: string | null;
      billingAddress: string | null;
      shippingAddress: string | null;
    },
  ) {
    const organizationId = request.orgId;
    if (!organizationId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated workspace context required" });
    const type = (stringValue(body.customerType)?.toUpperCase() ?? existing?.customerType ?? "CUSTOM") as BillingCustomerType;
    if (!["CONTACT", "COMPANY", "CUSTOM"].includes(type)) throw this.invalid("customerType must be CONTACT, COMPANY, or CUSTOM");
    const customerId = stringValue(body.customerId) ?? (type === "CONTACT" ? existing?.contactId : existing?.companyId) ?? undefined;
    const ownerUserId = assignedOwnerFilter(request);
    let customerName = stringValue(body.customerName) ?? existing?.customerName;
    let customerEmail = stringValue(body.customerEmail) ?? existing?.customerEmail;
    let customerPhone = stringValue(body.customerPhone) ?? existing?.customerPhone;
    let contactId: string | null = null;
    let companyId: string | null = null;
    if (type === "CONTACT") {
      if (!customerId || !UUID_PATTERN.test(customerId)) throw this.invalid("Select an existing contact for this customer");
      const contact = await database.contact.findFirst({
        where: { id: customerId, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) },
      });
      if (!contact) throw new NotFoundException({ code: "customer_not_found", message: "Contact not found in this workspace" });
      customerName = contact.name;
      customerEmail = contact.email;
      customerPhone = contact.phone ?? null;
      contactId = contact.id;
    } else if (type === "COMPANY") {
      if (!customerId || !UUID_PATTERN.test(customerId)) throw this.invalid("Select an existing company for this customer");
      const company = await database.company.findFirst({
        where: { id: customerId, organizationId, archivedAt: null, ...(ownerUserId ? { ownerUserId } : {}) },
      });
      if (!company) throw new NotFoundException({ code: "customer_not_found", message: "Company not found in this workspace" });
      customerName = company.name;
      customerPhone = company.phone ?? null;
      companyId = company.id;
    }
    if (!customerName || customerName.length > 160) throw this.invalid("customerName is required and must be at most 160 characters");
    if (customerEmail && (customerEmail.length > 254 || !EMAIL_PATTERN.test(customerEmail))) throw this.invalid("customerEmail must be a valid email address");
    return {
      customerType: type,
      contactId,
      companyId,
      customerName,
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      billingAddress: nullableText(body.billingAddress ?? existing?.billingAddress, "billingAddress", 2000),
      shippingAddress: nullableText(body.shippingAddress ?? existing?.shippingAddress, "shippingAddress", 2000),
    };
  }

  private async findInvoice(request: HttpRequest, id: string, includePayments: boolean) {
    const { organizationId } = this.context(request);
    const invoice = await this.prisma.billingInvoice.findFirst({
      where: {
        id,
        organizationId,
        ...(assignedOwnerFilter(request) ? { ownerUserId: assignedOwnerFilter(request) } : {}),
      },
      include: {
        items: { orderBy: { position: "asc" } },
        ...(includePayments ? { payments: { orderBy: { paymentDate: "desc" }, include: { receipt: { select: { id: true, receiptNumber: true } } } } } : {}),
      },
    });
    if (!invoice) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    return invoice;
  }

  private documentNumber(prefix: string, sequence: number, date: Date): string {
    return `${prefix}-${date.getUTCFullYear()}-${String(sequence).padStart(4, "0")}`;
  }

  private async createAudit(
    transaction: PrismaService | BillingTransaction,
    request: HttpRequest,
    resourceType: string,
    resourceId: string,
    action: string,
    details?: Record<string, string | number | string[] | null>,
  ) {
    const { organizationId, userId } = this.context(request);
    await transaction.billingAuditEvent.create({
      data: { organizationId, actorUserId: userId, resourceType, resourceId, action, details },
    });
  }

  private async audit(
    request: HttpRequest,
    resourceType: string,
    resourceId: string,
    action: string,
    details?: Record<string, string | number | string[] | null>,
  ) {
    await this.createAudit(this.prisma, request, resourceType, resourceId, action, details);
  }

  private pagination(pageValue?: string, pageSizeValue?: string) {
    const page = pageValue === undefined ? 1 : Number(pageValue);
    const pageSize = pageSizeValue === undefined ? 25 : Number(pageSizeValue);
    if (!Number.isInteger(page) || page < 1) throw this.invalid("page must be a positive integer");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw this.invalid("pageSize must be between 1 and 100");
    return { page, pageSize };
  }

  private presentQuotation(quote: {
    id: string;
    quotationNumber: string | null;
    customerType: BillingCustomerType;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    validUntil: Date | null;
    currency: string;
    status: BillingQuotationStatus;
    subtotal: { toString(): string };
    discountAmount: { toString(): string };
    taxAmount: { toString(): string };
    grandTotal: { toString(): string };
    convertedInvoiceId: string | null;
    createdAt: Date;
    items?: Array<{
      id: string;
      itemName: string;
      quantity: { toString(): string };
      unit: string;
      unitPrice: { toString(): string };
      taxRate: { toString(): string };
      lineTotal: { toString(): string };
    }>;
  }) {
    return {
      id: quote.id,
      quotationNumber: quote.quotationNumber,
      customerType: quote.customerType.toLowerCase(),
      customerName: quote.customerName,
      customerEmail: quote.customerEmail,
      customerPhone: quote.customerPhone,
      validUntil: dateOnly(quote.validUntil),
      currency: quote.currency.trim(),
      status: quote.status.toLowerCase(),
      subtotal: quote.subtotal.toString(),
      discountAmount: quote.discountAmount.toString(),
      taxAmount: quote.taxAmount.toString(),
      grandTotal: quote.grandTotal.toString(),
      convertedInvoiceId: quote.convertedInvoiceId,
      createdAt: quote.createdAt.toISOString(),
      items: quote.items?.map((item) => ({
        id: item.id,
        itemName: item.itemName,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitPrice: item.unitPrice.toString(),
        taxRate: item.taxRate.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
    };
  }
}
