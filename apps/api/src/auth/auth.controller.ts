import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HttpRequest } from "../common/http.types.js";
import { Public } from "./public.decorator.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

@Controller("auth")
export class AuthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Post("signup")
  async signup(@Body() body: { email?: unknown; password?: unknown; name?: unknown; organizationName?: unknown }) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const organizationName = typeof body?.organizationName === "string" ? body.organizationName.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !name || name.length > 120 || !organizationName || organizationName.length > 160 || password.length < 8 || password.length > 128) {
      throw new BadRequestException({ code: "validation_error", message: "Enter your name, a valid email, a workspace name, and a password of 8 to 128 characters" });
    }

    const session = this.newSession();
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: this.hashPassword(password),
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
      return {
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: organization.id, name: organization.name },
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
      };
    } catch (error) {
      if (this.prismaCode(error) === "P2002") throw new ConflictException({ code: "conflict", message: "Email already registered" });
      throw error;
    }
  }

  @Public()
  @Post("login")
  async login(@Body() body: { email?: unknown; password?: unknown }) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const user = email ? await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    }) : null;
    if (!user || user.status !== "ACTIVE" || !this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid credentials" });
    }
    const session = this.newSession();
    await this.prisma.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: user.memberships[0] ? { id: user.memberships[0].organization.id, name: user.memberships[0].organization.name } : undefined,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  @Post("logout")
  async logout(@Req() request: HttpRequest) {
    if (request.token) {
      await this.prisma.session.updateMany({
        where: { tokenHash: this.hashToken(request.token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
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
