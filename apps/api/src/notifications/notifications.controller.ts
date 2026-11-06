import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("notifications")
export class NotificationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: HttpRequest, @Query("limit") limitValue?: string) {
    const { organizationId, userId } = this.context(request);
    const limit = limitValue === undefined ? 20 : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException({ code: "validation_error", message: "limit must be between 1 and 50" });
    }
    const recipient = { organizationId, recipientUserId: userId };
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: recipient,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, type: true, title: true, body: true, activityId: true, resourceId: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { ...recipient, readAt: null } }),
    ]);
    return {
      data: notifications.map((notification) => ({
        ...notification,
        type: notification.type.toLowerCase(),
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
      })),
      meta: { unreadCount },
    };
  }

  @Patch(":id/read")
  async markRead(@Req() request: HttpRequest, @Param("id") id: string) {
    const { organizationId, userId } = this.context(request);
    if (!uuidPattern.test(id)) throw new BadRequestException({ code: "validation_error", message: "id must be a valid ID" });
    const where = { id, organizationId, recipientUserId: userId };
    const result = await this.prisma.notification.updateMany({
      where: { ...where, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const existing = await this.prisma.notification.findFirst({ where, select: { id: true } });
      if (!existing) throw new NotFoundException({ code: "not_found", message: "Notification not found" });
    }
    return { ok: true };
  }

  @Post("read-all")
  async markAllRead(@Req() request: HttpRequest) {
    const { organizationId, userId } = this.context(request);
    const result = await this.prisma.notification.updateMany({
      where: { organizationId, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, updated: result.count };
  }

  private context(request: HttpRequest) {
    if (!request.orgId || !request.userId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }
    return { organizationId: request.orgId, userId: request.userId };
  }
}