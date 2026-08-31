import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PlanPage } from "./PlanPage";
import { addDays, formatCalendarDate, todayLocal } from "../lib/date";
import type { PlannedSessionRow } from "../features/planning/planningTypes";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { email: "louis@example.test" }, athleteId: "athlete-1", signOut: vi.fn() }),
}));

const { loadPlannedSessions, savePlannedSession, deletePlannedSession } = vi.hoisted(() => ({
  loadPlannedSessions: vi.fn(),
  savePlannedSession: vi.fn(),
  deletePlannedSession: vi.fn(),
}));
vi.mock("../features/planning/planningRepo", () => ({ loadPlannedSessions, savePlannedSession, deletePlannedSession }));

beforeEach(() => {
  vi.clearAllMocks();
});

function horizonDates(): string[] {
  const today = todayLocal();
  return Array.from({ length: 7 }, (_, i) => addDays(today, i));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PlanPage />
    </MemoryRouter>
  );
}

describe("PlanPage — A", () => {
  it("renders the /plan page with its title and nav", async () => {
    loadPlannedSessions.mockResolvedValue([]);
    renderPage();
    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan" })).toBeInTheDocument();
    await waitFor(() => expect(loadPlannedSessions).toHaveBeenCalled());
  });
});

describe("PlanPage — B, D", () => {
  it("renders exactly seven dates, today through J+6, each Non planifié with no persisted rows", async () => {
    loadPlannedSessions.mockResolvedValue([]);
    renderPage();

    const dates = horizonDates();
    for (const date of dates) {
      expect(await screen.findByText(new RegExp(formatCalendarDate(date)))).toBeInTheDocument();
    }
    expect(screen.getAllByText("Non planifié")).toHaveLength(7);
    expect(loadPlannedSessions).toHaveBeenCalledWith("athlete-1", dates[0], dates[6]);
  });
});

describe("PlanPage — C, E", () => {
  it("shows persisted rows on their correct dates, including an explicit REST row", async () => {
    const dates = horizonDates();
    const rows: PlannedSessionRow[] = [
      { planned_date: dates[2], session_type: "REST", intervention: { kind: "REST" }, planned_intent: null },
      {
        planned_date: dates[4],
        session_type: "DH_TECHNICAL",
        intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        planned_intent: null,
      },
    ];
    loadPlannedSessions.mockResolvedValue(rows);
    renderPage();

    expect(await screen.findByText("Repos")).toBeInTheDocument();
    expect(screen.getByText(/DH technique/)).toBeInTheDocument();
    expect(screen.getAllByText("Non planifié")).toHaveLength(5);
  });
});

describe("PlanPage — U, V: canonical persisted state ownership", () => {
  it("U: a successful save updates the page's canonical row and collapses the editor, without refetching", async () => {
    const user = userEvent.setup();
    const dates = horizonDates();
    loadPlannedSessions.mockResolvedValue([]);
    savePlannedSession.mockResolvedValue({
      planned_date: dates[0],
      session_type: "REST",
      intervention: { kind: "REST" },
      planned_intent: null,
    });
    renderPage();

    const todayCard = await screen.findByRole("button", { name: /Aujourd'hui/ });
    await user.click(todayCard);
    await user.selectOptions(screen.getByLabelText("Séance"), "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Repos")).toBeInTheDocument();
    expect(screen.queryByLabelText("Séance")).not.toBeInTheDocument(); // editor collapsed
    expect(loadPlannedSessions).toHaveBeenCalledTimes(1); // no refetch
  });

  it("V: a successful delete clears the page's canonical row to Non planifié and collapses the editor", async () => {
    const user = userEvent.setup();
    const dates = horizonDates();
    loadPlannedSessions.mockResolvedValue([
      { planned_date: dates[0], session_type: "REST", intervention: { kind: "REST" }, planned_intent: null },
    ]);
    deletePlannedSession.mockResolvedValue(undefined);
    renderPage();

    const todayCard = await screen.findByRole("button", { name: /Aujourd'hui/ });
    await user.click(todayCard);
    await user.click(screen.getByRole("button", { name: "Retirer du planning" }));

    // All seven cards (today's included) now show Non planifié — confirms
    // today's card specifically flipped, not merely that six others already did.
    expect(await screen.findAllByText("Non planifié")).toHaveLength(7);
    expect(screen.getByRole("button", { name: /Aujourd'hui/ })).toHaveTextContent("Non planifié");
    expect(screen.queryByRole("button", { name: "Retirer du planning" })).not.toBeInTheDocument();
    expect(loadPlannedSessions).toHaveBeenCalledTimes(1); // no refetch
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("PlanPage — cross-day async collapse race", () => {
  it("a save that resolves after the athlete switched to another day updates only its own row and leaves the other day's editor open", async () => {
    const user = userEvent.setup();
    const dates = horizonDates();
    loadPlannedSessions.mockResolvedValue([]);
    const { promise: savePromise, resolve: resolveSave } = deferred<PlannedSessionRow>();
    savePlannedSession.mockReturnValue(savePromise);
    renderPage();

    // Open day A (today) and start a save that will not resolve yet.
    const dayA = await screen.findByRole("button", { name: /Aujourd'hui/ });
    await user.click(dayA);
    await user.selectOptions(screen.getByLabelText("Séance"), "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    // Before A's save resolves, the athlete switches to day B.
    const dayB = screen.getByText(new RegExp(formatCalendarDate(dates[1]))).closest("button")!;
    await user.click(dayB);
    expect(screen.getByLabelText("Séance")).toBeInTheDocument(); // B's editor is now the one open

    // Now A's save resolves.
    resolveSave({ planned_date: dates[0], session_type: "REST", intervention: { kind: "REST" }, planned_intent: null });

    // A's canonical row updated (visible on its now-collapsed card)...
    await waitFor(() => expect(screen.getByText("Repos")).toBeInTheDocument());
    // ...but B's editor must still be open — A's resolution must not collapse it.
    expect(screen.getByLabelText("Séance")).toBeInTheDocument();
  });
});

describe("PlanPage — loading/error", () => {
  it("shows a loading state before rows resolve", () => {
    loadPlannedSessions.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
  });

  it("shows a safe error state with a retry action on load failure", async () => {
    loadPlannedSessions.mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de charger le planning");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
