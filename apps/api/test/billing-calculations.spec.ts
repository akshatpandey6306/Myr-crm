import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BillingCalculationError, calculateBillingTotals } from "../src/invoicing/billing-calculations.js";

describe("calculateBillingTotals", () => {
  it("uses decimal-safe line discounts, invoice discounts, and taxes", () => {
    const totals = calculateBillingTotals({
      currencyPrecision: 2,
      discountType: "PERCENTAGE",
      discountValue: "10",
      items: [{
        itemName: "Consulting",
        quantity: "2",
        unitPrice: "10",
        discountType: "PERCENTAGE",
        discountValue: "10",
        taxRate: "18",
      }],
    });

    assert.equal(totals.subtotal, "20.0000");
    assert.equal(totals.discountAmount, "3.8000");
    assert.equal(totals.taxAmount, "2.9200");
    assert.equal(totals.grandTotal, "19.1200");
    assert.equal(totals.lines[0]?.invoiceDiscountAllocation, "1.8000");
  });

  it("rounds fractional quantities to the configured currency precision", () => {
    const totals = calculateBillingTotals({
      currencyPrecision: 2,
      items: [{ itemName: "Unit", quantity: "3.3333", unitPrice: "0.10", taxRate: "18" }],
    });

    assert.equal(totals.subtotal, "0.3300");
    assert.equal(totals.taxAmount, "0.0600");
    assert.equal(totals.grandTotal, "0.3900");
  });

  it("rejects empty lines, negative amounts, and excessive rates", () => {
    assert.throws(() => calculateBillingTotals({ items: [] }), BillingCalculationError);
    assert.throws(() => calculateBillingTotals({
      items: [{ itemName: "Invalid", quantity: "1", unitPrice: "-1" }],
    }), BillingCalculationError);
    assert.throws(() => calculateBillingTotals({
      items: [{ itemName: "Invalid", quantity: "1", unitPrice: "1", taxRate: "101" }],
    }), BillingCalculationError);
  });
});