import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { EmailsController } from "../src/emails/emails.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const contactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const request = (role: "owner" | "admin" | "sales_manager" | "sales_rep" | "read_only" = "owner") => ({
  userId,
  orgId: organizationId,
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/emails",
});

const emailMessage = (overrides: Record<string, unknown> = {}) => ({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  contactId,
  recipientName: "Olivia Rhye",
  recipientEmail: "olivia@example.com",
  subject: "Follow-up",
  body: "Thanks for your time.",
  deliveryStatus: "NOT_CONFIGURED",
  sentAt: null,
  createdAt: new Date("2026-10-29T10:00:00.000Z"),
  contact: { id: contactId, name: "Olivia Rhye" },
  creator: { user: { name: "Alex Morgan" } },
  ...overrides,
});

describe("EmailsController", () => {
  it("lists messages only for the verified organization and assigned contacts", async () => {
    let where: Record<string, unknown> | undefined;
    const controller = new EmailsController({
      emailMessage: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 1; },
        findMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where;
          return [emailMessage()];
        },
      },
    } as never);

    const result = await controller.list(request("sales_rep"), "Olivia", "2", "10");

    assert.deepEqual(where?.contact, { is: { ownerUserId: userId } });
    assert.equal(where?.organizationId, organizationId);
    assert.deepEqual(where?.OR, [
      { subject: { contains: "Olivia", mode: "insensitive" } },
      { recipientName: { contains: "Olivia", mode: "insensitive" } },
      { recipientEmail: { contains: "Olivia", mode: "insensitive" } },
    ]);
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 10);
    assert.equal(result.data[0].deliveryStatus, "not_configured");
    assert.equal(result.data[0].sentAt, null);
  });

  it("creates an unsent outbox entry using the verified user and contact details", async () => {
    let contactWhere: Record<string, unknown> | undefined;
    let createArgs: Record<string, unknown> | undefined;
    const controller = new EmailsController({
      contact: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          contactWhere = args.where;
          return { id: contactId, name: "Olivia Rhye", email: "olivia@example.com" };
        },
      },
      emailMessage: {
        create: async (args: Record<string, unknown>) => {
          createArgs = args;
          return emailMessage();
        },
      },
    } as never);

    const result = await controller.create(request("sales_rep"), {
      contactId,
      subject: " Follow-up ",
      body: " Thanks for your time. ",
      organizationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      createdByUserId: otherUserId,
      recipientEmail: "attacker@example.com",
      deliveryStatus: "SENT",
    });

    assert.deepEqual(contactWhere, {
      id: contactId,
      organizationId,
      archivedAt: null,
      ownerUserId: userId,
    });
    assert.deepEqual(createArgs?.data, {
      organizationId,
      contactId,
      createdByUserId: userId,
      recipientName: "Olivia Rhye",
      recipientEmail: "olivia@example.com",
      subject: "Follow-up",
      body: "Thanks for your time.",
      deliveryStatus: "NOT_CONFIGURED",
    });
    assert.equal(result.data.deliveryStatus, "not_configured");
    assert.equal(result.data.recipientEmail, "olivia@example.com");
  });

  it("does not allow read-only users to create email messages", async () => {
    const controller = new EmailsController({} as never);
    await assert.rejects(
      controller.create(request("read_only"), { contactId, subject: "Hello", body: "Message" }),
      ForbiddenException,
    );
  });

  it("returns not found for an inaccessible contact without revealing its tenant", async () => {
    const controller = new EmailsController({
      contact: { findFirst: async () => null },
      emailMessage: {},
    } as never);
    await assert.rejects(
      controller.create(request("sales_rep"), { contactId, subject: "Hello", body: "Message" }),
      NotFoundException,
    );
  });

  it("validates subject, body, contact ID, and pagination", async () => {
    const controller = new EmailsController({ contact: {}, emailMessage: {} } as never);
    await assert.rejects(
      controller.create(request(), { contactId, subject: "Bad\nSubject", body: "Message" }),
      BadRequestException,
    );
    await assert.rejects(
      controller.create(request(), { contactId, subject: "Hello", body: " " }),
      BadRequestException,
    );
    await assert.rejects(
      controller.create(request(), { contactId: "not-an-id", subject: "Hello", body: "Message" }),
      BadRequestException,
    );
    await assert.rejects(controller.list(request(), undefined, "0"), BadRequestException);
  });
});
