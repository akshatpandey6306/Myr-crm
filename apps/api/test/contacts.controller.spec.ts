import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContactsController } from "../src/contacts/contacts.controller.js";

describe("ContactsController", () => {
  it("scopes contact search and pagination to the verified organization", async () => {
    let where: Record<string, unknown> | undefined;
    const prisma = {
      contact: {
        count: async (args: { where: Record<string, unknown> }) => { where = args.where; return 0; },
        findMany: async (args: { where: Record<string, unknown> }) => { where = args.where; return []; },
      },
    };
    const controller = new ContactsController(prisma as never);
    const result = await controller.list(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/contacts" },
      "northwind",
      "1",
      "20",
      "email",
      "asc",
    );
    assert.equal(where?.organizationId, "org-a");
    assert.equal(where?.archivedAt, null);
    assert.equal(result.meta.pageSize, 20);
    assert.equal(result.meta.totalPages, 0);
  });

  it("normalizes contact email and takes tenant/owner from verified request context", async () => {
    let args: Record<string, unknown> | undefined;
    const contact = {
      id: "contact-a", name: "Ari Lee", email: "ari@example.com", phone: null, title: null, company: null,
      createdAt: new Date(), updatedAt: new Date(), owner: { user: { name: "Maya Chen" } },
    };
    const prisma = { contact: { create: async (value: Record<string, unknown>) => { args = value; return contact; } } };
    const controller = new ContactsController(prisma as never);
    await controller.create(
      { userId: "user-a", orgId: "org-a", organizationRole: "owner", headers: {}, params: {}, path: "/api/v1/contacts" },
      { name: "Ari Lee", email: "ARI@EXAMPLE.COM", organizationId: "org-b", ownerUserId: "user-b" },
    );
    const data = args?.data as Record<string, unknown>;
    assert.equal(data.organizationId, "org-a");
    assert.equal(data.ownerUserId, "user-a");
    assert.equal(data.email, "ari@example.com");
    assert.equal(data.phone, null);
    assert.equal(data.title, null);
    assert.equal(data.company, null);
  });
});
