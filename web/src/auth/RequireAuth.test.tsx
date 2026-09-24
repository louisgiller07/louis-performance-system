import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { RequireAuth } from "./RequireAuth";
import { PRIVACY_NOTICE_VERSION } from "../features/privacy/privacyNotice";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { supabase } from "../lib/supabase";

const mockedAuth = supabase.auth as unknown as {
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
};
const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

const ONBOARDING_DONE = { onboarding_completed_at: "2026-01-01T00:00:00Z", privacy_notice_version: PRIVACY_NOTICE_VERSION };

function renderProtected(
  initialSession: unknown,
  athleteRows: unknown[] = [{ id: "athlete-1", athlete_onboarding_profiles: ONBOARDING_DONE }]
) {
  mockedAuth.getSession.mockResolvedValue({ data: { session: initialSession } });
  mockedAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: athleteRows, error: null }) });

  return render(
    <MemoryRouter initialEntries={["/today"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route
            path="/today"
            element={
              <RequireAuth>
                <div>Protected content</div>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("RequireAuth", () => {
  it("redirects to /login when there is no session", async () => {
    renderProtected(null);
    await waitFor(() => expect(screen.getByText("Login page")).toBeInTheDocument());
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders the protected child when a session and athlete are resolved", async () => {
    renderProtected({ user: { id: "user-1", email: "louis@example.test" } });
    await waitFor(() => expect(screen.getByText("Protected content")).toBeInTheDocument());
  });

  it("V0.3_004B — unauthenticated: bootstrap is never shown, redirects to /login instead", async () => {
    renderProtected(null);
    await waitFor(() => expect(screen.getByText("Login page")).toBeInTheDocument());
    expect(screen.queryByText("Welcome to NALYNT")).not.toBeInTheDocument();
  });

  it("V0.3_004B — authenticated with zero athlete rows: renders the AthleteBootstrap UI, not the dead-end message or the protected child", async () => {
    renderProtected({ user: { id: "user-1", email: "louis@example.test" } }, []);
    await waitFor(() => expect(screen.getByText("Welcome to NALYNT")).toBeInTheDocument());
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.queryByText(/contacte le support/i)).not.toBeInTheDocument();
  });

  it("V0.3_004B — more than one athlete resolved: still the existing config-error message, bootstrap is NOT shown", async () => {
    renderProtected({ user: { id: "user-1", email: "louis@example.test" } }, [{ id: "athlete-1" }, { id: "athlete-2" }]);
    await waitFor(() => expect(screen.getByText(/erreur de configuration/i)).toBeInTheDocument());
    expect(screen.queryByText("Welcome to NALYNT")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("V0.3_008A — athlete resolved but onboarding not completed: renders the onboarding wizard (its own intro screen), not the protected child or AthleteBootstrap", async () => {
    renderProtected({ user: { id: "user-1", email: "louis@example.test" } }, [
      { id: "athlete-1", athlete_onboarding_profiles: null },
    ]);
    // Both AthleteOnboarding's fresh-start intro and AthleteBootstrap share
    // the "Welcome to NALYNT" headline (same first-run branding) — disambiguate
    // on each screen's own distinct copy instead.
    await waitFor(() => expect(screen.getByText("Build my athlete profile")).toBeInTheDocument());
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.queryByText("Let's build your athlete profile.")).not.toBeInTheDocument();
  });

  it("V0.3_008A — athlete resolved and onboarding completed: renders the protected child, not the onboarding wizard", async () => {
    renderProtected({ user: { id: "user-1", email: "louis@example.test" } }, [
      { id: "athlete-1", athlete_onboarding_profiles: ONBOARDING_DONE },
    ]);
    await waitFor(() => expect(screen.getByText("Protected content")).toBeInTheDocument());
    expect(screen.queryByText("What do you ride?")).not.toBeInTheDocument();
  });

  describe("PILOT_012 — health-data consent gate", () => {
    it("an existing athlete (onboarding done, no consent recorded) sees the consent gate, never the protected content", async () => {
      renderProtected({ user: { id: "user-1", email: "louis@example.test" } }, [
        { id: "athlete-1", athlete_onboarding_profiles: { onboarding_completed_at: "2026-01-01T00:00:00Z", privacy_notice_version: null } },
      ]);
      await waitFor(() => expect(screen.getByText("Tes données de santé")).toBeInTheDocument());
      expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox")).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
    });

    it("an athlete who accepted an older notice version is asked again", async () => {
      renderProtected({ user: { id: "user-1", email: "louis@example.test" } }, [
        { id: "athlete-1", athlete_onboarding_profiles: { onboarding_completed_at: "2026-01-01T00:00:00Z", privacy_notice_version: "2000-01-01" } },
      ]);
      await waitFor(() => expect(screen.getByText("Tes données de santé")).toBeInTheDocument());
      expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    });

    it("an athlete who accepted the current version goes straight to the app", async () => {
      renderProtected({ user: { id: "user-1", email: "louis@example.test" } });
      await waitFor(() => expect(screen.getByText("Protected content")).toBeInTheDocument());
      expect(screen.queryByText("Tes données de santé")).not.toBeInTheDocument();
    });
  });
});
