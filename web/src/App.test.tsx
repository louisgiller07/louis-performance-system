import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// V0.3_001C-3 — proves the NEW /insights route is actually wired behind
// RequireAuth in App.tsx (a real risk: a missed/typo'd wrap would silently
// expose the route) — not a re-test of RequireAuth's own internal branches,
// which have no dedicated suite of their own in this repo yet either.
const { getSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock("./lib/supabase", () => ({
  supabase: { auth: { getSession, onAuthStateChange }, from: vi.fn() },
}));

import App from "./App";

describe("App routing", () => {
  it("redirects an unauthenticated visitor at /insights to /login", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    window.history.pushState({}, "", "/insights");
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
  });
});
