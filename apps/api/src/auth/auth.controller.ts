import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "myr_session";
type CookieResponse = {
  cookie(name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; expires: Date }): void;
  clearCookie(name: string, options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string }): void;
};

@Controller("auth")
export class AuthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
          data: { email, name, passwordHash: this.hashPassword(password), emailVerifiedAt: new Date() },
        });
        return {
          message: "Account created. Sign in to request access to your workspace using its join code.",
        };
      }

      const user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: this.hashPassword(password),
          emailVerifiedAt: new Date(),
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
        include: { memberships: { include: { organization: true } } },
      });
      const organization = user.memberships[0]?.organization;
      if (!organization) throw new Error("Signup did not create an owner organization membership");
      return {
        message: "Your workspace request was sent to the platform admin. You can sign in after it is approved.",
        approvalRequired: true,
        verificationRequired: false,
        organization: { id: organization.id, name: organization.name },
      };
    } catch (error) {
      if (this.prismaCode(error) === "P2002") throw new ConflictException({ code: "conflict", message: "Email already registered" });
      throw error;
    }
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
      throw new ForbiddenException({ code: "workspace_pending", message: "Your workspace signup is awaiting platform-admin approval." });
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
      await transaction.user.update({ where: { id: emailToken.userId }, data: { passwordHash: this.hashPassword(password) } });
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

  private hashPassword(password: string) {
    const salt = randomBytes(16);
    const derived = scryptSync(password, salt, 64);
    return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
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
