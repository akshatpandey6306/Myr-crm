import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastValueFrom, of } from "rxjs";
import { AuditLogInterceptor } from "../src/audit-logs/audit-log.interceptor.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const recordId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("AuditLogInterceptor", () => {
  it("records successful writes without copying request bodies", async () => {
    const events: Record<string, unknown>[] = [];
    const interceptor = new AuditLogInterceptor({ record: async (event: Record<string, unknown>) => { events.push(event); } } as never);
    const request = {
      method: "POST",
      path: "/api/v1/leads",
      orgId: organizationId,
      userId,
      params: {},
      headers: {},
      body: { name: "Private customer data" },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };

    const response = await lastValueFrom(interceptor.intercept(context as never, { handle: () => of({ data: { id: recordId } }) } as never));

    assert.deepEqual(events, [{
      organizationId,
      actorUserId: userId,
      action: "CREATE",
      resourceType: "leads",
      resourceId: recordId,
    }]);
    assert.deepEqual(response, { data: { id: recordId } });
  });

  it("does not log reads or authentication endpoints", async () => {
    let records = 0;
    const interceptor = new AuditLogInterceptor({ record: async () => { records += 1; } } as never);
    const context = (method: string, path: string) => ({ switchToHttp: () => ({ getRequest: () => ({
      method, path, orgId: organizationId, userId, params: {}, headers: {},
    }) }) });

    await lastValueFrom(interceptor.intercept(context("GET", "/api/v1/leads") as never, { handle: () => of({ data: [] }) } as never));
    await lastValueFrom(interceptor.intercept(context("POST", "/api/v1/auth/login") as never, { handle: () => of({ data: {} }) } as never));

    assert.equal(records, 0);
  });

  it("audits role changes as member events without copying the request body", async () => {
    let event: Record<string, unknown> | undefined;
    const interceptor = new AuditLogInterceptor({ record: async (value: Record<string, unknown>) => { event = value; } } as never);
    const request = {
      method: "PATCH",
      path: "/api/v1/organizations/members/member-a",
      orgId: organizationId,
      userId,
      params: { userId: recordId },
      headers: {},
      body: { role: "admin", password: "must-not-be-audit-data" },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };

    await lastValueFrom(interceptor.intercept(context as never, { handle: () => of({ data: { userId: recordId } }) } as never));

    assert.deepEqual(event, {
      organizationId,
      actorUserId: userId,
      action: "UPDATE",
      resourceType: "members",
      resourceId: recordId,
    });
  });
});