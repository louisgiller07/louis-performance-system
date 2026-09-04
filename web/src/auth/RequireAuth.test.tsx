import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { RequireAuth } from "./RequireAuth";

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

function renderProtected(initialSession: unknown, athleteRows: unknown[] = [{ id: "athlete-1" }]) {
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
    expect(screen.queryByText("Configurer ton profil")).not.toBeInTheDocument();
  });

  it("V0.3_004B — authenticated with zero athlete rows: renders the AthleteBootstrap UI, not the dead-end message or the protected child", async () => {
    renderProtected({ user: { id: "user-1", email: "louis@example.test" } }, []);
    await waitFor(() => expect(screen.getByText("Configurer ton profil")).toBeInTheDocument());
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.queryByText(/contact support/i)).not.toBeInTheDocument();
  });

  it("V0.3_004B — more than one athlete resolved: still the existing config-error message, bootstrap is NOT shown", async () => {
    renderProtected({ user: { id: "user-1", email: "louis@example.test" } }, [{ id: "athlete-1" }, { id: "athlete-2" }]);
    await waitFor(() => expect(screen.getByText(/configuration error/i)).toBeInTheDocument());
    expect(screen.queryByText("Configurer ton profil")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });
});
