import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { requirePipelineManagement } from "../auth/record-permissions.js";
import { PrismaService } from "../prisma/prisma.service.js";

const defaultStages = ["Discovery", "Qualified", "Proposal", "Negotiation"];

@Controller("pipelines")
export class PipelinesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: HttpRequest) {
    const organizationId = this.organizationId(request);
    const pipelines = await this.prisma.pipeline.findMany({
      where: { organizationId },
      include: { stages: { orderBy: { position: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return { data: pipelines.map((pipeline) => this.present(pipeline)) };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requirePipelineManagement(request);
    const organizationId = this.organizationId(request);
    const name = this.text(body?.name, "name", 120);
    const defaultPipeline = await this.prisma.pipeline.findFirst({ where: { organizationId, isDefault: true }, select: { id: true } });
    const pipeline = await this.prisma.pipeline.create({
      data: {
        organizationId,
        name,
        isDefault: !defaultPipeline,
        stages: { create: defaultStages.map((stageName, position) => ({ name: stageName, position })) },
      },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    return { data: this.present(pipeline) };
  }

  @Patch(":id")
  async rename(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requirePipelineManagement(request);
    const organizationId = this.organizationId(request);
    const name = this.text(body?.name, "name", 120);
    const result = await this.prisma.pipeline.updateMany({ where: { id, organizationId }, data: { name } });
    if (result.count === 0) throw new NotFoundException({ code: "not_found", message: "Pipeline not found" });
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, organizationId },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    if (!pipeline) throw new NotFoundException({ code: "not_found", message: "Pipeline not found" });
    return { data: this.present(pipeline) };
  }

  @Post(":id/stages")
  async addStage(@Req() request: HttpRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    requirePipelineManagement(request);
    const organizationId = this.organizationId(request);
    const name = this.text(body?.name, "name", 80);
    const pipeline = await this.prisma.pipeline.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!pipeline) throw new NotFoundException({ code: "not_found", message: "Pipeline not found" });
    const lastStage = await this.prisma.pipelineStage.findFirst({
      where: { organizationId, pipelineId: id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const stage = await this.prisma.pipelineStage.create({
      data: { organizationId, pipelineId: id, name, position: (lastStage?.position ?? -1) + 1 },
    });
    return { data: stage };
  }

  private present(pipeline: {
    id: string;
    name: string;
    isDefault: boolean;
    stages: { id: string; name: string; position: number }[];
  }) {
    return {
      id: pipeline.id,
      name: pipeline.name,
      isDefault: pipeline.isDefault,
      stages: pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name, position: stage.position })),
    };
  }

  private organizationId(request: HttpRequest) {
    if (!request.orgId || !request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    return request.orgId;
  }

  private text(value: unknown, field: string, maxLength: number) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      throw new BadRequestException({ code: "validation_error", message: `${field} is required and must be at most ${maxLength} characters` });
    }
    return value.trim();
  }
}
