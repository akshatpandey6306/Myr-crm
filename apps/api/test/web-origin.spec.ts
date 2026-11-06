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
});
