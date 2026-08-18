import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";

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
  signOut: ReturnType<typeof vi.fn>;
};
const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

const FAKE_SESSION = {
  user: { id: "user-1", email: "louis@example.test" },
} as never;

function Probe() {
  const { session, athleteId, athleteResolution, loading, signOut } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="session">{session ? "yes" : "no"}</span>
      <span data-testid="athlete-status">{athleteResolution.status}</span>
      <span data-testid="athlete-id">{athleteId ?? "none"}</span>
      <button onClick={() => void signOut()}>sign out</button>
    </div>
  );
}

function setupSession(session: unknown) {
  mockedAuth.getSession.mockResolvedValue({ data: { session } });
  mockedAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AuthContext — athlete resolution", () => {
  it("resolves exactly one athlete for the signed-in user", async () => {
    setupSession(FAKE_SESSION);
    mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: "athlete-1" }], error: null }) });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("athlete-status")).toHaveTextContent("resolved"));
    expect(screen.getByTestId("athlete-id")).toHaveTextContent("athlete-1");
  });

  it("reports no_athlete when the user has zero athlete rows", async () => {
    setupSession(FAKE_SESSION);
    mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("athlete-status")).toHaveTextContent("no_athlete"));
    expect(screen.getByTestId("athlete-id")).toHaveTextContent("none");
  });

  it("reports config_error and never picks a row when more than one athlete resolves", async () => {
    setupSession(FAKE_SESSION);
    mockedFrom.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: "athlete-1" }, { id: "athlete-2" }],
        error: null,
      }),
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("athlete-status")).toHaveTextContent("config_error"));
    expect(screen.getByTestId("athlete-id")).toHaveTextContent("none");
  });

  it("signOut clears the session via supabase.auth.signOut", async () => {
    setupSession(null);
    mockedAuth.signOut.mockResolvedValue({ error: null });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    screen.getByText("sign out").click();

    await waitFor(() => expect(mockedAuth.signOut).toHaveBeenCalledTimes(1));
  });
});
