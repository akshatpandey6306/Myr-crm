import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

function smtpPassword() {
  const password = process.env.SMTP_PASSWORD ?? "";
  return process.env.SMTP_HOST?.trim().toLowerCase() === "smtp.gmail.com"
    ? password.replace(/\s+/g, "")
    : password;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
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
        subject: "LeadPilot workspace signup verification code",
        text: `Your LeadPilot workspace signup verification code is ${otp}. It expires in 10 minutes.`,
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
        from, to, subject: "Set up your LeadPilot account",
        text: `A LeadPilot workspace invited you. Set your password using this single-use link within one hour:\n\n${origin.replace(/\/$/, "")}/activate-account?token=${encodeURIComponent(token)}\n\nSign in at ${origin.replace(/\/$/, "")}/sign-in after activation.`,
      });
    } catch (error) {
      this.logger.error("Could not deliver the workspace activation email.", error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({ code: "activation_email_failed", message: "Workspace created, but activation email delivery failed." });
    }
  }

  async sendWorkspaceWelcome(input: { to: string; ownerName: string; organizationName: string; password: string }) {
    const host = process.env.SMTP_HOST?.trim();
    const from = process.env.SMTP_FROM?.trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = smtpPassword();
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(user) !== Boolean(pass)) {
      throw new ServiceUnavailableException({ code: "smtp_not_configured", message: "Workspace welcome email is unavailable until SMTP is configured." });
    }
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, ...(user && pass ? { auth: { user, pass } } : {}) });
    const origin = process.env.WEB_ORIGIN?.trim() || "http://localhost:3000";
    const safeOrigin = origin.replace(/\/$/, "");
    const signInUrl = `${safeOrigin}/sign-in`;
    const logoUrl = `${safeOrigin}/leadpilot-advance-solution.svg`;
    const ownerName = escapeHtml(input.ownerName);
    const organizationName = escapeHtml(input.organizationName);
    const password = escapeHtml(input.password);
    try {
      await transport.sendMail({
        from,
        to: input.to,
        subject: `Welcome to LeadPilot — ${input.organizationName}`,
        text: `Hi ${input.ownerName},\n\nYour LeadPilot workspace “${input.organizationName}” is ready.\n\nLogin email: ${input.to}\nPassword: ${input.password}\nSign in: ${signInUrl}\n\nKeep this email private. You can change your password after signing in.`,
        html: `<div style="font-family:Arial,sans-serif;color:#293730;max-width:560px;margin:auto;padding:32px"><img src="${logoUrl}" alt="LeadPilot by Advance Solution" width="280" style="display:block;width:280px;max-width:100%;height:auto;margin:0 0 24px"><p style="color:#17176f;font-weight:700">LeadPilot workspace</p><h1 style="font-size:24px">Welcome, ${ownerName}</h1><p>Your <strong>${organizationName}</strong> workspace is ready.</p><div style="background:#f7f5ff;border:1px solid #e3defa;border-radius:10px;padding:16px"><p><strong>Login email:</strong> ${escapeHtml(input.to)}</p><p><strong>Password:</strong> ${password}</p></div><p><a href="${signInUrl}" style="display:inline-block;background:#17176f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px">Sign in to LeadPilot</a></p><p>Keep this email private. You can change your password after signing in.</p></div>`,
      });
    } catch (error) {
      this.logger.error("Could not deliver a workspace welcome email.", error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({ code: "welcome_email_failed", message: "Workspace was created, but the welcome email could not be delivered." });
    }
  }

  async sendSubscriptionPaymentNotice(input: {
    to: string;
    recipientName: string;
    organizationName: string;
    planName: string;
    paymentType: string;
    seatQuantity?: number | null;
    amount: string;
    currency: string;
    transactionId: string;
    paymentReference: string | null;
    features: string[];
    modules: string[];
    startsAt: Date | null;
    endsAt: Date | null;
  }) {
    const host = process.env.SMTP_HOST?.trim();
    const from = process.env.SMTP_FROM?.trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = smtpPassword();
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(user) !== Boolean(pass)) {
      throw new ServiceUnavailableException({ code: "smtp_not_configured", message: "Subscription email is unavailable until SMTP is configured." });
    }
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, ...(user && pass ? { auth: { user, pass } } : {}) });
    const origin = (process.env.WEB_ORIGIN?.trim() || "http://localhost:3000").replace(/\/$/, "");
    const logoUrl = `${origin}/leadpilot-advance-solution.svg`;
    const footerLogoUrl = `${origin}/advance-solution-receipt.svg`;
    const period = (value: Date | null) => value ? value.toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "UTC" }) : "Not available";
    const typeLabel = input.paymentType === "RENEWAL" ? "renewal" : input.paymentType === "SEAT_ADDON" ? "additional seat purchase" : "plan purchase or upgrade";
    const benefits = input.features.length ? input.features : input.modules.map((module) => module.replaceAll("-", " "));
    const moduleNames = input.modules.map((module) => module.replaceAll("-", " "));
    const benefitsText = benefits.length ? benefits.map((benefit) => `- ${benefit}`).join("\n") : "See your Subscription page for plan benefits.";
    const modulesText = moduleNames.length ? moduleNames.map((module) => `- ${module}`).join("\n") : "See your Subscription page for included modules.";
    const safe = {
      recipientName: escapeHtml(input.recipientName),
      organizationName: escapeHtml(input.organizationName),
      planName: escapeHtml(input.planName),
      amount: escapeHtml(input.amount),
      currency: escapeHtml(input.currency),
      typeLabel: escapeHtml(typeLabel),
      startsAt: escapeHtml(period(input.startsAt)),
      endsAt: escapeHtml(period(input.endsAt)),
      transactionId: escapeHtml(input.transactionId),
      paymentReference: escapeHtml(input.paymentReference ?? "Not provided"),
    };
    const benefitsHtml = benefits.length
      ? `<ul style="margin:8px 0 0;padding-left:20px;color:#46564f">${benefits.map((benefit) => `<li style="padding:3px 0">${escapeHtml(benefit)}</li>`).join("")}</ul>`
      : "<p style=\"margin:8px 0 0;color:#697771\">View your Subscription page for this plan's benefits.</p>";
    const modulesHtml = moduleNames.length
      ? `<div style="margin-top:10px">${moduleNames.map((module) => `<span style="display:inline-block;background:#fff;border:1px solid #e3defa;border-radius:16px;padding:6px 10px;margin:0 6px 6px 0;color:#4c438b;font-size:12px">${escapeHtml(module)}</span>`).join("")}</div>`
      : "<p style=\"margin:8px 0 0;color:#697771\">No module list is configured for this plan.</p>";
    try {
      await transport.sendMail({
        from,
        to: input.to,
        subject: `Subscription ${typeLabel} confirmed · ${input.organizationName}`,
        text: `LEADPILOT · PAYMENT RECEIPT\n\nHi ${input.recipientName}, PayU verified your ${typeLabel} for ${input.organizationName}.\n\nPlan: ${input.planName}\n${input.seatQuantity ? `Additional seats: ${input.seatQuantity}\n` : ""}Amount paid: ${input.currency} ${input.amount}\nPlan starts: ${period(input.startsAt)}\nPlan expires: ${period(input.endsAt)}\nTransaction: ${input.transactionId}\nPayU / bank reference: ${input.paymentReference ?? "Not provided"}\n\nPlan benefits\n${benefitsText}\n\nIncluded modules\n${modulesText}\n\nManage subscription: ${origin}/subscription\n\nLeadPilot by Advance Solution`,
        html: `<div style="font-family:Arial,sans-serif;color:#293730;max-width:640px;margin:24px auto;border:1px solid #e3defa;border-radius:16px;overflow:hidden;background:#fff"><div style="padding:26px 30px 18px;border-bottom:1px solid #eceaf4"><img src="${logoUrl}" alt="LeadPilot by Advance Solution" width="260" style="display:block;width:260px;max-width:100%;height:auto"><p style="margin:16px 0 0;color:#23815c;font-weight:700;font-size:12px;letter-spacing:1px">PAYMENT VERIFIED</p><h1 style="font-size:24px;margin:8px 0">Subscription ${safe.typeLabel} confirmed</h1><p style="margin:0;color:#697771">Hi ${safe.recipientName}, your workspace subscription payment is verified.</p></div><div style="padding:22px 30px"><div style="border:1px solid #e3defa;border-radius:12px;background:#faf9ff;padding:16px 18px"><p style="margin:0 0 12px;color:#77728f;font-size:11px;font-weight:700;letter-spacing:1px">PAYMENT RECEIPT</p><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:7px 0;color:#697771">Workspace</td><td style="padding:7px 0;text-align:right;font-weight:600">${safe.organizationName}</td></tr><tr><td style="padding:7px 0;color:#697771">Plan</td><td style="padding:7px 0;text-align:right;font-weight:600">${safe.planName}</td></tr>${input.seatQuantity ? `<tr><td style="padding:7px 0;color:#697771">Additional seats</td><td style="padding:7px 0;text-align:right;font-weight:600">${input.seatQuantity}</td></tr>` : ""}<tr><td style="padding:7px 0;color:#697771">Amount paid</td><td style="padding:7px 0;text-align:right;font-weight:700">${safe.currency} ${safe.amount}</td></tr><tr><td style="padding:7px 0;color:#697771">Plan starts</td><td style="padding:7px 0;text-align:right">${safe.startsAt}</td></tr><tr><td style="padding:7px 0;color:#697771">Plan expires</td><td style="padding:7px 0;text-align:right">${safe.endsAt}</td></tr></table><div style="border-top:1px solid #e7e3f3;margin-top:8px;padding-top:10px;font-size:11px;color:#697771;overflow-wrap:anywhere">Transaction: ${safe.transactionId}<br>PayU / bank reference: ${safe.paymentReference}</div></div><section style="margin-top:22px"><h2 style="font-size:17px;margin:0">Plan benefits</h2>${benefitsHtml}</section><section style="margin-top:20px"><h2 style="font-size:17px;margin:0">Included modules</h2>${modulesHtml}</section><p style="margin:24px 0 4px"><a href="${origin}/subscription" style="display:inline-block;background:#6856cc;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">View subscription</a></p></div><div style="background:#fff;border-top:1px solid #eceaf4;padding:18px 24px;text-align:center"><img src="${footerLogoUrl}" alt="Advance Solution" width="300" style="display:block;width:300px;max-width:100%;height:auto;margin:0 auto"><p style="font-size:11px;color:#8a8b99;margin:10px 0 0">LeadPilot workspace billing · Keep this email for your records.</p></div></div>`,
      });
    } catch (error) {
      this.logger.error("Could not deliver a subscription payment email.", error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({ code: "subscription_email_failed", message: "Subscription payment was confirmed, but the email could not be delivered." });
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
        from, to, subject: "Reset your LeadPilot password",
        text: `We received a request to reset your LeadPilot password. Use this single-use link within 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email. Your password will not change.`,
        html: `<div style="font-family:Arial,sans-serif;color:#293730;max-width:560px;margin:auto;padding:32px"><img src="${origin.replace(/\/$/, "")}/leadpilot-advance-solution.svg" alt="LeadPilot by Advance Solution" width="280" style="display:block;width:280px;max-width:100%;height:auto;margin:0 0 24px"><p style="color:#17176f;font-weight:700">LeadPilot</p><h1 style="font-size:24px">Reset your password</h1><p>We received a request to reset your LeadPilot password. This single-use link expires in 30 minutes.</p><p><a href="${resetUrl}" style="display:inline-block;background:#17176f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px">Choose a new password</a></p><p style="font-size:13px;color:#697771">If you did not request this, ignore this email. Your password will not change.</p></div>`,
      });
    } catch (error) {
      this.logger.error("Could not deliver a password reset email.", error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({ code: "email_delivery_failed", message: "Password reset email could not be delivered." });
    }
  }
}
