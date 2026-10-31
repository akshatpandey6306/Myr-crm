import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthController } from "../src/auth/auth.controller.js";

describe("AuthController signup", () => {
  it("creates the user, owner membership, organization, and expiring session in one nested write", async () => {
    let createArgs: Record<string, unknown> | undefined;
    const organization = { id: "org-a", name: "Northwind" };
    const user = {
      id: "user-a",
      email: "maya@example.com",
      name: "Maya Chen",
      memberships: [{ organization, role: "OWNER" }],
    };
    const prisma = {
      user: {
        create: async (args: Record<string, unknown>) => {
          createArgs = args;
          return user;
        },
      },
    };
    const controller = new AuthController(prisma as never);
    let setCookie = "";
    const httpResponse = { setHeader: (name: string, value: string) => { if (name === "Set-Cookie") setCookie = value; } };

    const signupResponse = await controller.signup({
      name: "Maya Chen",
      email: "Maya@Example.com",
      password: "password123",
      organizationName: "Northwind",
    }, httpResponse as never);

    const data = createArgs?.data as {
      memberships: {
        create: {
          role: string;
          organization: {
            create: {
              name: string;
              pipelines: {
                create: {
                  name: string;
                  isDefault: boolean;
                  stages: { create: { name: string; position: number }[] };
                };
              };
            };
          };
        };
      };
      sessions: { create: { tokenHash: string; expiresAt: Date } };
      passwordHash: string;
    };
    assert.equal((createArgs?.data as { email: string }).email, "maya@example.com");
    assert.equal(data.memberships.create.role, "OWNER");
    assert.equal(data.memberships.create.organization.create.name, "Northwind");
    const defaultPipeline = data.memberships.create.organization.create.pipelines.create;
    assert.equal(defaultPipeline.name, "Sales pipeline");
    assert.equal(defaultPipeline.isDefault, true);
    assert.deepEqual(defaultPipeline.stages.create.map((stage) => stage.name), ["Discovery", "Qualified", "Proposal", "Negotiation"]);
    assert.match(data.passwordHash, /^scrypt\$/);
    assert.equal(data.sessions.create.tokenHash.length, 64);
    assert.ok(data.sessions.create.expiresAt.getTime() > Date.now());
    assert.equal(signupResponse.organization.id, "org-a");
    assert.equal(signupResponse.token.length, 43);
    assert.notEqual(data.sessions.create.tokenHash, signupResponse.token);
    assert.match(setCookie, /^myr\.session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  });
});
