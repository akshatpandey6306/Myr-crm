import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmApiFetch } from "../../../lib/api-client";
import EmailsManager from "./EmailsManager";

vi.mock("../../../lib/api-client", () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("EmailsManager", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path, init = {}) => {
      if (path.startsWith("/contacts?")) {
        return jsonResponse({
          data: [{ id: "contact-1", name: "Olivia Rhye", email: "olivia@example.com" }],
          meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        });
      }
      if (path.startsWith("/emails?")) return jsonResponse({ data: [] });
      if (path === "/emails" && init.method === "POST") {
        return jsonResponse({
          data: {
            id: "email-1",
            contactId: "contact-1",
            contactName: "Olivia Rhye",
            recipientName: "Olivia Rhye",
            recipientEmail: "olivia@example.com",
            subject: "Follow-up",
            body: "Thanks for your time.",
            deliveryStatus: "not_configured",
            sentAt: null,
            createdByName: "Alex Morgan",
            createdAt: "2026-10-29T10:00:00.000Z",
          },
        });
      }
      return jsonResponse({ error: { message: "Unexpected request" } }, 404);
    });
  });

  it("saves a contact email to the outbox without claiming delivery", async () => {
    const user = userEvent.setup();
    render(<EmailsManager />);

    await screen.findByRole("option", { name: "Olivia Rhye — olivia@example.com" });
    await user.selectOptions(screen.getByLabelText("To"), "contact-1");
    await user.type(screen.getByLabelText("Subject"), "Follow-up");
    await user.type(screen.getByLabelText("Message"), "Thanks for your time.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved to the outbox. Email delivery is disabled.");
    expect(apiFetchMock).toHaveBeenCalledWith("/emails", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        contactId: "contact-1",
        subject: "Follow-up",
        body: "Thanks for your time.",
      }),
    }));
  });

  it("shows failed API errors without displaying a success notice", async () => {
    apiFetchMock.mockImplementation(async (path, init = {}) => {
      if (path.startsWith("/contacts?")) {
        return jsonResponse({ data: [{ id: "contact-1", name: "Olivia Rhye", email: "olivia@example.com" }] });
      }
      if (path.startsWith("/emails?")) return jsonResponse({ data: [] });
      if (path === "/emails" && init.method === "POST") {
        return jsonResponse({ error: { message: "Email service unavailable" } }, 503);
      }
      return jsonResponse({ error: { message: "Unexpected request" } }, 404);
    });
    const user = userEvent.setup();
    render(<EmailsManager />);

    await screen.findByRole("option", { name: "Olivia Rhye — olivia@example.com" });
    await user.selectOptions(screen.getByLabelText("To"), "contact-1");
    await user.type(screen.getByLabelText("Subject"), "Follow-up");
    await user.type(screen.getByLabelText("Message"), "Thanks for your time.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email service unavailable");
    expect(screen.queryByText("Saved to the outbox. Email delivery is disabled.")).not.toBeInTheDocument();
  });
});
