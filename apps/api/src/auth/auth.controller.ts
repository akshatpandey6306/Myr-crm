import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { Public } from "./public.decorator.js";
import { AuthEmailService } from "./email.service.js";
import { hashPassword } from "./password.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNUP_OTP_LIFETIME_MS = 10 * 60 * 1000;
const SESSION_COOKIE = "myr_session";
type CookieResponse = {
  cookie(name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; expires: Date }): void;
  clearCookie(name: string, options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string }): void;
};

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthEmailService) private readonly email: AuthEmailService,
  ) {}

  @Public()
  @Post("signup")
  async signup(
    @Body() body: { email?: unknown; password?: unknown; name?: unknown; organizationName?: unknown; accountType?: unknown },
  ) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const organizationName = typeof body?.organizationName === "string" ? body.organizationName.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const accountType = body?.accountType === "join" ? "join" : "workspace";
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !name || name.length > 120 || password.length < 8 || password.length > 128) {
      throw new BadRequestException({ code: "validation_error", message: "Enter your name, a valid email, and a password of 8 to 128 characters" });
    }
    if (accountType === "workspace" && (!organizationName || organizationName.length > 160)) {
      throw new BadRequestException({ code: "validation_error", message: "Workspace name is required and must be at most 160 characters" });
    }
    try {
      if (accountType === "join") {
        await this.prisma.user.create({
          data: { email, name, passwordHash: hashPassword(password), emailVerifiedAt: new Date() },
        });
        return {
          message: "Account created. Sign in to request access to your workspace using its join code.",
        };
      }

      if (!this.email.isConfigured()) {
        throw new ServiceUnavailableException({
          code: "smtp_not_configured",
          message: "Signup verification email is unavailable until SMTP is configured.",
        });
      }

      const user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: hashPassword(password),
          status: "PENDING",
          memberships: {
            create: {
              role: "OWNER",
              status: "PENDING",
              organization: {
                create: {
                  name: organizationName,
                  subscriptionStatus: "PENDING",
                  pipelines: {
                    create: {
                      name: "Sales pipeline",
                      isDefault: true,
                      stages: { create: ["Discovery", "Qualified", "Proposal", "Negotiation"].map((stageName, position) => ({ name: stageName, position })) },
                    },
                  },
                },
              },
            },
          },
        },
      });
      await this.issueSignupOtp(user.id, email);
      return {
        message: `A one-time verification code was sent to ${email}. Enter it to activate your workspace owner account.`,
        approvalRequired: false,
        verificationRequired: true,
      };
    } catch (error) {
      if (this.prismaCode(error) === "P2002") {
        if (accountType === "workspace") {
          const pendingOwner = await this.prisma.user.findFirst({
            where: {
              email,
              status: "PENDING",
              memberships: { some: { role: "OWNER", status: "PENDING" } },
            },
            select: { id: true, email: true },
          });
          if (pendingOwner) {
            if (!this.email.isConfigured()) {
              throw new ServiceUnavailableException({
                code: "smtp_not_configured",
                message: "Signup verification email is unavailable until SMTP is configured.",
              });
            }
            await this.issueSignupOtp(pendingOwner.id, pendingOwner.email);
            return {
              message: `A one-time verification code was sent to ${pendingOwner.email}. Enter it to activate your workspace owner account.`,
              approvalRequired: false,
              verificationRequired: true,
            };
          }
        }
        throw new ConflictException({ code: "conflict", message: "Email already registered" });
      }
      throw error;
    }
  }

  @Public()
  @Post("signup/resend-otp")
  async resendSignupOtp(@Body() body: { email?: unknown }) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
      throw new BadRequestException({ code: "validation_error", message: "Enter a valid email address" });
    }

    const user = await this.prisma.user.findFirst({
      where: { email, status: "PENDING", memberships: { some: { role: "OWNER", status: "PENDING" } } },
      select: { id: true, email: true },
    });
    if (!user) return { message: "If a workspace signup is awaiting verification, a new code will be sent." };
    if (!this.email.isConfigured()) {
      throw new ServiceUnavailableException({
        code: "smtp_not_configured",
        message: "Signup verification email is unavailable until SMTP is configured.",
      });
    }

    await this.issueSignupOtp(user.id, user.email);
    return { message: `A new verification code was sent to ${user.email}. It expires in 10 minutes.` };
  }

  @Public()
  @Post("signup/verify")
  async verifySignupOtp(@Body() body: { email?: unknown; otp?: unknown }) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(otp)) {
      throw new BadRequestException({ code: "validation_error", message: "Enter the signup email and its six-digit verification code" });
    }

    const user = await this.prisma.user.findFirst({
      where: { email, status: "PENDING", memberships: { some: { role: "OWNER", status: "PENDING" } } },
      select: { id: true },
    });
    if (!user) throw new BadRequestException({ code: "invalid_otp", message: "This verification code is invalid or expired" });

    const now = new Date();
    const emailToken = await this.prisma.emailToken.findFirst({
      where: {
        userId: user.id,
        tokenHash: this.hashToken(otp),
        purpose: "EMAIL_VERIFICATION",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (!emailToken) throw new BadRequestException({ code: "invalid_otp", message: "This verification code is invalid or expired" });

    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.emailToken.updateMany({
        where: { id: emailToken.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException({ code: "invalid_otp", message: "This verification code is invalid or expired" });
      }

      const activatedUser = await transaction.user.updateMany({
        where: { id: user.id, status: "PENDING" },
        data: { status: "ACTIVE" },
      });
      const activatedMembership = await transaction.membership.updateMany({
        where: { userId: user.id, role: "OWNER", status: "PENDING" },
        data: { status: "ACTIVE" },
      });
      if (activatedUser.count !== 1 || activatedMembership.count !== 1) {
        throw new BadRequestException({ code: "invalid_otp", message: "This verification code is invalid or expired" });
      }
      await transaction.emailToken.updateMany({
        where: { userId: user.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
        data: { consumedAt: now },
      });
    });

    return { message: "Your workspace owner account is verified and active. You can now sign in." };
  }

  @Public()
  @Post("login")
  async login(
    @Body() body: { email?: unknown; password?: unknown },
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const user = email ? await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { status: { in: ["ACTIVE", "PENDING"] } },
          include: { organization: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }) : null;
    if (!user || !this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid credentials" });
    }
    if (user.status === "PENDING") {
      throw new ForbiddenException({ code: "workspace_pending", message: "Your account signup is awaiting verification. Enter the signup verification code to activate it." });
    }
    if (user.status !== "ACTIVE") throw new UnauthorizedException({ code: "unauthorized", message: "Invalid credentials" });
    const activeMembership = user.memberships.find((membership) => membership.status === "ACTIVE");

    const session = this.newSession();
    await this.prisma.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
    response.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    const configuredPlatformEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase()
      ?? process.env.PLATFORM_ADMIN_EMAILS?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)[0]
      ?? (process.env.NODE_ENV !== "production" ? "admin@myrcrm.local" : "");
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: activeMembership ? { id: activeMembership.organization.id, name: activeMembership.organization.name } : undefined,
      isPlatformAdmin: user.email.toLowerCase() === configuredPlatformEmail,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  @Public()
  @Post("password-reset/request")
  requestPasswordReset() {
    throw new ServiceUnavailableException({
      code: "email_delivery_disabled",
      message: "Password reset by email is temporarily unavailable. Contact your platform administrator.",
    });
  }

  @Public()
  @Post("password-reset/confirm")
  async confirmPasswordReset(@Body() body: { token?: unknown; password?: unknown }) {
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (token.length > 128 || password.length < 8 || password.length > 128) {
      throw new BadRequestException({ code: "validation_error", message: "Provide a valid reset token and a password of 8 to 128 characters" });
    }
    const now = new Date();
    const emailToken = await this.prisma.emailToken.findFirst({
      where: { tokenHash: this.hashToken(token), purpose: "PASSWORD_RESET", consumedAt: null, expiresAt: { gt: now }, user: { status: "ACTIVE" } },
      select: { id: true, userId: true },
    });
    if (!emailToken) throw new BadRequestException({ code: "invalid_token", message: "This password-reset link is invalid or expired" });

    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.emailToken.updateMany({
        where: { id: emailToken.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new BadRequestException({ code: "invalid_token", message: "This password-reset link is invalid or expired" });
      await transaction.user.update({ where: { id: emailToken.userId }, data: { passwordHash: hashPassword(password) } });
      await transaction.session.updateMany({ where: { userId: emailToken.userId, revokedAt: null }, data: { revokedAt: now } });
      await transaction.emailToken.updateMany({
        where: { userId: emailToken.userId, purpose: "PASSWORD_RESET", consumedAt: null },
        data: { consumedAt: now },
      });
    });
    return { message: "Your password has been updated. Sign in with your new password." };
  }

  @Public()
  @Post("email-verification/resend")
  resendEmailVerification() {
    throw new ServiceUnavailableException({
      code: "email_delivery_disabled",
      message: "Email verification is disabled while email delivery is unavailable.",
    });
  }

  @Public()
  @Post("email-verification/confirm")
  async confirmEmailVerification(@Body() body: { token?: unknown }) {
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token || token.length > 128) throw new BadRequestException({ code: "invalid_token", message: "This verification link is invalid or expired" });
    const now = new Date();
    const emailToken = await this.prisma.emailToken.findFirst({
      where: { tokenHash: this.hashToken(token), purpose: "EMAIL_VERIFICATION", consumedAt: null, expiresAt: { gt: now }, user: { status: "ACTIVE" } },
      select: { id: true, userId: true },
    });
    if (!emailToken) throw new BadRequestException({ code: "invalid_token", message: "This verification link is invalid or expired" });
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.emailToken.updateMany({
        where: { id: emailToken.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new BadRequestException({ code: "invalid_token", message: "This verification link is invalid or expired" });
      await transaction.user.updateMany({
        where: { id: emailToken.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      await transaction.emailToken.updateMany({
        where: { userId: emailToken.userId, purpose: "EMAIL_VERIFICATION", consumedAt: null },
        data: { consumedAt: now },
      });
    });
    return { message: "Email verified. You can now sign in." };
  }

  @Post("logout")
  async logout(@Req() request: HttpRequest, @Res({ passthrough: true }) response: CookieResponse) {
    if (request.token) {
      await this.prisma.session.updateMany({
        where: { tokenHash: this.hashToken(request.token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return { ok: true };
  }

  @Get("me")
  async me(@Req() request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Missing authenticated user" });
    const user = await this.prisma.user.findUnique({
      where: { id: request.userId },
      include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true }, orderBy: { createdAt: "asc" } } },
    });
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException({ code: "unauthorized", message: "Account is unavailable" });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organizations: user.memberships.map(({ organization, role }) => ({ id: organization.id, name: organization.name, role: role.toLowerCase() })),
    };
  }

  private newSession() {
    const token = randomBytes(32).toString("base64url");
    return { token, tokenHash: this.hashToken(token), expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) };
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async issueSignupOtp(userId: string, recipientEmail: string) {
    const otp = randomInt(100000, 1000000).toString();
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.emailToken.updateMany({
        where: { userId, purpose: "EMAIL_VERIFICATION", consumedAt: null },
        data: { consumedAt: now },
      });
      await transaction.emailToken.create({
        data: {
          userId,
          tokenHash: this.hashToken(otp),
          purpose: "EMAIL_VERIFICATION",
          expiresAt: new Date(now.getTime() + SIGNUP_OTP_LIFETIME_MS),
        },
      });
    });
    await this.email.sendSignupOtp(otp, recipientEmail);
  }

  private verifyPassword(password: string, stored: string) {
    const [algorithm, saltHex, hashHex] = stored.split("$");
    if (algorithm !== "scrypt" || !saltHex || !hashHex || !password) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private prismaCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  }
}
