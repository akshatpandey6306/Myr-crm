import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  isConfigured() {
    return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
  }

  async sendVerification(email: string, name: string, token: string) {
    const link = `${this.webOrigin()}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send(email, "Verify your Myr CRM email", `Hi ${name}, verify your email: ${link}`);
  }

  async sendPasswordReset(email: string, name: string, token: string) {
    const link = `${this.webOrigin()}/forgot-password?token=${encodeURIComponent(token)}`;
    await this.send(email, "Reset your Myr CRM password", `Hi ${name}, reset your password: ${link}`);
  }

  private webOrigin() {
    return (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  private async send(to: string, subject: string, text: string) {
    const apiKey = process.env.EMAIL_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new ServiceUnavailableException({
        code: "email_unavailable",
        message: "Email delivery is not configured. Contact the platform team.",
      });
    }

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
    } catch (error) {
      this.logger.error("Email provider request failed", error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({
        code: "email_unavailable",
        message: "The email provider could not be reached. Try again later.",
      });
    }

    if (!response.ok) {
      this.logger.error(`Email provider rejected a message (HTTP ${response.status})`);
      throw new ServiceUnavailableException({
        code: "email_unavailable",
        message: "The email provider could not send the message. Try again later.",
      });
    }
  }
}
