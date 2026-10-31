import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmApiFetch } from "../../../lib/api-client";
import AutomationsManager from "./AutomationsManager";

vi.mock("../../../lib/api-client", () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);

type TestRule = {
  id: string;
  name: string;
  trigger: "lead_created" | "lead_status_changed";
  triggerStatus: "new" | "contacted" | "qualified" | "disqualified" | null;
  activityTitle: string;
  activityPriority: "low" | "normal" | "high";
  dueInDays: number;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeApi() {
  let rules: TestRule[] = [];
  apiFetchMock.mockImplementation(async (path, init = {}) => {
    const method = init.method ?? "GET";
    if (path === "/auth/me") return jsonResponse({ organizations: [{ id: "org-1", role: "owner" }] });
    if (path === "/automations" && method === "GET") return jsonResponse({ data: rules });
    if (path === "/automations" && method === "POST") {
      const body = JSON.parse(String(init.body)) as Omit<TestRule, "id" | "enabled" | "runCount" | "lastRunAt">;
      const created: TestRule = {
        ...body,
        id: "rule-new",
        enabled: true,
        runCount: 0,
        lastRunAt: null,
      };
      rules = [created, ...rules];
      return jsonResponse({ data: created });
    }
    if (path === "/automations/rule-1" && method === "PATCH") {
      rules = rules.map((rule) => ({ ...rule, enabled: false }));
      return jsonResponse({ data: rules[0] });
    }
    if (path === "/automations/rule-1" && method === "DELETE") {
      rules = [];
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: { message: "Unexpected request" } }, 404);
  });
  return { setRules(value: TestRule[]) { rules = value; } };
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("AutomationsManager", () => {
  it("creates a lead-status automation using its selected trigger and follow-up task", async () => {
    makeApi();
    const user = userEvent.setup();
    render(<AutomationsManager />);

    await screen.findByText("No automation rules yet");
    await user.click(screen.getByRole("button", { name: "Create rule" }));
    await user.type(screen.getByLabelText("Rule name"), "Qualified lead follow-up");
    await user.selectOptions(screen.getByLabelText("When"), "lead_status_changed");
    await user.selectOptions(screen.getByLabelText("Lead status"), "qualified");
    await user.click(screen.getByRole("button", { name: "Create automation" }));

    expect(await screen.findByText("Qualified lead follow-up")).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith("/automations", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "Qualified lead follow-up",
        trigger: "lead_status_changed",
        triggerStatus: "qualified",
        activityTitle: "Follow up with {{leadName}}",
        activityPriority: "normal",
        dueInDays: 1,
      }),
    }));
  });

  it("pauses an active rule and refreshes the list", async () => {
    const api = makeApi();
    api.setRules([{
      id: "rule-1",
      name: "New lead follow-up",
      trigger: "lead_created",
      triggerStatus: null,
      activityTitle: "Follow up with {{leadName}}",
      activityPriority: "normal",
      dueInDays: 1,
      enabled: true,
      runCount: 4,
      lastRunAt: "2026-10-29T10:30:00.000Z",
    }]);
    const user = userEvent.setup();
    render(<AutomationsManager />);

    await screen.findByText("New lead follow-up");
    await user.click(screen.getByRole("button", { name: "Pause New lead follow-up" }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith("/automations/rule-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    })));
    await screen.findByText("Paused");
  });
});
