import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly serviceUrl?: string;
  private readonly serviceToken?: string;

  constructor() {
    this.serviceUrl = process.env.EMAIL_DELIVERY_URL?.replace(/\/+$/, "");
    this.serviceToken = process.env.EMAIL_DELIVERY_TOKEN;
    if (this.serviceUrl && !this.serviceToken) throw new Error("EMAIL_DELIVERY_TOKEN is required when EMAIL_DELIVERY_URL is configured");
    if (process.env.NODE_ENV === "production" && (!this.serviceUrl || !this.serviceToken)) {
      throw new Error("Configure EMAIL_DELIVERY_URL and EMAIL_DELIVERY_TOKEN before starting the API in production");
    }
  }

  isConfigured() {
    return Boolean(this.serviceUrl && this.serviceToken);
  }

  async send(to: string, subject: string, text: string) {
    if (!this.isConfigured()) {
      if (process.env.NODE_ENV !== "production") {
      this.logger.warn(`SMTP is not configured; development-only email to ${to}:\n${text}`);
      return false;
      }
      throw new ServiceUnavailableException({
        code: "email_delivery_unavailable",
        message: "Email delivery is temporarily unavailable",
      });
    }

    try {
      const response = await fetch(`${this.serviceUrl}/internal/v1/email`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ to, subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Email delivery service returned ${response.status}`);
      const result: unknown = await response.json();
      return typeof result === "object" && result !== null && "delivered" in result && result.delivered === true;
    } catch (cause) {
      this.logger.error("Email delivery service request failed", cause instanceof Error ? cause.stack : undefined);
      throw new ServiceUnavailableException({
        code: "email_delivery_failed",
        message: "Email delivery is temporarily unavailable",
      });
    }
  }
}
