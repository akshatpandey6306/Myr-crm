import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  isConfigured() {
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASSWORD;
    return Boolean(
      process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_FROM?.trim() &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535 &&
      Boolean(user) === Boolean(pass),
    );
  }

  async sendSignupOtp(otp: string, to: string) {
    const host = process.env.SMTP_HOST?.trim();
    const from = process.env.SMTP_FROM?.trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASSWORD;
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(user) !== Boolean(pass)) {
      throw new ServiceUnavailableException({
        code: "smtp_not_configured",
        message: "Signup verification email is unavailable until SMTP is configured.",
      });
    }

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    try {
      await transport.sendMail({
        from,
        to,
        subject: "Myr CRM workspace signup verification code",
        text: `Your Myr CRM workspace signup verification code is ${otp}. It expires in 10 minutes.`,
      });
    } catch (error) {
      this.logger.error("Could not deliver the workspace signup verification email.", error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({
        code: "signup_otp_delivery_failed",
        message: "We could not deliver the verification email. Request a new code and try again.",
      });
    }
  }
}
