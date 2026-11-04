import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest, HttpResponse } from "../common/http.types.js";
import { Public } from "./public.decorator.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { EmailService } from "./email.service.js";
import { isEmailVerificationRequired } from "./email-verification.js";

const SESSION_LIFETIME_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthRateLimitService) private readonly rateLimits: AuthRateLimitService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  private newToken() {
    const token = randomBytes(32).toString("base64url");
    return { token, tokenHash: this.hashToken(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  }



  @Public()
  @Post("signup")
  async signup(
    @Req() request: HttpRequest,
    @Body() body: { email?: unknown; password?: unknown; name?: unknown; organizationName?: unknown },
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const organizationName = typeof body?.organizationName === "string" ? body.organizationName.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !name || name.length > 120 || !organizationName || organizationName.length > 160 || password.length < 8 || password.length > 128) {
      throw new BadRequestException({ code: "validation_error", message: "Enter your name, a valid email, a workspace name, and a password of 8 to 128 characters" });
    }

    await this.rateLimit(`signup:${email}`, 5);

    const emailVerificationRequired = isEmailVerificationRequired();
    const verification = emailVerificationRequired ? this.newToken() : undefined;
    const session = this.newSession();
    const refreshToken = this.newRefreshToken();
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: this.hashPassword(password),
          ...(verification
            ? {
                emailVerificationTokenHash: verification.tokenHash,
                emailVerificationExpiresAt: verification.expiresAt,
              }
            : { emailVerifiedAt: new Date() }),
          memberships: {
            create: {
              role: "OWNER",
              organization: {
                create: {
                  name: organizationName,
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
          sessions: { create: { tokenHash: session.tokenHash, expiresAt: session.expiresAt } },
          refreshTokens: { create: { tokenHash: refreshToken.tokenHash, expiresAt: refreshToken.expiresAt } },
        },
        include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true } } },
      });
      const organization = user.memberships[0]?.organization;
      if (!organization) throw new Error("Signup did not create an owner organization membership");
      if (verification) await this.sendVerification(user.email, user.name, verification.token);
      this.setAuthCookies(response, session, refreshToken);
      return {
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: organization.id, name: organization.name },
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        ...(this.isBearerClient(request) ? { refreshToken: refreshToken.token } : {}),
        ...(emailVerificationRequired ? { emailVerificationRequired: true } : {}),
      };
    } catch (error) {
      if (this.prismaCode(error) === "P2002") throw new ConflictException({ code: "conflict", message: "Email already registered" });
      throw error;
    }
  }

  @Public()
  @Post("login")
  async login(
    @Req() request: HttpRequest,
    @Body() body: { email?: unknown; password?: unknown },
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (email) await this.rateLimit(`login:${email}`, 10);
    const user = email ? await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    }) : null;
    if (!user || user.status !== "ACTIVE" || !this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid credentials" });
    }
    const session = this.newSession();
    const refreshToken = this.newRefreshToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
      await tx.refreshToken.create({ data: { userId: user.id, tokenHash: refreshToken.tokenHash, expiresAt: refreshToken.expiresAt } });
    });
    this.setAuthCookies(response, session, refreshToken);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: user.memberships[0] ? { id: user.memberships[0].organization.id, name: user.memberships[0].organization.name } : undefined,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      ...(this.isBearerClient(request) ? { refreshToken: refreshToken.token } : {}),
      ...(isEmailVerificationRequired() && !user.emailVerifiedAt ? { emailVerificationRequired: true } : {}),
    };
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Req() request: HttpRequest,
    @Body() body: { refreshToken?: unknown },
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const cookieToken = this.cookieValue(request.headers.cookie, "myr.refresh");
    const presentedToken = cookieToken ?? (typeof body?.refreshToken === "string" ? body.refreshToken : "");
    if (!presentedToken) throw new UnauthorizedException({ code: "unauthorized", message: "A refresh token is required" });
    if (cookieToken && !this.hasTrustedOrigin(request.headers.origin)) {
      throw new ForbiddenException({ code: "forbidden", message: "Request origin is not allowed" });
    }

    const presentedHash = this.hashToken(presentedToken);
    const currentRefresh = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: presentedHash, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: "ACTIVE" } },
      select: { id: true, userId: true },
    });
    if (!currentRefresh) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired refresh token" });

    const session = this.newSession();
    const refreshToken = this.newRefreshToken();
    const now = new Date();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: {
          id: currentRefresh.id,
          tokenHash: presentedHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now, replacedByTokenHash: refreshToken.tokenHash },
      });
      if (revoked.count !== 1) return false;
      await tx.session.create({
        data: { userId: currentRefresh.userId, tokenHash: session.tokenHash, expiresAt: session.expiresAt },
      });
      await tx.refreshToken.create({
        data: { userId: currentRefresh.userId, tokenHash: refreshToken.tokenHash, expiresAt: refreshToken.expiresAt },
      });
      return true;
    });
    if (!rotated) throw new UnauthorizedException({ code: "unauthorized", message: "Invalid or expired refresh token" });
    this.setAuthCookies(response, session, refreshToken);
    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      ...(!cookieToken ? { refreshToken: refreshToken.token } : {}),
    };
  }

  @Post("logout")
  async logout(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    if (request.token) {
      await this.prisma.session.updateMany({
        where: { tokenHash: this.hashToken(request.token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    const refreshToken = this.cookieValue(request.headers.cookie, "myr.refresh");
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    this.clearSessionCookie(response);
    return { ok: true };
  }

  @Public()
  @Post("verify-email")
  async verifyEmail(@Body() body: { token?: unknown }) {
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) throw new BadRequestException({ code: "validation_error", message: "Verification token is required" });
    const tokenHash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({ where: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: { gt: new Date() } } });
    if (!user) throw new BadRequestException({ code: "invalid_token", message: "Invalid or expired verification token" });
    const verified = await this.prisma.user.updateMany({
      where: { id: user.id, emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: { gt: new Date() } },
      data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null },
    });
    if (verified.count !== 1) throw new BadRequestException({ code: "invalid_token", message: "Invalid or expired verification token" });
    return { ok: true };
  }

  @Public()
  @Post("request-password-reset")
  async requestPasswordReset(@Body() body: { email?: unknown }) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) throw new BadRequestException({ code: "validation_error", message: "Email is required" });
    await this.rateLimit(`reset:${email}`, 5);
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (user) {
      const reset = this.newToken();
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordResetTokenHash: reset.tokenHash, passwordResetExpiresAt: reset.expiresAt } });
      const emailSent = await this.sendPasswordReset(email, user.name, reset.token);
      return {
        ok: true,
        ...(!emailSent ? { resetToken: reset.token } : {}),
      };
    }
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  async resetPassword(@Body() body: { token?: unknown; password?: unknown }) {
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!token || password.length < 8 || password.length > 128) throw new BadRequestException({ code: "validation_error", message: "Token and a password of 8 to 128 characters are required" });
    const tokenHash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({ where: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { gt: new Date() } }, select: { id: true } });
    if (!user) throw new BadRequestException({ code: "invalid_token", message: "Invalid or expired reset token" });
    await this.prisma.$transaction(async (tx) => {
      const reset = await tx.user.updateMany({
        where: { id: user.id, passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { gt: new Date() } },
        data: { passwordHash: this.hashPassword(password), passwordResetTokenHash: null, passwordResetExpiresAt: null },
      });
      if (reset.count !== 1) throw new BadRequestException({ code: "invalid_token", message: "Invalid or expired reset token" });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { ok: true };
  }

  @Post("resend-verification")
  async resendVerification(@Req() request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const user = await this.prisma.user.findUnique({ where: { id: request.userId }, select: { id: true, email: true, name: true, emailVerifiedAt: true } });
    if (!user) throw new UnauthorizedException({ code: "unauthorized", message: "Account not found" });
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    await this.rateLimit(`verify:${user.id}`, 5);
    const verification = this.newToken();
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerificationTokenHash: verification.tokenHash, emailVerificationExpiresAt: verification.expiresAt } });
    const emailSent = await this.sendVerification(user.email, user.name, verification.token);
    return {
      ok: true,
      ...(!emailSent ? { emailVerificationToken: verification.token } : {}),
    };
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

  private newRefreshToken() {
    const token = randomBytes(32).toString("base64url");
    return { token, tokenHash: this.hashToken(token), expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS) };
  }

  private async rateLimit(key: string, limit: number) {
    await this.rateLimits.assertAllowed(key, limit, 15 * 60 * 1000);
  }

  private async sendVerification(email: string, name: string, token: string) {
    if (process.env.NODE_ENV !== "production" && !this.email.isConfigured()) return false;
    await this.email.sendVerification(email, name, token);
    return true;
  }

  private async sendPasswordReset(email: string, name: string, token: string) {
    if (process.env.NODE_ENV !== "production" && !this.email.isConfigured()) return false;
    await this.email.sendPasswordReset(email, name, token);
    return true;
  }

  private setAuthCookies(
    response: HttpResponse,
    session: ReturnType<AuthController["newSession"]>,
    refreshToken: ReturnType<AuthController["newRefreshToken"]>,
  ) {
    const sessionMaxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
    const refreshMaxAge = Math.max(0, Math.floor((refreshToken.expiresAt.getTime() - Date.now()) / 1000));
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader("Set-Cookie", [
      `myr.session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAge}${secure}`,
      `myr.refresh=${refreshToken.token}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${refreshMaxAge}${secure}`,
    ]);
  }

  private clearSessionCookie(response: HttpResponse) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader("Set-Cookie", [
      `myr.session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      `myr.refresh=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    ]);
  }

  private cookieValue(header: string | string[] | undefined, name: string) {
    if (typeof header !== "string") return undefined;
    for (const cookie of header.split(";")) {
      const separator = cookie.indexOf("=");
      if (separator >= 0 && cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
    }
    return undefined;
  }

  private isBearerClient(request: HttpRequest) {
    return request.headers["x-api-client"] === "bearer";
  }

  private hasTrustedOrigin(originHeader: string | string[] | undefined) {
    if (typeof originHeader !== "string") return false;
    try {
      const origin = new URL(originHeader).origin;
      const allowedOrigin = new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000").origin;
      return origin === allowedOrigin;
    } catch {
      return false;
    }
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
