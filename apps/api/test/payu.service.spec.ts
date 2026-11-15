import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { PayUService } from "../src/billing/payu.service.js";

const digest = (value: string) => createHash("sha512").update(value).digest("hex");

describe("PayUService callback hashes", () => {
  it("accepts the standard response hash with and without additional charges", () => {
    process.env.PAYU_MERCHANT_KEY = "test-key";
    process.env.PAYU_MERCHANT_SALT = "test-salt";
    process.env.PAYU_MODE = "test";
    const service = new PayUService();
    const response = {
      key: "test-key", status: "success", txnid: "tx-1", amount: "1.00",
      productinfo: "trial", firstname: "Test", email: "test@example.com", udf1: "payment-1",
    };
    const reverse = ["test-salt", "success", "", "", "", "", "", "", "", "", "", "payment-1", "test@example.com", "Test", "trial", "1.00", "tx-1", "test-key"].join("|");
    assert.equal(service.verifyCallbackHash({ ...response, hash: digest(reverse) }), true);
    assert.equal(service.verifyCallbackHash({ ...response, additional_charges: "0.10", hash: digest(`0.10|${reverse}`) }), true);
  });

  it("accepts the documented splitInfo response hash shape", () => {
    process.env.PAYU_MERCHANT_KEY = "test-key";
    process.env.PAYU_MERCHANT_SALT = "test-salt";
    process.env.PAYU_MODE = "test";
    const service = new PayUService();
    const splitInfo = JSON.stringify({ splitStatus: "splitNotReceived", splitSegments: [] });
    const suffix = ["", "", "", "", "", "", "", "", "", "", "test@example.com", "Test", "trial", "1.00", "tx-2", "test-key"];
    const hash = digest(["test-salt", "success", splitInfo, ...suffix].join("|"));
    assert.equal(service.verifyCallbackHash({
      key: "test-key", status: "success", txnid: "tx-2", amount: "1.00",
      productinfo: "trial", firstname: "Test", email: "test@example.com", splitInfo, hash,
    }), true);
  });
});
