import { Inject, Injectable } from "@nestjs/common";
import { AuditAction } from "../../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

export type AuditEvent = {
  organizationId: string;
  actorUserId: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string | null;
};

@Injectable()
export class AuditLogsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(event: AuditEvent) {
    await this.prisma.auditLog.create({ data: event });
  }
}