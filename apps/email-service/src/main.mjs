import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const port = Number(process.env.EMAIL_SERVICE_PORT ?? 4100);
const token = process.env.EMAIL_DELIVERY_TOKEN;
const host = process.env.SMTP_HOST;
const sender = process.env.SMTP_FROM;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const username = process.env.SMTP_USER;
const password = process.env.SMTP_PASSWORD;

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("EMAIL_SERVICE_PORT must be a valid TCP port");
if (!token || token.length < 24) throw new Error("EMAIL_DELIVERY_TOKEN must contain at least 24 characters");
if (Boolean(host) !== Boolean(sender)) throw new Error("SMTP_HOST and SMTP_FROM must be configured together");
if (Boolean(username) !== Boolean(password)) throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
if (process.env.NODE_ENV === "production" && (!host || !sender)) throw new Error("SMTP_HOST and SMTP_FROM are required in production");
if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error("SMTP_PORT must be a valid TCP port");

const transporter = host && sender
  ? nodemailer.createTransport({
      host,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === "true",
      requireTLS: process.env.SMTP_REQUIRE_TLS !== "false" && process.env.SMTP_SECURE !== "true",
      ...(username && password ? { auth: { user: username, pass: password } } : {}),
    })
  : undefined;

function sendJson(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function authorized(header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw new RangeError("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return sendJson(response, 200, { status: "ok", emailConfigured: Boolean(transporter) });
  }
  if (request.method === "GET" && request.url === "/ready") {
    return sendJson(response, transporter ? 200 : 503, { ready: Boolean(transporter) });
  }
  if (request.method !== "POST" || request.url !== "/internal/v1/email") {
    return sendJson(response, 404, { error: "not_found" });
  }
  if (!authorized(request.headers.authorization)) return sendJson(response, 401, { error: "unauthorized" });

  try {
    const body = await readJson(request);
    if (
      typeof body?.to !== "string" || body.to.length > 254 || !/^\S+@\S+\.\S+$/.test(body.to) ||
      typeof body?.subject !== "string" || !body.subject.trim() || body.subject.length > 255 || /[\r\n]/.test(body.subject) ||
      typeof body?.text !== "string" || !body.text.trim() || body.text.length > 20_000
    ) return sendJson(response, 400, { error: "validation_error" });

    if (!transporter || !sender) {
      if (process.env.NODE_ENV === "production") return sendJson(response, 503, { error: "email_delivery_unavailable" });
      console.warn(`SMTP is not configured; development-only email to ${body.to}:\nSubject: ${body.subject}\n\n${body.text}`);
      return sendJson(response, 202, { accepted: true, delivered: false });
    }

    await transporter.sendMail({ from: sender, to: body.to, subject: body.subject, text: body.text });
    return sendJson(response, 202, { accepted: true, delivered: true });
  } catch (error) {
    const status = error instanceof RangeError || error instanceof SyntaxError ? 400 : 503;
    return sendJson(response, status, { error: status === 400 ? "invalid_request" : "email_delivery_failed" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Email delivery service listening on port ${port}; SMTP ${transporter ? "configured" : "not configured"}`);
});