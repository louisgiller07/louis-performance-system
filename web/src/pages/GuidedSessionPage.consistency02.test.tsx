// CONSISTENCY-02 (HPM 2026-10-16) — /today/session when the calendar day changes while it is open: a guided session in
// progress (active or paused) keeps its own day until it ends (its results and its safe stop stay reachable);
// otherwise the page follows the new day — a session is never started from yesterday's prescription after midnight.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GuidedSessionPage } from "./GuidedSessionPage";

const D16 = "2026-10-16";
const D17 = "2026-10-17";

const clock = vi.hoisted(() => ({ today: "2026-10-16" }));
vi.mock("../lib/simulationClock", () => ({ useEffectiveToday: () => clock.today }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ athleteId: "a-1" }) }));

type Load = { status: "ready"; snapshot: Record<string, unknown> } | { status: "loading" };
const backend = vi.hoisted(() => ({ byDate: new Map<string, Load>(), dates: [] as string[] }));
vi.mock("../features/guidedSession/useGuidedSession", () => ({
  useGuidedSession: (_athleteId: string, date: string) => {
    backend.dates.push(date);
    return { load: backend.byDate.get(date) ?? { status: "loading" }, busy: false, actionError: null, start: vi.fn(), pause: vi.fn(), resume: vi.fn(), abandon: vi.fn(), complete: vi.fn(), submit: vi.fn(), retry: vi.fn(), reload: vi.fn(), newId: () => "id", now: () => new Date() };
  },
}));
vi.mock("../features/guidedSession/GuidedSessionView", () => ({
  GuidedSessionView: ({ load }: { load: Load }) => (
    <p data-testid="view">{load.status === "ready" ? `${String(load.snapshot.kind)}:${String(load.snapshot.phase ?? load.snapshot.reason ?? "")}` : load.status}</p>
  ),
}));

const execution = (phase: string) => ({ status: "ready" as const, snapshot: { kind: "execution", phase, execution: { session_date: D16 }, prescription: {} } });
const page = () => (
  <MemoryRouter>
    <GuidedSessionPage />
  </MemoryRouter>
);
const lastDate = () => backend.dates.at(-1);

beforeEach(() => {
  clock.today = D16;
  backend.dates = [];
  backend.byDate = new Map([[D17, { status: "ready", snapshot: { kind: "unavailable", reason: "no_decision" } }]]);
});

describe("CONSISTENCY-02 — /today/session across midnight", () => {
  it("a session in progress keeps its day past midnight, then follows the new day once it ends", () => {
    backend.byDate.set(D16, execution("active"));
    const { rerender } = render(page());
    expect(screen.getByTestId("view").textContent).toBe("execution:active");
    clock.today = D17;
    rerender(page());
    expect([lastDate(), screen.getByTestId("view").textContent]).toEqual([D16, "execution:active"]);
    backend.byDate.set(D16, execution("completed")); // the rider finishes it after midnight
    rerender(page());
    rerender(page());
    expect([lastDate(), screen.getByTestId("view").textContent]).toEqual([D17, "unavailable:no_decision"]);
  });

  it("a paused session also keeps its day (resume or safe stop stay reachable)", () => {
    backend.byDate.set(D16, execution("paused"));
    const { rerender } = render(page());
    clock.today = D17;
    rerender(page());
    expect(lastDate()).toBe(D16);
  });

  it("nothing started: the page follows the new day — yesterday's prescription can no longer be started", () => {
    backend.byDate.set(D16, { status: "ready", snapshot: { kind: "ready_to_start", finalPrescriptionId: "fp-16", prescription: {} } });
    const { rerender } = render(page());
    expect(screen.getByTestId("view").textContent).toBe("ready_to_start:");
    clock.today = D17;
    rerender(page());
    rerender(page());
    expect([lastDate(), screen.getByTestId("view").textContent]).toEqual([D17, "unavailable:no_decision"]);
  });

  it("a stopped attempt does not hold the day either", () => {
    backend.byDate.set(D16, execution("abandoned"));
    const { rerender } = render(page());
    clock.today = D17;
    rerender(page());
    rerender(page());
    expect(lastDate()).toBe(D17);
  });
});
