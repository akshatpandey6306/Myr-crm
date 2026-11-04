import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { EmailService } from "../src/auth/email.service.js";

const originalApiKey = process.env.EMAIL_API_KEY;
const originalFrom = process.env.EMAIL_FROM;
const originalWebOrigin = process.env.WEB_ORIGIN;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.EMAIL_API_KEY;
  else process.env.EMAIL_API_KEY = originalApiKey;
  if (originalFrom === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = originalFrom;
  if (originalWebOrigin === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = originalWebOrigin;
  globalThis.fetch = originalFetch;
});

describe("EmailService", () => {
  it("sends a verification message through the configured Resend API", async () => {
    process.env.EMAIL_API_KEY = "test-api-key";
    process.env.EMAIL_FROM = "Myr CRM <noreply@example.com>";
    process.env.WEB_ORIGIN = "https://crm.example.com/";
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(null, { status: 200 });
    };

    await new EmailService().sendVerification("maya@example.com", "Maya", "verify-token");

    assert.deepEqual(requestBody?.to, ["maya@example.com"]);
    assert.equal(requestBody?.from, process.env.EMAIL_FROM);
    assert.match(String(requestBody?.text), /https:\/\/crm\.example\.com\/verify-email\?token=verify-token/);
  });

  it("surfaces provider delivery failures", async () => {
    process.env.EMAIL_API_KEY = "test-api-key";
    process.env.EMAIL_FROM = "Myr CRM <noreply@example.com>";
    globalThis.fetch = async () => new Response(null, { status: 503 });

    await assert.rejects(new EmailService().sendPasswordReset("maya@example.com", "Maya", "reset-token"), ServiceUnavailableException);
  });
});
