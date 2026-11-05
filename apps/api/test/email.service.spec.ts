import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { AuthEmailService } from "../src/auth/email.service.js";

const originalDeliveryUrl = process.env.EMAIL_DELIVERY_URL;
const originalDeliveryToken = process.env.EMAIL_DELIVERY_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalDeliveryUrl === undefined) delete process.env.EMAIL_DELIVERY_URL;
  else process.env.EMAIL_DELIVERY_URL = originalDeliveryUrl;
  if (originalDeliveryToken === undefined) delete process.env.EMAIL_DELIVERY_TOKEN;
  else process.env.EMAIL_DELIVERY_TOKEN = originalDeliveryToken;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  globalThis.fetch = originalFetch;
});

describe("AuthEmailService", () => {
  it("forwards email through the authenticated delivery-service contract", async () => {
    process.env.EMAIL_DELIVERY_URL = "http://email.internal/";
    process.env.EMAIL_DELIVERY_TOKEN = "local-test-delivery-token";
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ accepted: true, delivered: true }, { status: 202 });
    };

    const sent = await new AuthEmailService().send("maya@example.com", "Verify account", "verification link");

    assert.equal(sent, true);
    assert.equal(requestUrl, "http://email.internal/internal/v1/email");
    assert.equal(requestHeaders?.get("authorization"), "Bearer local-test-delivery-token");
    assert.deepEqual(requestBody, { to: "maya@example.com", subject: "Verify account", text: "verification link" });
  });

  it("surfaces delivery-service failures", async () => {
    process.env.EMAIL_DELIVERY_URL = "http://email.internal";
    process.env.EMAIL_DELIVERY_TOKEN = "local-test-delivery-token";
    globalThis.fetch = async () => new Response(null, { status: 503 });

    await assert.rejects(new AuthEmailService().send("maya@example.com", "subject", "body"), ServiceUnavailableException);
  });

  it("reports development log-only delivery as not delivered", async () => {
    process.env.EMAIL_DELIVERY_URL = "http://email.internal";
    process.env.EMAIL_DELIVERY_TOKEN = "local-test-delivery-token";
    globalThis.fetch = async () => Response.json({ accepted: true, delivered: false }, { status: 202 });

    assert.equal(await new AuthEmailService().send("maya@example.com", "subject", "body"), false);
  });

  it("keeps local development usable without a delivery service", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.EMAIL_DELIVERY_URL;
    delete process.env.EMAIL_DELIVERY_TOKEN;

    assert.equal(await new AuthEmailService().send("maya@example.com", "subject", "body"), false);
  });
});
