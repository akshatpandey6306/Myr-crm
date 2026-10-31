import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ControlPanelController } from "../src/control-panel/control-panel.controller.js";

describe("ControlPanelController", () => {
  it("lists customer workspaces with active member counts", async () => {
    const prisma = {
      organization: {
        findMany: async () => [
          {
            id: "org-a",
            name: "Acme",
            status: "ACTIVE",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            subscriptionPlan: "growth",
            subscriptionStatus: "TRIAL",
            subscriptionStartedAt: new Date("2027-01-01T00:00:00.000Z"),
            subscriptionEndsAt: new Date("2027-01-15T00:00:00.000Z"),
            billingProvider: "test",
            memberships: [{ user: { name: "Maya Chen", email: "maya@example.com" } }],
          },
          {
            id: "org-b",
            name: "Beta",
            status: "SUSPENDED",
            createdAt: new Date("2026-01-02T00:00:00.000Z"),
            subscriptionPlan: null,
            subscriptionStatus: "PENDING",
            subscriptionStartedAt: null,
            subscriptionEndsAt: null,
            billingProvider: null,
            memberships: [],
          },
        ],
      },
      membership: {
        groupBy: async () => [
          { organizationId: "org-a", _count: { _all: 2 } },
        ],
      },
    };
    const controller = new ControlPanelController(prisma as never);

    assert.deepEqual(await controller.listOrganizations(), {
      data: [
        {
          id: "org-a",
          name: "Acme",
          status: "active",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          memberCount: 2,
          owner: { name: "Maya Chen", email: "maya@example.com" },
          subscription: {
            planCode: "growth",
            status: "trial",
            startsAt: new Date("2027-01-01T00:00:00.000Z"),
            endsAt: new Date("2027-01-15T00:00:00.000Z"),
            provider: "test",
          },
        },
        {
          id: "org-b",
          name: "Beta",
          status: "suspended",
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          memberCount: 0,
          owner: null,
          subscription: { planCode: null, status: "pending", startsAt: null, endsAt: null, provider: null },
        },
      ],
    });
  });

  it("reports an elapsed trial as expired in the admin onboarding list", async () => {
    const controller = new ControlPanelController({
      organization: {
        findMany: async () => [{
          id: "org-a",
          name: "Acme",
          status: "ACTIVE",
          createdAt: new Date(),
          subscriptionPlan: "starter",
          subscriptionStatus: "TRIAL",
          subscriptionStartedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          billingProvider: "test",
          memberships: [],
        }],
      },
      membership: { groupBy: async () => [] },
    } as never);

    const result = await controller.listOrganizations();
    assert.equal(result.data[0]?.subscription.status, "expired");
  });

  it("suspends and restores a workspace", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const controller = new ControlPanelController({
      organization: {
        update: async (args: Record<string, unknown>) => {
          updateArgs = args;
          return { id: "11111111-1111-4111-8111-111111111111", name: "Acme", status: "SUSPENDED" };
        },
      },
    } as never);

    const result = await controller.updateOrganizationAccess("11111111-1111-4111-8111-111111111111", { status: "suspended" });
    assert.equal((updateArgs?.data as Record<string, unknown>).status, "SUSPENDED");
    assert.equal(result.data.status, "suspended");
  });

  it("validates organization IDs and access status", async () => {
    const controller = new ControlPanelController({} as never);
    await assert.rejects(controller.updateOrganizationAccess("invalid", { status: "suspended" }), BadRequestException);
    await assert.rejects(
      controller.updateOrganizationAccess("11111111-1111-4111-8111-111111111111", { status: "paid" }),
      BadRequestException,
    );
  });

  it("returns not found when the workspace does not exist", async () => {
    const controller = new ControlPanelController({
      organization: { update: async () => { throw { code: "P2025" }; } },
    } as never);

    await assert.rejects(
      controller.updateOrganizationAccess("11111111-1111-4111-8111-111111111111", { status: "active" }),
      NotFoundException,
    );
  });

  it("reactivates an expired subscription on the selected plan for thirty days", async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const now = new Date();
    const controller = new ControlPanelController({
      organization: {
        update: async (args: Record<string, unknown>) => {
          updateArgs = args;
          return {
            id: "11111111-1111-4111-8111-111111111111",
            subscriptionPlan: "growth",
            subscriptionStatus: "ACTIVE",
            subscriptionStartedAt: now,
            subscriptionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            billingProvider: "manual",
          };
        },
      },
    } as never);

    const result = await controller.updateOrganizationSubscription(
      "11111111-1111-4111-8111-111111111111",
      { status: "active", planCode: "growth" },
    );
    const data = updateArgs?.data as Record<string, unknown>;
    assert.equal(data.subscriptionStatus, "ACTIVE");
    assert.equal(data.subscriptionPlan, "growth");
    assert.equal(result.data.status, "active");
    assert.equal(result.data.planCode, "growth");
    assert.equal(result.data.provider, "manual");
    assert.ok((result.data.startsAt?.getTime() ?? 0) <= Date.now());
    assert.ok((result.data.endsAt?.getTime() ?? 0) > Date.now());
  });

  it("rejects activating a plan without a valid plan code", async () => {
    const controller = new ControlPanelController({} as never);
    await assert.rejects(
      controller.updateOrganizationSubscription(
        "11111111-1111-4111-8111-111111111111",
        { status: "active", planCode: "unknown" },
      ),
      BadRequestException,
    );
  });
});
