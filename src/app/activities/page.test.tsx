import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmApiFetch } from "../../lib/api-client";
import Home from "./page";

vi.mock("../../lib/api-client", () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const currentUserId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const contactId = "33333333-3333-4333-8333-333333333333";
const companyId = "44444444-4444-4444-8444-444444444444";
const apiFetchMock = vi.mocked(crmApiFetch);

type TestActivity = {
  id: string;
  organizationId: string;
  type: "task" | "call" | "meeting" | "note" | "email";
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "normal" | "high";
  dueAt: string | null;
  completedAt: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  relatedToType: string | null;
  relatedToId: string | null;
  relatedToName: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

const initialItems: TestActivity[] = [
  {
    id: "activity-1",
    organizationId: "org-a",
    type: "task",
    title: "Send revised proposal",
    description: null,
    status: "open",
    priority: "high",
    dueAt: "2026-10-27T12:00:00.000Z",
    completedAt: null,
    assignedToUserId: currentUserId,
    assignedToName: "Alex Morgan",
    relatedToType: "company",
    relatedToId: companyId,
    relatedToName: "Northstar Labs",
    createdByUserId: currentUserId,
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  },
  {
    id: "activity-2",
    organizationId: "org-a",
    type: "call",
    title: "Follow up on product demo",
    description: null,
    status: "in_progress",
    priority: "normal",
    dueAt: "2026-10-28T12:00:00.000Z",
    completedAt: null,
    assignedToUserId: currentUserId,
    assignedToName: "Alex Morgan",
    relatedToType: "company",
    relatedToId: companyId,
    relatedToName: "Northstar Labs",
    createdByUserId: currentUserId,
    createdAt: "2026-10-23T12:00:00.000Z",
    updatedAt: "2026-10-23T12:00:00.000Z",
  },
  {
    id: "activity-3",
    organizationId: "org-a",
    type: "task",
    title: "Review contract details",
    description: null,
    status: "open",
    priority: "high",
    dueAt: "2026-10-29T12:00:00.000Z",
    completedAt: null,
    assignedToUserId: otherUserId,
    assignedToName: "Jordan Lee",
    relatedToType: "contact",
    relatedToId: contactId,
    relatedToName: "Sam Rivera",
    createdByUserId: currentUserId,
    createdAt: "2026-10-24T12:00:00.000Z",
    updatedAt: "2026-10-24T12:00:00.000Z",
  },
  ...Array.from({ length: 4 }, (_, index): TestActivity => ({
    id: `activity-${index + 4}`,
    organizationId: "org-a",
    type: "meeting",
    title: `Customer check-in ${index + 1}`,
    description: null,
    status: "open",
    priority: "normal",
    dueAt: `2026-10-${String(30 + index).padStart(2, "0")}T12:00:00.000Z`,
    completedAt: null,
    assignedToUserId: index % 2 ? otherUserId : currentUserId,
    assignedToName: index % 2 ? "Jordan Lee" : "Alex Morgan",
    relatedToType: null,
    relatedToId: null,
    relatedToName: null,
    createdByUserId: currentUserId,
    createdAt: `2026-10-${String(24 + index).padStart(2, "0")}T12:00:00.000Z`,
    updatedAt: `2026-10-${String(24 + index).padStart(2, "0")}T12:00:00.000Z`,
  })),
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeApi() {
  let items = structuredClone(initialItems);
  apiFetchMock.mockImplementation(async (path, init = {}) => {
    const url = new URL(path, "https://crm.test");
    const method = init.method ?? "GET";

    if (url.pathname === "/activities" && method === "GET") {
      const params = url.searchParams;
      const query = params.get("q")?.toLowerCase();
      const status = params.get("status");
      const assignee = params.get("assignedToUserId");
      const relatedType = params.get("relatedToType");
      const relatedId = params.get("relatedToId");
      const filtered = items.filter((item) =>
        (!query || `${item.title} ${item.type} ${item.status} ${item.assignedToName ?? ""} ${item.relatedToName ?? ""}`.toLowerCase().includes(query))
        && (!status || item.status === status)
        && (!assignee || (assignee === "me" ? item.assignedToUserId === currentUserId : item.assignedToUserId === assignee))
        && (!relatedType || item.relatedToType === relatedType)
        && (!relatedId || item.relatedToId === relatedId),
      );
      const sortDescending = params.get("sortOrder") === "desc";
      const sortBy = params.get("sortBy") ?? "createdAt";
      filtered.sort((left, right) => {
        const leftValue = sortBy === "dueAt" ? left.dueAt : left.createdAt;
        const rightValue = sortBy === "dueAt" ? right.dueAt : right.createdAt;
        if (!leftValue) return rightValue ? 1 : 0;
        if (!rightValue) return -1;
        return sortDescending
          ? rightValue.localeCompare(leftValue)
          : leftValue.localeCompare(rightValue);
      });
      const page = Number(params.get("page") ?? 1);
      const pageSize = Number(params.get("pageSize") ?? 25);
      const start = (page - 1) * pageSize;
      return jsonResponse({
        data: filtered.slice(start, start + pageSize),
        meta: { page, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) },
      });
    }

    if (url.pathname === "/activities" && method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const created: TestActivity = {
        id: "activity-created",
        organizationId: "org-a",
        type: body.type as TestActivity["type"],
        title: String(body.title),
        description: body.description as string | null,
        status: "open",
        priority: body.priority as TestActivity["priority"],
        dueAt: body.dueAt as string | null,
        completedAt: null,
        assignedToUserId: body.assignedToUserId as string | null ?? currentUserId,
        assignedToName: "Alex Morgan",
        relatedToType: body.relatedToType as string | null,
        relatedToId: body.relatedToId as string | null,
        relatedToName: body.relatedToId ? "Sam Rivera" : null,
        createdByUserId: currentUserId,
        createdAt: "2026-10-29T12:00:00.000Z",
        updatedAt: "2026-10-29T12:00:00.000Z",
      };
      items = [created, ...items];
      return jsonResponse({ data: created });
    }

    if (url.pathname.startsWith("/activities/") && method === "PATCH") {
      const id = url.pathname.split("/").at(-1);
      const body = JSON.parse(String(init.body)) as Partial<TestActivity>;
      items = items.map((item) => item.id === id
        ? { ...item, ...body, completedAt: body.status === "completed" ? "2026-10-29T12:00:00.000Z" : body.status ? null : item.completedAt }
        : item);
      return jsonResponse({ data: items.find((item) => item.id === id) });
    }

    if (url.pathname.startsWith("/activities/") && method === "DELETE") {
      const id = url.pathname.split("/").at(-1);
      items = items.filter((item) => item.id !== id);
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/contacts" || url.pathname === "/companies" || url.pathname === "/leads" || url.pathname === "/deals") {
      const data = url.pathname === "/contacts"
        ? [{ id: contactId, name: "Sam Rivera" }]
        : [{ id: companyId, name: "Northstar Labs" }];
      return jsonResponse({ data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } });
    }

    return jsonResponse({ error: { code: "not_found", message: `Unhandled mock route: ${url.pathname}` } }, 404);
  });

  return {
    get items() { return items; },
  };
}

describe("Activities & Tasks", () => {
  beforeEach(() => {
    makeApi();
  });

  it("uses the CRM API for status filtering and search", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Items per page" }), "10");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by status" }), "open");
    expect(await screen.findByText("Send revised proposal")).toBeInTheDocument();
    expect(screen.queryByText("Follow up on product demo")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by status" }), "all");
    await user.type(screen.getByRole("searchbox", { name: "Search activities" }), "Northstar");
    expect(await screen.findByText("Follow up on product demo")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Customer check-in 1")).not.toBeInTheDocument());
  });

  it("persists completion changes through the Activity API", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<Home />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Items per page" }), "10");
    await user.click(await screen.findByRole("button", { name: "Complete Send revised proposal" }));
    expect(await screen.findByRole("button", { name: "Mark Send revised proposal as open" })).toHaveAttribute("aria-pressed", "true");
    expect(api.items.find((item) => item.id === "activity-1")?.status).toBe("completed");
  });

  it("creates activities with linked CRM records using the API", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /create new/i }));
    const dialog = screen.getByRole("dialog", { name: "Create a new item" });
    await user.type(within(dialog).getByLabelText(/title/i), "Call new customer");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "note");
    await user.selectOptions(within(dialog).getByLabelText("Related record type"), "contact");
    await within(dialog).findByRole("option", { name: "Sam Rivera" });
    await user.selectOptions(within(dialog).getByLabelText("Related record"), contactId);
    await user.click(within(dialog).getByRole("button", { name: "Create item" }));

    expect(await screen.findByText("Call new customer")).toBeInTheDocument();
    expect(api.items[0]).toMatchObject({
      title: "Call new customer",
      type: "note",
      relatedToType: "contact",
      relatedToId: contactId,
    });
  });

  it("filters by assignee and related record and paginates server results", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by assignee" }), "me");
    expect(await screen.findByText("Send revised proposal")).toBeInTheDocument();
    expect(screen.queryByText("Review contract details")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by assignee" }), "all");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by related type" }), "contact");
    await screen.findByRole("option", { name: "Sam Rivera" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by related record" }), contactId);
    expect(await screen.findByText("Review contract details")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by assignee" }), "all");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by related type" }), "all");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
  });
});
