import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

function smtpPassword() {
  const password = process.env.SMTP_PASSWORD ?? "";
  return process.env.SMTP_HOST?.trim().toLowerCase() === "smtp.gmail.com"
    ? password.replace(/\s+/g, "")
    : password;
}

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  isConfigured() {
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = smtpPassword();
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
    const pass = smtpPassword();
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

  async sendAccountActivation(token: string, to: string) {
    const host = process.env.SMTP_HOST?.trim();
    const from = process.env.SMTP_FROM?.trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = smtpPassword();
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(user) !== Boolean(pass)) {
      throw new ServiceUnavailableException({ code: "smtp_not_configured", message: "Account activation email is unavailable until SMTP is configured." });
    }
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, ...(user && pass ? { auth: { user, pass } } : {}) });
    const origin = process.env.WEB_ORIGIN?.trim() || "http://localhost:3000";
    try {
      await transport.sendMail({
        from, to, subject: "Activate your Myr CRM workspace",
        text: `Set your password using this single-use link within one hour:\n\n${origin.replace(/\/$/, "")}/activate-account?token=${encodeURIComponent(token)}\n\nSign in at ${origin.replace(/\/$/, "")}/sign-in after activation.`,
      });
    } catch (error) {
      this.logger.error("Could not deliver the workspace activation email.", error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({ code: "activation_email_failed", message: "Workspace created, but activation email delivery failed." });
    }
  }

  async sendPasswordReset(token: string, to: string) {
    const host = process.env.SMTP_HOST?.trim();
    const from = process.env.SMTP_FROM?.trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = smtpPassword();
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(user) !== Boolean(pass)) {
      throw new ServiceUnavailableException({ code: "smtp_not_configured", message: "Password reset email is unavailable until SMTP is configured." });
    }
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, ...(user && pass ? { auth: { user, pass } } : {}) });
    const origin = process.env.WEB_ORIGIN?.trim() || "http://localhost:3000";
    const resetUrl = `${origin.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await transport.sendMail({
        from, to, subject: "Reset your Myr CRM password",
        text: `We received a request to reset your Myr CRM password. Use this single-use link within 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email. Your password will not change.`,
        html: `<div style="font-family:Arial,sans-serif;color:#293730;max-width:560px;margin:auto;padding:32px"><div style="color:#6856cc;font-size:18px;font-weight:700">myrcrm</div><h1 style="font-size:24px">Reset your password</h1><p>We received a request to reset your Myr CRM password. This single-use link expires in 30 minutes.</p><p><a href="${resetUrl}" style="display:inline-block;background:#6856cc;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px">Choose a new password</a></p><p style="font-size:13px;color:#697771">If you did not request this, ignore this email. Your password will not change.</p></div>`,
      });
    } catch (error) {
      this.logger.error("Could not deliver a password reset email.", error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({ code: "email_delivery_failed", message: "Password reset email could not be delivered." });
    }
  }
}
