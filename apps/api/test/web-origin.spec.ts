import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getWebOrigin } from "../src/common/web-origin.js";

describe("getWebOrigin", () => {
  it("trims surrounding whitespace and normalizes a trailing slash", () => {
    assert.equal(getWebOrigin("  https://crm.example.com/\r\n"), "https://crm.example.com");
  });

  it("rejects embedded control characters instead of emitting an invalid header", () => {
    assert.throws(
      () => getWebOrigin("https://crm.example.com\n,https://other.example.com"),
      /WEB_ORIGIN must be a single HTTP\(S\) origin without control characters/,
    );
  });

  it("rejects paths, queries, and non-HTTP schemes", () => {
    assert.throws(() => getWebOrigin("https://crm.example.com/path"), /WEB_ORIGIN must contain only/);
    assert.throws(() => getWebOrigin("ftp://crm.example.com"), /WEB_ORIGIN must contain only/);
  });

  it("requires an HTTPS web origin in production", () => {
    const previousMode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.throws(() => getWebOrigin("http://crm.example.com"), /must use HTTPS in production/);
      assert.equal(getWebOrigin("https://crm.example.com"), "https://crm.example.com");
    } finally {
      if (previousMode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousMode;
    }
  });

  it("does not silently fall back to localhost in production", () => {
    const previousMode = process.env.NODE_ENV;
    const previousOrigin = process.env.WEB_ORIGIN;
    process.env.NODE_ENV = "production";
    delete process.env.WEB_ORIGIN;
    try {
      assert.throws(() => getWebOrigin(undefined), /WEB_ORIGIN must be configured in production/);
    } finally {
      if (previousMode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousMode;
      if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
      else process.env.WEB_ORIGIN = previousOrigin;
    }
  });
});
