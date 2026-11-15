import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: {
    actorUserId?: string | null;
    actorEmail?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    reason?: string | null;
    metadata?: unknown;
  }) {
    await this.prisma.platformAuditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        reason: input.reason ?? null,
        metadata: input.metadata === undefined ? undefined : (input.metadata as never),
      },
    });
  }

  async list(limit = 100) {
    return this.prisma.platformAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }
}
