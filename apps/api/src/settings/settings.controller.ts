import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Patch, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

const managers = new Set(["owner", "admin"]);
const currencies = ["USD", "CAD", "EUR", "GBP"] as const;
const fields = ["organizationName", "currency", "timezone", "weekStartsOn"] as const;

@Controller("settings")
export class SettingsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async get(@Req() request: HttpRequest) {
    const organizationId = this.organizationId(request);
    const [organization, settings] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }),
      this.prisma.organizationSettings.findUnique({ where: { organizationId } }),
    ]);
    if (!organization) throw new NotFoundException({ code: "not_found", message: "Organization not found" });
    return {
      data: {
        organizationId,
        organizationName: organization.name,
        currency: settings?.currency ?? "USD",
        timezone: settings?.timezone ?? "UTC",
        weekStartsOn: settings?.weekStartsOn ?? 1,
        updatedAt: settings?.updatedAt.toISOString() ?? null,
        canEdit: managers.has(request.organizationRole ?? ""),
      },
    };
  }

  @Patch()
  async update(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    const organizationId = this.organizationId(request);
    if (!request.organizationRole || !managers.has(request.organizationRole)) {
      throw new ForbiddenException({ code: "forbidden", message: "Only organization managers can change settings" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw this.invalid("A settings object is required");
    const unknownField = Object.keys(body).find((key) => !fields.includes(key as (typeof fields)[number]));
    if (unknownField) throw this.invalid(`Unknown setting: ${unknownField}`);

    const organizationName = "organizationName" in body
      ? this.text(body.organizationName, "organizationName", 160)
      : undefined;
    const settingsPatch: { currency?: string; timezone?: string; weekStartsOn?: number } = {};
    if ("currency" in body) {
      if (typeof body.currency !== "string" || !currencies.includes(body.currency as (typeof currencies)[number])) {
        throw this.invalid("currency must be USD, CAD, EUR, or GBP");
      }
      settingsPatch.currency = body.currency;
    }
    if ("timezone" in body) {
      if (typeof body.timezone !== "string" || body.timezone.length > 64) throw this.invalid("timezone must be a valid time zone");
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: body.timezone }).format(new Date());
      } catch {
        throw this.invalid("timezone must be a valid time zone");
      }
      settingsPatch.timezone = body.timezone;
    }
    if ("weekStartsOn" in body) {
      if (!Number.isInteger(body.weekStartsOn) || Number(body.weekStartsOn) < 0 || Number(body.weekStartsOn) > 6) {
        throw this.invalid("weekStartsOn must be an integer from 0 to 6");
      }
      settingsPatch.weekStartsOn = Number(body.weekStartsOn);
    }
    if (organizationName === undefined && Object.keys(settingsPatch).length === 0) {
      throw this.invalid("Provide at least one editable setting");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const organization = organizationName === undefined
        ? await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } })
        : await tx.organization.update({ where: { id: organizationId }, data: { name: organizationName }, select: { id: true, name: true } });
      if (!organization) throw new NotFoundException({ code: "not_found", message: "Organization not found" });
      const settings = await tx.organizationSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...settingsPatch },
        update: settingsPatch,
      });
      return { organization, settings };
    });
    return {
      data: {
        organizationId,
        organizationName: updated.organization.name,
        currency: updated.settings.currency,
        timezone: updated.settings.timezone,
        weekStartsOn: updated.settings.weekStartsOn,
        updatedAt: updated.settings.updatedAt.toISOString(),
        canEdit: true,
      },
    };
  }

  private organizationId(request: HttpRequest) {
    if (!request.orgId || !request.userId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }
    return request.orgId;
  }

  private text(value: unknown, field: string, maxLength: number) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      throw this.invalid(`${field} is required and must be at most ${maxLength} characters`);
    }
    return value.trim();
  }

  private invalid(message: string) {
    return new BadRequestException({ code: "validation_error", message });
  }
}