import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import Home from "./page";

afterEach(cleanup);

describe("Activities & Tasks", () => {
  it("filters activities by status and searches the visible list", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("tab", { name: "Open" }));
    expect(screen.getByText("Send revised proposal")).toBeInTheDocument();
    expect(screen.queryByText("Prepare discovery questions")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search activities" }), "Northstar");
    expect(screen.getByText("Follow up on product demo")).toBeInTheDocument();
    expect(screen.queryByText("Send revised proposal")).not.toBeInTheDocument();
  });

  it("marks an activity complete and updates the completion filter", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Complete Send revised proposal" }));
    expect(
      screen.getByRole("button", { name: "Mark Send revised proposal as open" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("tab", { name: "Completed" }));
    expect(screen.getByText("Send revised proposal")).toBeInTheDocument();
    expect(screen.getByText("Prepare discovery questions")).toBeInTheDocument();
  });

  it("creates a task and finds it through search", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /create new/i }));

    const dialog = screen.getByRole("dialog", { name: "Create a new item" });
    await user.type(within(dialog).getByLabelText(/title/i), "Call new customer");
    await user.type(within(dialog).getByLabelText(/related to/i), "Pinecone Inc.");
    await user.click(within(dialog).getByRole("button", { name: "Create item" }));

    expect(screen.getByText("Call new customer")).toBeInTheDocument();
    expect(screen.getByText("Pinecone Inc.")).toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: "Search activities" }),
      "Pinecone",
    );
    expect(screen.getByText("Call new customer")).toBeInTheDocument();
    expect(screen.queryByText("Send revised proposal")).not.toBeInTheDocument();
  });
});
