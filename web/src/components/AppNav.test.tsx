import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppNav } from "./AppNav";

describe("AppNav", () => {
  it("renders all tabs linking to /today, /plan, and /history", () => {
    render(
      <MemoryRouter initialEntries={["/today"]}>
        <AppNav />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Aujourd'hui" })).toHaveAttribute("href", "/today");
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/plan");
    expect(screen.getByRole("link", { name: "Historique" })).toHaveAttribute("href", "/history");
  });

  it("marks the current route's tab as active", () => {
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <AppNav />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Historique" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Aujourd'hui" })).not.toHaveAttribute("aria-current");
  });
});
