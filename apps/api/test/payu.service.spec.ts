import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { PayUService } from "../src/billing/payu.service.js";

const digest = (value: string) => createHash("sha512").update(value).digest("hex");

describe("PayUService callback hashes", () => {
  it("routes production mode to the live gateway and requires an HTTPS callback", () => {
    const previous = {
      key: process.env.PAYU_MERCHANT_KEY,
      salt: process.env.PAYU_MERCHANT_SALT,
      mode: process.env.PAYU_MODE,
      callback: process.env.PAYU_CALLBACK_URL,
    };
    try {
      process.env.PAYU_MERCHANT_KEY = "live-key";
      process.env.PAYU_MERCHANT_SALT = "live-salt";
      process.env.PAYU_MODE = "production";
      process.env.PAYU_CALLBACK_URL = "https://crm.example.com/api/v1/billing/payu/return";
      const checkout = new PayUService().createCheckout({
        transactionId: "tx-live",
        paymentId: "payment-live",
        amount: "999.00",
        productInfo: "Growth plan",
        firstName: "Test",
        email: "test@example.com",
        phone: "+919876543210",
      });
      assert.equal(checkout.checkoutUrl, "https://secure.payu.in/_payment");
      assert.equal(checkout.fields.surl, "https://crm.example.com/api/v1/billing/payu/return");
    } finally {
      if (previous.key === undefined) delete process.env.PAYU_MERCHANT_KEY;
      else process.env.PAYU_MERCHANT_KEY = previous.key;
      if (previous.salt === undefined) delete process.env.PAYU_MERCHANT_SALT;
      else process.env.PAYU_MERCHANT_SALT = previous.salt;
      if (previous.mode === undefined) delete process.env.PAYU_MODE;
      else process.env.PAYU_MODE = previous.mode;
      if (previous.callback === undefined) delete process.env.PAYU_CALLBACK_URL;
      else process.env.PAYU_CALLBACK_URL = previous.callback;
    }
  });

  it("creates a hosted checkout using the documented request hash", () => {
    process.env.PAYU_MERCHANT_KEY = "test-key";
    process.env.PAYU_MERCHANT_SALT = "test-salt";
    process.env.PAYU_MODE = "test";
    process.env.PAYU_CALLBACK_URL = "http://localhost:4000/api/v1/billing/payu/return";
    const service = new PayUService();
    const checkout = service.createCheckout({
      transactionId: "tx-1",
      paymentId: "payment-1",
      amount: "1.00",
      productInfo: "trial",
      firstName: "Test",
      email: "test@example.com",
      phone: "+919876543210",
    });
    const requestHash = digest([
      "test-key", "tx-1", "1.00", "trial", "Test", "test@example.com", "payment-1",
      ...Array(9).fill(""), "test-salt",
    ].join("|"));

    assert.equal(checkout.checkoutUrl, "https://test.payu.in/_payment");
    assert.equal(checkout.fields.hash, requestHash);
    assert.equal(checkout.fields.surl, "http://localhost:4000/api/v1/billing/payu/return");
    assert.equal(checkout.fields.furl, checkout.fields.surl);
  });

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
