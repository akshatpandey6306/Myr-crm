import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

const triggers = ["lead_created", "lead_status_changed"] as const;
const leadStatuses = ["new", "contacted", "qualified", "disqualified"] as const;
const priorities = ["low", "normal", "high"] as const;
const managers = new Set(["owner", "admin", "sales_manager"]);

type LeadStatus = (typeof leadStatuses)[number];
type Priority = (typeof priorities)[number];
type RuleInput = {
  name: string;
  trigger: "LEAD_CREATED" | "LEAD_STATUS_CHANGED";
  triggerStatus: "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED" | null;
  activityTitle: string;
  activityPriority: "LOW" | "NORMAL" | "HIGH";
  dueInDays: number;
};

@Controller("automations")
export class AutomationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: HttpRequest) {
    const { organizationId } = this.context(request);
    const rules = await this.prisma.automationRule.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { runs: true } },
        runs: { orderBy: { ranAt: "desc" }, take: 1, select: { ranAt: true } },
      },
    });
    return { data: rules.map((rule) => this.present(rule)) };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    this.requireManager(request);
    const { organizationId, userId } = this.context(request);
    const input = this.ruleInput(body);
    const rule = await this.prisma.automationRule.create({
      data: {
        ...input,
        organizationId,
        createdByUserId: userId,
      },
      include: {
        _count: { select: { runs: true } },
        runs: { orderBy: { ranAt: "desc" }, take: 1, select: { ranAt: true } },
      },
    });
    return { data: this.present(rule) };
  }

  @Patch(":id")
  async update(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    this.requireManager(request);
    const { organizationId } = this.context(request);
    if (typeof body?.enabled !== "boolean") throw this.invalid("enabled must be a boolean");
    const result = await this.prisma.automationRule.updateMany({
      where: { id, organizationId, archivedAt: null },
      data: { enabled: body.enabled },
    });
    if (result.count === 0) throw this.notFound();
    const rule = await this.prisma.automationRule.findFirst({
      where: { id, organizationId, archivedAt: null },
      include: {
        _count: { select: { runs: true } },
        runs: { orderBy: { ranAt: "desc" }, take: 1, select: { ranAt: true } },
      },
    });
    if (!rule) throw this.notFound();
    return { data: this.present(rule) };
  }

  @Get(":id/runs")
  async runs(@Req() request: HttpRequest, @Param("id") id: string) {
    const { organizationId } = this.context(request);
    const rule = await this.prisma.automationRule.findFirst({
      where: { id, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!rule) throw this.notFound();
    const runs = await this.prisma.automationRun.findMany({
      where: { ruleId: rule.id, organizationId },
      orderBy: { ranAt: "desc" },
      take: 50,
      include: { lead: { select: { id: true, name: true, company: true } } },
    });
    return {
      data: runs.map((run) => ({
        id: run.id,
        leadId: run.leadId,
        leadName: run.lead.name,
        leadCompany: run.lead.company,
        activityId: run.activityId,
        ranAt: run.ranAt.toISOString(),
      })),
    };
  }

  @Delete(":id")
  async archive(@Req() request: HttpRequest, @Param("id") id: string) {
    this.requireManager(request);
    const { organizationId } = this.context(request);
    const result = await this.prisma.automationRule.updateMany({
      where: { id, organizationId, archivedAt: null },
      data: { archivedAt: new Date(), enabled: false },
    });
    if (result.count === 0) throw this.notFound();
    return { ok: true };
  }

  private ruleInput(body: Record<string, unknown>): RuleInput {
    const name = this.text(body?.name, "name", 120);
    const trigger = this.enumValue(body?.trigger, triggers, "trigger");
    const activityTitle = this.text(body?.activityTitle, "activityTitle", 160);
    const priority = body?.activityPriority ?? "normal";
    if (!priorities.includes(priority as Priority)) throw this.invalid("Invalid activityPriority value");

    let triggerStatus: RuleInput["triggerStatus"] = null;
    if (trigger === "lead_status_changed") {
      const status = this.enumValue(body?.triggerStatus, leadStatuses, "triggerStatus");
      triggerStatus = status.toUpperCase() as NonNullable<RuleInput["triggerStatus"]>;
    } else if (body?.triggerStatus !== undefined && body.triggerStatus !== null && body.triggerStatus !== "") {
      throw this.invalid("triggerStatus is only allowed for lead_status_changed");
    }

    const dueInDays = body?.dueInDays ?? 1;
    if (typeof dueInDays !== "number" || !Number.isInteger(dueInDays) || dueInDays < 0 || dueInDays > 365) {
      throw this.invalid("dueInDays must be an integer from 0 to 365");
    }

    return {
      name,
      trigger: trigger === "lead_created" ? "LEAD_CREATED" : "LEAD_STATUS_CHANGED",
      triggerStatus,
      activityTitle,
      activityPriority: (priority as Priority).toUpperCase() as RuleInput["activityPriority"],
      dueInDays,
    };
  }

  private present(rule: {
    id: string;
    name: string;
    trigger: string;
    triggerStatus: string | null;
    activityTitle: string;
    activityPriority: string;
    dueInDays: number;
    enabled: boolean;
    createdAt: Date;
    _count: { runs: number };
    runs: Array<{ ranAt: Date }>;
  }) {
    return {
      id: rule.id,
      name: rule.name,
      trigger: rule.trigger.toLowerCase(),
      triggerStatus: rule.triggerStatus?.toLowerCase() ?? null,
      activityTitle: rule.activityTitle,
      activityPriority: rule.activityPriority.toLowerCase(),
      dueInDays: rule.dueInDays,
      enabled: rule.enabled,
      runCount: rule._count.runs,
      lastRunAt: rule.runs[0]?.ranAt.toISOString() ?? null,
      createdAt: rule.createdAt.toISOString(),
    };
  }

  private text(value: unknown, field: string, maxLength: number) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      throw this.invalid(`${field} is required and must be at most ${maxLength} characters`);
    }
    return value.trim();
  }

  private enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
    if (typeof value !== "string" || !values.includes(value as T)) throw this.invalid(`Invalid ${field} value`);
    return value as T;
  }

  private context(request: HttpRequest) {
    if (!request.orgId || !request.userId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }
    return { organizationId: request.orgId, userId: request.userId };
  }

  private requireManager(request: HttpRequest) {
    if (!request.organizationRole || !managers.has(request.organizationRole)) {
      throw new ForbiddenException({ code: "forbidden", message: "Your organization role cannot manage automations" });
    }
  }

  private invalid(message: string) {
    return new BadRequestException({ code: "validation_error", message });
  }

  private notFound() {
    return new NotFoundException({ code: "not_found", message: "Automation rule not found" });
  }
}
