import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HistoryDetailPage } from "./HistoryDetailPage";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ athleteId: "athlete-1" }),
}));

vi.mock("../features/history/historyRepo", () => ({
  loadDecisionById: vi.fn(),
  loadCompletedSessionsForDates: vi.fn(),
}));

import { loadDecisionById, loadCompletedSessionsForDates } from "../features/history/historyRepo";

const mockedLoad = loadDecisionById as unknown as ReturnType<typeof vi.fn>;
const mockedLoadCompleted = loadCompletedSessionsForDates as unknown as ReturnType<typeof vi.fn>;

const VALID_ROW = {
  id: "d-1",
  decisionDate: "2026-08-19",
  createdAt: "2026-08-19T08:00:00Z",
  finalSessionDb: "REST",
  activeModeDb: "IN_SEASON",
  confidenceLevelDb: "MEDIUM",
  dailyPlan: {
    active_mode: "IN_SEASON",
    training: { active: false },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    reasoning: "Tout va bien.",
    confidence: "MEDIUM",
    triggered_rules: [],
    planned_session_before: null,
    final_session: { kind: "REST" },
    decision: "KEEP",
    overrode_race_protocol: false,
    engine_version: "1.0.0",
  },
};

function renderDetailPage(decisionId = "d-1") {
  return render(
    <MemoryRouter initialEntries={[`/history/${decisionId}`]}>
      <Routes>
        <Route path="/history/:decisionId" element={<HistoryDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  // V0.3_007D — every existing test in this file predates the completed-
  // session lookup; default it to "no session" so those tests stay focused
  // on their own concern, exactly like before this ticket.
  mockedLoadCompleted.mockResolvedValue([]);
});

describe("HistoryDetailPage", () => {
  it("shows a loading state before the decision resolves", () => {
    mockedLoad.mockReturnValue(new Promise(() => {}));
    renderDetailPage();
    expect(screen.getByText(/Chargement/)).toBeInTheDocument();
  });

  it("fetches by the decisionId from the URL and the resolved athleteId — RLS is what actually protects it", async () => {
    mockedLoad.mockResolvedValue(VALID_ROW);
    renderDetailPage("d-1");
    await waitFor(() => expect(mockedLoad).toHaveBeenCalledWith("athlete-1", "d-1"));
  });

  it("shows a not-found state when no row is returned", async () => {
    mockedLoad.mockResolvedValue(null);
    renderDetailPage();
    await waitFor(() => expect(screen.getByText("Décision introuvable.")).toBeInTheDocument());
  });

  it("shows the fixed generic error message on the repo's own HistoryLoadError", async () => {
    mockedLoad.mockRejectedValue(new Error("Impossible de charger l'historique. Réessaie."));
    renderDetailPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger cette décision. Réessaie.");
  });

  it("never renders a raw/unexpected error message, even if the repo throws something other than HistoryLoadError", async () => {
    mockedLoad.mockRejectedValue(new Error("permission denied for table decisions"));
    renderDetailPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger cette décision. Réessaie.");
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("renders the stored DailyPlan via HistoryDetail on success, with the decision date and time", async () => {
    mockedLoad.mockResolvedValue(VALID_ROW);
    renderDetailPage();
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());
    expect(screen.getByText(/19 août/)).toBeInTheDocument();
  });

  it("links back to /history", async () => {
    mockedLoad.mockResolvedValue(VALID_ROW);
    renderDetailPage();
    await waitFor(() => expect(screen.getByText(/Historique/)).toBeInTheDocument());
    expect(screen.getByText(/Historique/).closest("a")).toHaveAttribute("href", "/history");
  });

  // V0.3_007D — Réalisé wiring: exact-date query, exact-FK classification.
  describe("Réalisé wiring (V0.3_007D)", () => {
    it("queries completed sessions for exactly this decision's own date, never a range", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      renderDetailPage();
      await waitFor(() => expect(mockedLoadCompleted).toHaveBeenCalledWith("athlete-1", ["2026-08-19"]));
    });

    it("CASE C: no completed session for that date -> 'Pas de séance enregistrée.'", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadCompleted.mockResolvedValue([]);
      renderDetailPage();
      await waitFor(() => expect(screen.getByText("Pas de séance enregistrée.")).toBeInTheDocument());
    });

    it("CASE A: an exact decision_id match renders the linked performed summary", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadCompleted.mockResolvedValue([
        {
          id: "cs-1",
          session_date: "2026-08-19",
          decision_id: "d-1",
          session_type: "REST",
          completion_status: "done",
          actual_duration_min: null,
          rpe: null,
          post_leg_fatigue: null,
          post_grip_fatigue: null,
          new_pain: false,
          new_pain_note: null,
          intervention: { kind: "REST" },
          main_content: null,
          session_load: null,
          updated_at: "2026-08-19T20:00:00Z",
          technical_outcome: null,
          change_reason: null,
          change_reason_note: null,
        },
      ]);
      renderDetailPage();
      await waitFor(() => expect(screen.getByText("Faite")).toBeInTheDocument());
      expect(screen.getByText("Repos")).toBeInTheDocument();
    });

    it("CASE B: a same-day session exists but decision_id belongs to a different decision -> neutral unassociated copy, never that session's own details", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadCompleted.mockResolvedValue([
        {
          id: "cs-1",
          session_date: "2026-08-19",
          decision_id: "some-other-decision",
          session_type: "DH_PERFORMANCE",
          completion_status: "done",
          actual_duration_min: 200,
          rpe: 8,
          post_leg_fatigue: null,
          post_grip_fatigue: null,
          new_pain: false,
          new_pain_note: null,
          intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
          main_content: null,
          session_load: null,
          updated_at: "2026-08-19T20:00:00Z",
          technical_outcome: null,
          change_reason: null,
          change_reason_note: null,
        },
      ]);
      renderDetailPage();
      await waitFor(() =>
        expect(screen.getByText("Une séance a été enregistrée ce jour-là, mais elle n'est pas associée à ce plan.")).toBeInTheDocument()
      );
      // The other decision's own performed details must never leak in here.
      expect(screen.queryByText("200 min")).not.toBeInTheDocument();
    });

    it("a completed-session load failure surfaces the same page-level error as a decision load failure", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadCompleted.mockRejectedValue(new Error("permission denied for table completed_sessions"));
      renderDetailPage();
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger cette décision. Réessaie.");
      expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    });
  });
});
