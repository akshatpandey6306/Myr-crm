import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Patch, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

const managers = new Set(["owner", "admin"]);
const currencies = ["USD", "CAD", "EUR", "GBP", "INR", "AUD", "JPY", "SGD"] as const;
const themes = ["default", "ocean", "forest", "sunset", "rose", "slate", "amber", "teal", "berry", "midnight"] as const;
const dateFormats = ["DD MMM YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"] as const;
const timeFormats = ["12h", "24h"] as const;
const fields = ["organizationName", "currency", "timezone", "weekStartsOn", "dateFormat", "timeFormat", "crmTheme"] as const;

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
        dateFormat: settings?.dateFormat ?? "DD MMM YYYY",
        timeFormat: settings?.timeFormat ?? "12h",
        crmTheme: settings?.crmTheme ?? "default",
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
    const settingsPatch: { currency?: string; timezone?: string; weekStartsOn?: number; dateFormat?: string; timeFormat?: string; crmTheme?: string } = {};
    if ("currency" in body) {
      if (typeof body.currency !== "string" || !currencies.includes(body.currency as (typeof currencies)[number])) {
        throw this.invalid("currency must be a supported three-letter currency code");
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
    if ("dateFormat" in body) {
      if (typeof body.dateFormat !== "string" || !dateFormats.includes(body.dateFormat as (typeof dateFormats)[number])) {
        throw this.invalid("dateFormat must be a supported date format");
      }
      settingsPatch.dateFormat = body.dateFormat;
    }
    if ("timeFormat" in body) {
      if (typeof body.timeFormat !== "string" || !timeFormats.includes(body.timeFormat as (typeof timeFormats)[number])) {
        throw this.invalid("timeFormat must be 12h or 24h");
      }
      settingsPatch.timeFormat = body.timeFormat;
    }
    if ("crmTheme" in body) {
      if (typeof body.crmTheme !== "string" || !themes.includes(body.crmTheme as (typeof themes)[number])) {
        throw this.invalid("crmTheme must be a supported CRM color theme");
      }
      settingsPatch.crmTheme = body.crmTheme;
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
        dateFormat: updated.settings.dateFormat,
        timeFormat: updated.settings.timeFormat,
        crmTheme: updated.settings.crmTheme,
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
