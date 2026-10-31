import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SettingsController } from "../src/settings/settings.controller.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const request = (role: "owner" | "sales_rep" | "sales_manager" = "owner") => ({
  userId,
  orgId: organizationId,
  organizationRole: role,
  headers: {},
  params: {},
  path: "/api/v1/settings",
});

describe("SettingsController", () => {
  it("returns organization-scoped defaults when settings have not been customized", async () => {
    let organizationWhere: Record<string, unknown> | undefined;
    let settingsWhere: Record<string, unknown> | undefined;
    const controller = new SettingsController({
      organization: { findUnique: async (args: { where: Record<string, unknown> }) => { organizationWhere = args.where; return { id: organizationId, name: "Northstar" }; } },
      organizationSettings: { findUnique: async (args: { where: Record<string, unknown> }) => { settingsWhere = args.where; return null; } },
    } as never);

    const result = await controller.get(request("sales_rep"));

    assert.deepEqual(organizationWhere, { id: organizationId });
    assert.deepEqual(settingsWhere, { organizationId });
    assert.equal(result.data.organizationName, "Northstar");
    assert.equal(result.data.currency, "USD");
    assert.equal(result.data.timezone, "UTC");
    assert.equal(result.data.weekStartsOn, 1);
    assert.equal(result.data.canEdit, false);
  });

  it("rejects unknown settings and updates only the selected organization", async () => {
    let organizationUpdate: Record<string, unknown> | undefined;
    let settingsUpsert: Record<string, unknown> | undefined;
    const updatedAt = new Date("2026-10-30T12:00:00.000Z");
    const tx = {
      organization: {
        update: async (args: Record<string, unknown>) => { organizationUpdate = args; return { id: organizationId, name: "Northstar Studio" }; },
        findUnique: async () => ({ id: organizationId, name: "Northstar" }),
      },
      organizationSettings: {
        upsert: async (args: Record<string, unknown>) => { settingsUpsert = args; return { currency: "EUR", timezone: "Europe/Paris", weekStartsOn: 1, updatedAt }; },
      },
    };
    const controller = new SettingsController({ $transaction: async (operation: (value: unknown) => Promise<unknown>) => operation(tx) } as never);

    const result = await controller.update(request(), { organizationName: " Northstar Studio ", currency: "EUR", timezone: "Europe/Paris" });

    assert.deepEqual(organizationUpdate, { where: { id: organizationId }, data: { name: "Northstar Studio" }, select: { id: true, name: true } });
    assert.deepEqual(settingsUpsert?.where, { organizationId });
    assert.deepEqual(settingsUpsert?.update, { currency: "EUR", timezone: "Europe/Paris" });
    assert.equal(result.data.organizationName, "Northstar Studio");
    assert.equal(result.data.canEdit, true);
    await assert.rejects(controller.update(request(), { role: "owner" }), BadRequestException);
  });

  it("restricts changes to Owners and Admins and validates locale preferences", async () => {
    const controller = new SettingsController({} as never);
    await assert.rejects(controller.update(request("sales_rep"), { currency: "EUR" }), ForbiddenException);
    await assert.rejects(controller.update(request("sales_manager"), { currency: "EUR" }), ForbiddenException);
    await assert.rejects(controller.update(request(), { weekStartsOn: 7 }), BadRequestException);
    await assert.rejects(controller.update(request(), { timezone: "Mars/Olympus" }), BadRequestException);
  });
});