import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppNav } from "./AppNav";

describe("AppNav", () => {
  it("renders all tabs: Aujourd'hui, Programme (training plan), Semaine (manual planning), Historique, Insights", () => {
    render(
      <MemoryRouter initialEntries={["/today"]}>
        <AppNav />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Aujourd'hui" })).toHaveAttribute("href", "/today");
    expect(screen.getByRole("link", { name: "Programme" })).toHaveAttribute("href", "/training-plan");
    expect(screen.getByRole("link", { name: "Semaine" })).toHaveAttribute("href", "/plan");
    expect(screen.getByRole("link", { name: "Historique" })).toHaveAttribute("href", "/history");
    expect(screen.getByRole("link", { name: "Insights" })).toHaveAttribute("href", "/insights");
    expect(screen.queryByRole("link", { name: "Plan" })).not.toBeInTheDocument();
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
