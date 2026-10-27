import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import Home from "./page";

afterEach(cleanup);

describe("Activities & Tasks", () => {
  it("filters by contract status and searches the filtered list", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by status" }), "open");
    expect(screen.getByText("Send revised proposal")).toBeInTheDocument();
    expect(screen.queryByText("Prepare discovery questions")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by status" }), "all");
    await user.type(screen.getByRole("searchbox", { name: "Search activities" }), "Northstar");
    expect(screen.getByText("Follow up on product demo")).toBeInTheDocument();
    expect(screen.queryByText("Send revised proposal")).not.toBeInTheDocument();
  });

  it("marks an activity complete and filters by its updated status", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Complete Send revised proposal" }));
    expect(
      screen.getByRole("button", { name: "Mark Send revised proposal as open" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by status" }),
      "completed",
    );
    expect(screen.getByText("Send revised proposal")).toBeInTheDocument();
    expect(screen.getByText("Prepare discovery questions")).toBeInTheDocument();
  });

  it("creates a contract-shaped activity with optional due date and linked record", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /create new/i }));

    const dialog = screen.getByRole("dialog", { name: "Create a new item" });
    await user.type(within(dialog).getByLabelText(/title/i), "Call new customer");
    await user.selectOptions(
      within(dialog).getByLabelText("Type"),
      "note",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Related record"),
      "contact:contact-sam",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create item" }));

    await user.type(
      screen.getByRole("searchbox", { name: "Search activities" }),
      "Call new customer",
    );
    expect(screen.getByText("Call new customer")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("Call new customer").closest("article")).toHaveTextContent("Sam Rivera");

    await user.clear(screen.getByRole("searchbox", { name: "Search activities" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Search activities" }),
      "Sam Rivera",
    );
    expect(screen.getByText("Call new customer")).toBeInTheDocument();
    expect(screen.queryByText("Send revised proposal")).not.toBeInTheDocument();
    expect(screen.getByText("Call new customer").closest("article")).toHaveTextContent("Sam Rivera");
  });

  it("filters by assignee and related record and paginates results", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by assignee" }), "user-jordan");
    expect(screen.getByText("Quarterly account check-in")).toBeInTheDocument();
    expect(screen.getByText("Reschedule introduction call")).toBeInTheDocument();
    expect(screen.queryByText("Send revised proposal")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by related type" }), "contact");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by related record" }), "contact-sam");
    expect(screen.getByText("Reschedule introduction call")).toBeInTheDocument();
    expect(screen.queryByText("Quarterly account check-in")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by assignee" }), "all");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by related type" }), "all");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by related record" }), "all");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText("Reschedule introduction call")).toBeInTheDocument();
  });
});
