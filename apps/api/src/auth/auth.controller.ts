import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { BadRequestException, Body, ConflictException, Controller, Get, HttpException, HttpStatus, Inject, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest, HttpResponse } from "../common/http.types.js";
import { Public } from "./public.decorator.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

@Controller("auth")
export class AuthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();

  private rateLimit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const entry = this.rateLimits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (entry.count >= limit) {
      throw new HttpException({ code: "rate_limited", message: "Too many requests. Try again later." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    entry.count += 1;
  }

  private newToken() {
    const token = randomBytes(32).toString("base64url");
    return { token, tokenHash: this.hashToken(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  }



  @Public()
  @Post("signup")
  async signup(
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

    this.rateLimit(`signup:${email}`, 5, 15 * 60 * 1000);

    const verification = this.newToken();
    const session = this.newSession();
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: this.hashPassword(password),
          emailVerificationTokenHash: verification.tokenHash,
          emailVerificationExpiresAt: verification.expiresAt,
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
        },
        include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true } } },
      });
      const organization = user.memberships[0]?.organization;
      if (!organization) throw new Error("Signup did not create an owner organization membership");
      this.setSessionCookie(response, session.token, session.expiresAt);
      return {
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: organization.id, name: organization.name },
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
         emailVerificationToken: verification.token,
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
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const user = email ? await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    }) : null;
    if (!user || user.status !== "ACTIVE" || !this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid credentials" });
    }
    this.rateLimit(`login:${email}`, 10, 15 * 60 * 1000);
    const session = this.newSession();
    await this.prisma.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
    this.setSessionCookie(response, session.token, session.expiresAt);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: user.memberships[0] ? { id: user.memberships[0].organization.id, name: user.memberships[0].organization.name } : undefined,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
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
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null } });
    return { ok: true };
  }

  @Public()
  @Post("request-password-reset")
  async requestPasswordReset(@Body() body: { email?: unknown }) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) throw new BadRequestException({ code: "validation_error", message: "Email is required" });
    this.rateLimit(`reset:${email}`, 5, 15 * 60 * 1000);
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const reset = this.newToken();
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordResetTokenHash: reset.tokenHash, passwordResetExpiresAt: reset.expiresAt } });
      // In production, email this token. Returned for local/dev verification.
      return { ok: true, resetToken: reset.token };
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
    const user = await this.prisma.user.findFirst({ where: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { gt: new Date() } } });
    if (!user) throw new BadRequestException({ code: "invalid_token", message: "Invalid or expired reset token" });
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: this.hashPassword(password), passwordResetTokenHash: null, passwordResetExpiresAt: null } });
    return { ok: true };
  }

  @Post("resend-verification")
  async resendVerification(@Req() request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const user = await this.prisma.user.findUnique({ where: { id: request.userId }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (!user) throw new UnauthorizedException({ code: "unauthorized", message: "Account not found" });
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    this.rateLimit(`verify:${user.id}`, 5, 15 * 60 * 1000);
    const verification = this.newToken();
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerificationTokenHash: verification.tokenHash, emailVerificationExpiresAt: verification.expiresAt } });
    return { ok: true, emailVerificationToken: verification.token };
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

  private setSessionCookie(response: HttpResponse, token: string, expiresAt: Date) {
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader("Set-Cookie", `myr.session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  }

  private clearSessionCookie(response: HttpResponse) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader("Set-Cookie", `myr.session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
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
