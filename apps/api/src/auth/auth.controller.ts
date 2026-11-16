import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
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
import { TenantProvisioningService } from "../provisioning/tenant-provisioning.service.js";

const SIGNUP_OTP_LIFETIME_MS = 10 * 60 * 1000;
const SESSION_COOKIE = "myr_session";
const DEVICE_COOKIE = "myr_device";
const DEVICE_COOKIE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString("hex"));
type CookieResponse = {
  cookie(name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; expires: Date }): void;
  clearCookie(name: string, options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string }): void;
};

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthEmailService) private readonly email: AuthEmailService,
  ) {}

  @Public()
  @Post("signup")
  async signup(
    @Body() body: { email?: unknown; password?: unknown; name?: unknown; organizationName?: unknown; accountType?: unknown },
  ) {
    if (process.env.CRM_SELF_SIGNUP_ENABLED?.trim().toLowerCase() !== "true") {
      throw new ForbiddenException({
        code: "self_signup_disabled",
        message: "Self-service account creation is disabled. Workspace accounts are provisioned through the platform onboarding flow.",
      });
    }
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
                  pipelines: TenantProvisioningService.defaultPipelineCreate(),
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
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const security = await this.prisma.globalSecuritySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
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
    const passwordValid = this.verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordValid) {
      if (user && user.status === "ACTIVE" && security.failedLoginLockoutEnabled) {
        const now = new Date();
        const [updated] = await this.prisma.$queryRaw<Array<{ failed_login_attempts: number; locked_until: Date | null }>>`
          UPDATE "users" SET
            "failed_login_attempts" = CASE WHEN "locked_until" IS NOT NULL AND "locked_until" <= ${now} THEN 1 ELSE "failed_login_attempts" + 1 END,
            "locked_until" = CASE
              WHEN (CASE WHEN "locked_until" IS NOT NULL AND "locked_until" <= ${now} THEN 1 ELSE "failed_login_attempts" + 1 END) >= ${security.maxFailedLoginAttempts}
                THEN ${now} + (${security.lockoutDurationMinutes} * interval '1 minute')
              ELSE NULL
            END
          WHERE "id" = ${user.id}::uuid AND ("locked_until" IS NULL OR "locked_until" <= ${now})
          RETURNING "failed_login_attempts", "locked_until"
        `;
        if (updated?.locked_until) {
          await this.prisma.platformAuditLog.create({ data: { actorUserId: user.id, actorEmail: user.email, action: "auth.login.locked", targetType: "user", targetId: user.id, metadata: { failedAttempts: updated.failed_login_attempts, lockoutMinutes: security.lockoutDurationMinutes } } });
        }
      }
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid email or password" });
    }
    if (user.status === "PENDING") {
      throw new ForbiddenException({ code: "workspace_pending", message: "Your account signup is awaiting verification. Enter the signup verification code to activate it." });
    }
    if (user.status !== "ACTIVE") throw new UnauthorizedException({ code: "unauthorized", message: "Invalid credentials" });
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
      throw new HttpException({ code: "login_temporarily_locked", message: `Too many incorrect attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`, retryAfterSeconds }, HttpStatus.LOCKED);
    }
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }
    const activeMembership = user.memberships.find((membership) => membership.status === "ACTIVE");
    const basePlan = activeMembership?.organization.subscriptionPlan
      ? await this.prisma.subscriptionPlan.findUnique({ where: { code: activeMembership.organization.subscriptionPlan }, select: { maxDevicesPerUser: true, deviceRestrictionEnabled: true } })
      : null;
    const planOverride = activeMembership?.organization.subscriptionPlan
      ? await this.prisma.organizationSubscriptionPlanOverride?.findUnique?.({ where: { organizationId_planCode: { organizationId: activeMembership.organizationId, planCode: activeMembership.organization.subscriptionPlan } }, select: { maxDevicesPerUser: true, deviceRestrictionEnabled: true } }) ?? null
      : null;
    const planLimit = planOverride?.maxDevicesPerUser ?? basePlan?.maxDevicesPerUser;
    const planRestriction = planOverride?.deviceRestrictionEnabled ?? basePlan?.deviceRestrictionEnabled;
    const securitySettings = await this.prisma.globalSecuritySettings.findUnique({ where: { id: 1 } });
    const restrictionEnabled = securitySettings?.deviceRestrictionsEnabled !== false && planRestriction === true;
    const deviceId = this.cookieValue(request.headers.cookie, DEVICE_COOKIE);
    const deviceToken = deviceId && /^[A-Za-z0-9_-]{40,100}$/.test(deviceId) ? deviceId : randomBytes(32).toString("base64url");
    const deviceHash = this.hashToken(deviceToken);
    const sessionLifetimeMinutes = securitySettings?.sessionLifetimeMinutes ?? 7 * 24 * 60;
    const session = this.newSession();
    session.expiresAt = new Date(Date.now() + sessionLifetimeMinutes * 60 * 1000);
    const userAgent = typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"].slice(0, 500) : null;
    const deviceLabel = userAgent ? this.deviceLabel(userAgent) : "Unknown device";
    try {
      await this.prisma.$transaction(async (transaction) => {
        // Return a supported scalar instead of PostgreSQL's `void` lock result;
        // Prisma's PostgreSQL adapter cannot deserialize `void` from $queryRaw.
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0)) IS NULL AS acquired`;
        if (restrictionEnabled && planLimit) {
          const existingDevice = await transaction.session.count({ where: { userId: user.id, deviceHash, revokedAt: null, expiresAt: { gt: new Date() } } });
          if (!existingDevice) {
            const [usage] = await transaction.$queryRaw<Array<{ active_devices: bigint }>>`
              SELECT COUNT(DISTINCT "device_hash") + CASE
                WHEN COUNT(*) FILTER (WHERE "device_hash" IS NULL) > 0 THEN 1 ELSE 0
              END AS active_devices
              FROM "sessions" WHERE "user_id" = ${user.id}::uuid AND "revoked_at" IS NULL AND "expires_at" > now()
            `;
            if (Number(usage?.active_devices ?? 0) >= planLimit) {
              throw new ConflictException({ code: "device_limit_reached", message: `This plan allows ${planLimit} active device(s) per user. Sign out another device, then try again.`, maxDevices: planLimit });
            }
          }
        }
        await transaction.session.create({ data: {
          userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt,
          deviceHash, deviceLabel, userAgent,
          ipHash: request.ip ? this.hashToken(request.ip) : null,
        } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw error;
    }
    response.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    response.cookie(DEVICE_COOKIE, deviceToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(Date.now() + DEVICE_COOKIE_LIFETIME_MS) });
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

  @Get("sessions")
  async listSessions(@Req() request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const currentHash = request.token ? this.hashToken(request.token) : "";
    const sessions = await this.prisma.session.findMany({
      where: { userId: request.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, deviceLabel: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, tokenHash: true },
      orderBy: { lastSeenAt: "desc" },
    });
    return { data: sessions.map(({ tokenHash, ...session }) => ({ ...session, current: tokenHash === currentHash })) };
  }

  @Delete("sessions/:sessionId")
  async revokeSession(@Req() request: HttpRequest, @Param("sessionId") sessionId: string, @Res({ passthrough: true }) response: CookieResponse) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId: request.userId, revokedAt: null }, select: { id: true, tokenHash: true } });
    if (!session) throw new NotFoundException({ code: "not_found", message: "Active session not found" });
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    if (request.token && session.tokenHash === this.hashToken(request.token)) response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
    return { data: { id: session.id, revoked: true } };
  }

  @Post("sessions/revoke-others")
  async revokeOtherSessions(@Req() request: HttpRequest) {
    if (!request.userId || !request.token) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    const currentHash = this.hashToken(request.token);
    const result = await this.prisma.session.updateMany({ where: { userId: request.userId, tokenHash: { not: currentHash }, revokedAt: null }, data: { revokedAt: new Date() } });
    return { data: { revokedCount: result.count } };
  }

  @Public()
  @Post("password-reset/request")
  async requestPasswordReset(@Body() body: { email?: unknown }) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
      throw new BadRequestException({ code: "validation_error", message: "Enter a valid email address" });
    }
    const genericMessage = "If an active account uses that email, a password reset link will be sent.";
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true, status: true } });
    if (!user || user.status !== "ACTIVE") {
      this.logger.debug("Password reset skipped because the submitted address has no active account");
      return { message: genericMessage };
    }
    if (!this.email.isConfigured()) {
      this.logger.error("Password reset skipped because SMTP is not configured in the running API process");
      return { message: genericMessage };
    }
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.emailToken.updateMany({ where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null }, data: { consumedAt: now } });
      await transaction.emailToken.create({ data: { userId: user.id, tokenHash: this.hashToken(token), purpose: "PASSWORD_RESET", expiresAt: new Date(now.getTime() + 30 * 60 * 1000) } });
    });
    try {
      await this.email.sendPasswordReset(token, user.email);
      this.logger.log("Password reset email accepted by the SMTP transport");
    } catch {
      // Keep the response identical so callers cannot discover registered emails.
      this.logger.error("Password reset delivery failed; public response remains generic");
    }
    return { message: genericMessage };
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
      await transaction.user.update({ where: { id: emailToken.userId }, data: { passwordHash: hashPassword(password), failedLoginAttempts: 0, lockedUntil: null } });
      await transaction.session.updateMany({ where: { userId: emailToken.userId, revokedAt: null }, data: { revokedAt: now } });
      await transaction.emailToken.updateMany({
        where: { userId: emailToken.userId, purpose: "PASSWORD_RESET", consumedAt: null },
        data: { consumedAt: now },
      });
    });
    return { message: "Your password has been updated. Sign in with your new password." };
  }

  @Public()
  @Post("account-activation")
  async activateProvisionedAccount(@Body() body: { token?: unknown; password?: unknown }) {
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!token || token.length > 128 || password.length < 8 || password.length > 128) {
      throw new BadRequestException({ code: "validation_error", message: "Provide a valid activation token and a password of 8 to 128 characters" });
    }
    const now = new Date();
    const emailToken = await this.prisma.emailToken.findFirst({
      where: { tokenHash: this.hashToken(token), purpose: "ACCOUNT_ACTIVATION", consumedAt: null, expiresAt: { gt: now }, user: { status: "PENDING" } },
      select: { id: true, userId: true },
    });
    if (!emailToken) throw new BadRequestException({ code: "invalid_token", message: "This activation link is invalid or expired" });
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.emailToken.updateMany({ where: { id: emailToken.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new BadRequestException({ code: "invalid_token", message: "This activation link is invalid or expired" });
      const user = await transaction.user.updateMany({ where: { id: emailToken.userId, status: "PENDING" }, data: { passwordHash: hashPassword(password), status: "ACTIVE", emailVerifiedAt: now } });
      const membership = await transaction.membership.updateMany({ where: { userId: emailToken.userId, role: "OWNER", status: "PENDING" }, data: { status: "ACTIVE" } });
      if (user.count !== 1 || membership.count !== 1) throw new BadRequestException({ code: "invalid_token", message: "This activation link is invalid or expired" });
      await transaction.emailToken.updateMany({ where: { userId: emailToken.userId, purpose: "ACCOUNT_ACTIVATION", consumedAt: null }, data: { consumedAt: now } });
    });
    return { message: "Your account is active. You can now sign in." };
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
    return { token, tokenHash: this.hashToken(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
  }

  private cookieValue(header: string | string[] | undefined, name: string) {
    if (typeof header !== "string") return undefined;
    const cookie = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return cookie?.slice(name.length + 1);
  }

  private deviceLabel(userAgent: string) {
    const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
    const platform = /Windows/i.test(userAgent) ? "Windows" : /Android/i.test(userAgent) ? "Android" : /iPhone|iPad/i.test(userAgent) ? "iOS" : /Mac OS/i.test(userAgent) ? "macOS" : /Linux/i.test(userAgent) ? "Linux" : "device";
    return `${browser} on ${platform}`;
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
