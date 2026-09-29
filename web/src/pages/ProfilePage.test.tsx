import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProfilePage } from "./ProfilePage";

const signOut = vi.fn();
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { email: "louis@example.test" }, athleteId: "athlete-1", signOut }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/profile"]}>
      <ProfilePage />
    </MemoryRouter>
  );
}

describe("ProfilePage (UX-02)", () => {
  it("shows the account e-mail here, and only here", () => {
    renderPage();
    expect(screen.getByText("louis@example.test")).toBeInTheDocument();
  });

  it("links to the athlete configuration and to the privacy notice", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /Configuration athlète/ })).toHaveAttribute("href", "/performance-setup");
    expect(screen.getByRole("link", { name: /Confidentialité/ })).toHaveAttribute("href", "/privacy");
  });

  it("the Déconnexion button calls signOut", () => {
    renderPage();
    screen.getByRole("button", { name: "Déconnexion" }).click();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("renders the bottom tab bar with Profil active", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Profil" })).toHaveAttribute("aria-current", "page");
  });
});
