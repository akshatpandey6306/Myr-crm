const SCALE = 10_000n;
const MAX_SCALED = 10n ** 18n - 1n;

export type BillingDiscountType = "FIXED" | "PERCENTAGE";

export type BillingLineInput = {
  itemName: string;
  description?: string | null;
  productId?: string | null;
  sku?: string | null;
  hsnSacCode?: string | null;
  quantity: number | string;
  unit?: string | null;
  unitPrice: number | string;
  discountType?: BillingDiscountType;
  discountValue?: number | string;
  taxRate?: number | string;
};

export type CalculatedBillingLine = {
  itemName: string;
  description: string | null;
  productId: string | null;
  sku: string | null;
  hsnSacCode: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string;
  discountType: BillingDiscountType;
  discountValue: string;
  invoiceDiscountAllocation: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  position: number;
};

export type BillingCalculationInput = {
  items: BillingLineInput[];
  discountType?: BillingDiscountType;
  discountValue?: number | string;
  additionalCharges?: number | string;
  shippingAmount?: number | string;
  roundOff?: number | string;
  currencyPrecision?: number;
};

export type BillingCalculationResult = {
  lines: CalculatedBillingLine[];
  subtotal: string;
  discountAmount: string;
  discountType: BillingDiscountType;
  discountValue: string;
  taxAmount: string;
  additionalCharges: string;
  shippingAmount: string;
  roundOff: string;
  grandTotal: string;
};

export class BillingCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingCalculationError";
  }
}

function parseScaled(value: number | string | undefined, field: string, allowNegative = false): bigint {
  const raw = value === undefined ? "0" : String(value).trim();
  const pattern = allowNegative ? /^-?\d{1,14}(?:\.\d{1,4})?$/ : /^\d{1,14}(?:\.\d{1,4})?$/;
  if (!pattern.test(raw)) throw new BillingCalculationError(`${field} must be a non-negative number with at most four decimal places`);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0"));
  return negative ? -result : result;
}

function formatScaled(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function parseBillingAmount(value: number | string, field = "Amount", allowNegative = false): bigint {
  return parseScaled(value, field, allowNegative);
}

export function formatBillingAmount(value: bigint): string {
  if (value > MAX_SCALED || value < -MAX_SCALED) throw new BillingCalculationError("Calculated amount exceeds the supported financial range");
  return formatScaled(value);
}

function roundToPrecision(value: bigint, precision: number): bigint {
  const quantum = 10n ** BigInt(4 - precision);
  const rounded = (value + quantum / 2n) / quantum * quantum;
  return rounded;
}

function multiplyScaled(left: bigint, right: bigint, precision: number): bigint {
  return roundToPrecision((left * right + SCALE / 2n) / SCALE, precision);
}

function percentageOf(amount: bigint, percentage: bigint, precision: number): bigint {
  return roundToPrecision((amount * percentage + 50n * SCALE) / (100n * SCALE), precision);
}

function calculateDiscount(amount: bigint, type: BillingDiscountType, value: bigint, precision: number, field: string): bigint {
  if (value < 0n) throw new BillingCalculationError(`${field} cannot be negative`);
  if (type === "PERCENTAGE") {
    if (value > 100n * SCALE) throw new BillingCalculationError(`${field} cannot exceed 100%`);
    return percentageOf(amount, value, precision);
  }
  if (type !== "FIXED") throw new BillingCalculationError(`${field} type is invalid`);
  return roundToPrecision(value > amount ? amount : value, precision);
}

export function calculateBillingTotals(input: BillingCalculationInput): BillingCalculationResult {
  const precision = input.currencyPrecision ?? 2;
  if (!Number.isInteger(precision) || precision < 0 || precision > 4) {
    throw new BillingCalculationError("Currency precision must be between 0 and 4");
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 200) {
    throw new BillingCalculationError("Add between 1 and 200 invoice items");
  }

  const itemDiscountType = (item: BillingLineInput): BillingDiscountType => item.discountType ?? "FIXED";
  const precisionLines = input.items.map((item, position) => {
    const quantity = parseScaled(item.quantity, `Item ${position + 1} quantity`);
    const unitPrice = parseScaled(item.unitPrice, `Item ${position + 1} unit price`);
    const discountValue = parseScaled(item.discountValue, `Item ${position + 1} discount`);
    const taxRate = parseScaled(item.taxRate, `Item ${position + 1} tax rate`);
    if (quantity <= 0n) throw new BillingCalculationError(`Item ${position + 1} quantity must be greater than zero`);
    if (taxRate > 100n * SCALE) throw new BillingCalculationError(`Item ${position + 1} tax rate cannot exceed 100%`);
    const lineSubtotal = multiplyScaled(quantity, unitPrice, precision);
    if (lineSubtotal > MAX_SCALED) throw new BillingCalculationError(`Item ${position + 1} total exceeds the supported financial range`);
    const discountType = itemDiscountType(item);
    const discountAmount = calculateDiscount(lineSubtotal, discountType, discountValue, precision, `Item ${position + 1} discount`);
    return {
      item,
      position,
      quantity,
      unitPrice,
      lineSubtotal,
      discountType,
      discountValue,
      discountAmount,
      taxableBeforeInvoiceDiscount: lineSubtotal - discountAmount,
      taxRate,
    };
  });

  const subtotal = precisionLines.reduce((sum, line) => sum + line.lineSubtotal, 0n);
  const lineDiscounts = precisionLines.reduce((sum, line) => sum + line.discountAmount, 0n);
  const taxableBeforeInvoiceDiscount = precisionLines.reduce((sum, line) => sum + line.taxableBeforeInvoiceDiscount, 0n);
  const discountType = input.discountType ?? "FIXED";
  const discountValue = parseScaled(input.discountValue, "Invoice discount");
  const invoiceDiscount = calculateDiscount(taxableBeforeInvoiceDiscount, discountType, discountValue, precision, "Invoice discount");

  let undistributedDiscount = invoiceDiscount;
  const lines = precisionLines.map((line, index): CalculatedBillingLine => {
    const allocation = index === precisionLines.length - 1
      ? undistributedDiscount
      : taxableBeforeInvoiceDiscount === 0n
        ? 0n
        : (invoiceDiscount * line.taxableBeforeInvoiceDiscount / taxableBeforeInvoiceDiscount);
    undistributedDiscount -= allocation;
    const taxableAmount = line.taxableBeforeInvoiceDiscount - allocation;
    const taxAmount = percentageOf(taxableAmount, line.taxRate, precision);
    const lineTotal = taxableAmount + taxAmount;
    return {
      itemName: line.item.itemName,
      description: line.item.description ?? null,
      productId: line.item.productId ?? null,
      sku: line.item.sku ?? null,
      hsnSacCode: line.item.hsnSacCode ?? null,
      quantity: formatScaled(line.quantity),
      unit: line.item.unit?.trim() || "unit",
      unitPrice: formatScaled(line.unitPrice),
      discountAmount: formatScaled(line.discountAmount),
      discountType: line.discountType,
      discountValue: formatScaled(line.discountValue),
      invoiceDiscountAllocation: formatScaled(allocation),
      taxRate: formatScaled(line.taxRate),
      taxAmount: formatScaled(taxAmount),
      lineTotal: formatScaled(lineTotal),
      position: line.position,
    };
  });

  const taxAmount = lines.reduce((sum, line) => sum + parseScaled(line.taxAmount, "Tax amount"), 0n);
  const additionalCharges = parseScaled(input.additionalCharges, "Additional charges");
  const shippingAmount = parseScaled(input.shippingAmount, "Shipping amount");
  const roundOff = parseScaled(input.roundOff, "Round-off adjustment", true);
  if (additionalCharges < 0n || shippingAmount < 0n) {
    throw new BillingCalculationError("Additional charges and shipping cannot be negative");
  }
  const grandTotal = lines.reduce((sum, line) => sum + parseScaled(line.lineTotal, "Line total"), 0n)
    + additionalCharges + shippingAmount + roundOff;
  if (grandTotal < 0n) throw new BillingCalculationError("Invoice total cannot be negative");
  if (grandTotal > MAX_SCALED) throw new BillingCalculationError("Invoice total exceeds the supported financial range");

  return {
    lines,
    subtotal: formatScaled(subtotal),
    discountAmount: formatScaled(lineDiscounts + invoiceDiscount),
    discountType,
    discountValue: formatScaled(discountValue),
    taxAmount: formatScaled(taxAmount),
    additionalCharges: formatScaled(additionalCharges),
    shippingAmount: formatScaled(shippingAmount),
    roundOff: formatScaled(roundOff),
    grandTotal: formatScaled(grandTotal),
  };
}