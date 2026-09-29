import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppNav } from "./AppNav";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppNav />
    </MemoryRouter>
  );
}

describe("AppNav (UX-02 bottom tab bar)", () => {
  it("renders exactly four tabs: Aujourd'hui, Programme, Historique, Profil", () => {
    renderAt("/today");
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aujourd'hui" })).toHaveAttribute("href", "/today");
    expect(screen.getByRole("link", { name: "Programme" })).toHaveAttribute("href", "/training-plan");
    expect(screen.getByRole("link", { name: "Historique" })).toHaveAttribute("href", "/history");
    expect(screen.getByRole("link", { name: "Profil" })).toHaveAttribute("href", "/profile");
    expect(screen.getAllByRole("link")).toHaveLength(4);
    // The former "Semaine" and "Insights" tabs are reached from Programme / Historique.
    expect(screen.queryByRole("link", { name: "Semaine" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Insights" })).not.toBeInTheDocument();
  });

  it("marks the current route's tab as active", () => {
    renderAt("/history");
    expect(screen.getByRole("link", { name: "Historique" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Aujourd'hui" })).not.toHaveAttribute("aria-current");
  });

  it.each([
    ["/plan", "Programme"],
    ["/training-plan-preview/abc", "Programme"],
    ["/history/decision-1", "Historique"],
    ["/insights", "Historique"],
    ["/performance-setup", "Profil"],
  ])("keeps the owning tab active on the sub-route %s (%s)", (path, tab) => {
    renderAt(path);
    expect(screen.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  });
});
