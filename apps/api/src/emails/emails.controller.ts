import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { requireRecordWrite } from "../auth/record-permissions.js";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthEmailService } from "../auth/email.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pageSizeLimit = 100;

@Controller("emails")
export class EmailsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthEmailService) private readonly email?: AuthEmailService,
  ) {}

  @Get()
  async list(
    @Req() request: HttpRequest,
    @Query("q") query?: string,
    @Query("page") pageValue?: string,
    @Query("pageSize") pageSizeValue?: string,
  ) {
    const { organizationId, userId } = this.context(request);
    if (query && query.length > 120) throw this.invalid("q must be at most 120 characters");
    const { page, pageSize } = this.pagination(pageValue, pageSizeValue);
    const search = query?.trim();
    const where = {
      organizationId,
      ...(request.organizationRole === "sales_rep" ? { contact: { is: { ownerUserId: userId } } } : {}),
      ...(search ? {
        OR: [
          { subject: { contains: search, mode: "insensitive" as const } },
          { recipientName: { contains: search, mode: "insensitive" as const } },
          { recipientEmail: { contains: search, mode: "insensitive" as const } },
        ],
      } : {}),
    };
    const [total, emails] = await Promise.all([
      this.prisma.emailMessage.count({ where }),
      this.prisma.emailMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contact: { select: { id: true, name: true } },
          creator: { include: { user: { select: { name: true } } } },
        },
      }),
    ]);

    return {
      data: emails.map((email) => this.present(email)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  @Post()
  async create(@Req() request: HttpRequest, @Body() body: Record<string, unknown>) {
    requireRecordWrite(request);
    const { organizationId, userId } = this.context(request);
    const contactId = this.uuid(body?.contactId, "contactId");
    const subject = this.requiredText(body?.subject, "subject", 255);
    if (/[\r\n]/.test(subject)) throw this.invalid("subject must be a single line");
    const text = this.requiredText(body?.body, "body", 20_000);
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: contactId,
        organizationId,
        archivedAt: null,
        ...(request.organizationRole === "sales_rep" ? { ownerUserId: userId } : {}),
      },
      select: { id: true, name: true, email: true },
    });
    if (!contact) throw new NotFoundException({ code: "not_found", message: "Contact not found" });

    const configured = this.email?.isConfigured() ?? false;
    const email = await this.prisma.emailMessage.create({
      data: {
        organizationId,
        contactId: contact.id,
        createdByUserId: userId,
        recipientName: contact.name,
        recipientEmail: contact.email,
        subject,
        body: text,
        deliveryStatus: configured ? "QUEUED" : "NOT_CONFIGURED",
      },
      include: {
        contact: { select: { id: true, name: true } },
        creator: { include: { user: { select: { name: true } } } },
      },
    });
    if (!configured || !this.email) return { data: this.present(email) };

    let deliveryStatus: "SENT" | "FAILED" = "SENT";
    let sentAt: Date | null = new Date();
    try {
      const sent = await this.email.send(email.recipientEmail, email.subject, email.body);
      if (!sent) {
        deliveryStatus = "FAILED";
        sentAt = null;
      }
    } catch {
      deliveryStatus = "FAILED";
      sentAt = null;
    }
    await this.prisma.emailMessage.updateMany({
      where: { id: email.id, organizationId },
      data: { deliveryStatus, sentAt },
    });
    const updated = await this.prisma.emailMessage.findFirst({
      where: { id: email.id, organizationId },
      include: {
        contact: { select: { id: true, name: true } },
        creator: { include: { user: { select: { name: true } } } },
      },
    });
    if (!updated) throw new NotFoundException({ code: "not_found", message: "Email message not found" });
    return { data: this.present(updated) };
  }

  private present(email: {
    id: string;
    contactId: string;
    recipientName: string;
    recipientEmail: string;
    subject: string;
    body: string;
    deliveryStatus: string;
    sentAt: Date | null;
    createdAt: Date;
    contact: { id: string; name: string };
    creator: { user: { name: string } };
  }) {
    return {
      id: email.id,
      contactId: email.contactId,
      contactName: email.contact.name,
      recipientName: email.recipientName,
      recipientEmail: email.recipientEmail,
      subject: email.subject,
      body: email.body,
      deliveryStatus: email.deliveryStatus.toLowerCase(),
      sentAt: email.sentAt?.toISOString() ?? null,
      createdByName: email.creator.user.name,
      createdAt: email.createdAt.toISOString(),
    };
  }

  private context(request: HttpRequest) {
    if (!request.orgId || !request.userId) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated organization context required" });
    }
    return { organizationId: request.orgId, userId: request.userId };
  }

  private requiredText(value: unknown, field: string, maxLength: number) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      throw this.invalid(`${field} is required and must be at most ${maxLength} characters`);
    }
    return value.trim();
  }

  private uuid(value: unknown, field: string) {
    if (typeof value !== "string" || !uuidPattern.test(value)) throw this.invalid(`${field} must be a valid ID`);
    return value;
  }

  private pagination(pageValue?: string, pageSizeValue?: string) {
    const page = pageValue === undefined ? 1 : Number(pageValue);
    const pageSize = pageSizeValue === undefined ? 25 : Number(pageSizeValue);
    if (!Number.isInteger(page) || page < 1) throw this.invalid("page must be a positive integer");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > pageSizeLimit) {
      throw this.invalid(`pageSize must be an integer from 1 to ${pageSizeLimit}`);
    }
    return { page, pageSize };
  }

  private invalid(message: string) {
    return new BadRequestException({ code: "validation_error", message });
  }
}
