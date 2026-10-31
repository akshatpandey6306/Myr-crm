import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly transporter?: Transporter;
  private readonly sender?: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const sender = process.env.SMTP_FROM;
    if (!host && !sender && process.env.NODE_ENV !== "production") return;
    if (!host || !sender) {
      throw new Error("Configure both SMTP_HOST and SMTP_FROM before starting the API");
    }

    const port = Number(process.env.SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SMTP_PORT must be a valid TCP port");
    }
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
    }
    this.sender = sender;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true",
      requireTLS: process.env.SMTP_REQUIRE_TLS !== "false" && process.env.SMTP_SECURE !== "true",
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  isConfigured() {
    return Boolean(this.transporter && this.sender);
  }

  async send(to: string, subject: string, text: string) {
    if (this.transporter && this.sender) {
      try {
        await this.transporter.sendMail({ from: this.sender, to, subject, text });
      } catch (cause) {
        this.logger.error("SMTP delivery failed", cause instanceof Error ? cause.stack : undefined);
        throw new ServiceUnavailableException({
          code: "email_delivery_failed",
          message: "Email delivery is temporarily unavailable",
        });
      }
      return true;
    }
    if (process.env.NODE_ENV !== "production") {
      this.logger.warn(`SMTP is not configured; development-only email to ${to}:\n${text}`);
      return false;
    }
    throw new ServiceUnavailableException({
      code: "email_delivery_unavailable",
      message: "Email delivery is temporarily unavailable",
    });
  }
}
