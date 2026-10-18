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

vi.mock("../features/guidedSession/executionRepo", () => ({
  loadDayExecutions: vi.fn(),
  loadExecutionPrescription: vi.fn(),
}));

import { loadDecisionById, loadCompletedSessionsForDates } from "../features/history/historyRepo";
import { loadDayExecutions, loadExecutionPrescription } from "../features/guidedSession/executionRepo";
import { prescriptionView } from "../test/guidedSessionFakeBackend";
import type { ExecutionRow, SetResultRow } from "../features/guidedSession/executionState";
import type { ExerciseItemView, DrillItemView } from "../features/finalPrescriptionV2/finalPrescriptionV2Types";
import { OTHER_DECISION_COPY, PRESCRIPTION_NO_LONGER_READABLE } from "../features/history/HistoryGuidedRealisation";

const mockedLoad = loadDecisionById as unknown as ReturnType<typeof vi.fn>;
const mockedLoadCompleted = loadCompletedSessionsForDates as unknown as ReturnType<typeof vi.fn>;
const mockedLoadExecutions = loadDayExecutions as unknown as ReturnType<typeof vi.fn>;
const mockedLoadPrescription = loadExecutionPrescription as unknown as ReturnType<typeof vi.fn>;

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
  // P0-4 — no guided execution unless a test says otherwise.
  mockedLoadExecutions.mockResolvedValue([]);
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
    await waitFor(() => expect(screen.getByText("Journée introuvable")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText("NALYNT te propose cette séance")).toBeInTheDocument());
    expect(screen.getByText(/19 août/)).toBeInTheDocument();
  });

  it("links back to /history", async () => {
    mockedLoad.mockResolvedValue(VALID_ROW);
    renderDetailPage();
    // UX-02 — the back link, distinct from the bottom tab bar's own "Historique" tab.
    await waitFor(() => expect(screen.getByRole("link", { name: "← Historique" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "← Historique" })).toHaveAttribute("href", "/history");
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
      await waitFor(() => expect(screen.getByText("Réalisée")).toBeInTheDocument());
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

  // P0-4 (HPM 2026-10-13) — "Réalisé" reads the guided V2 sessions really recorded (frozen prescription, active results).
  describe("Réalisé — guided V2 sessions (P0-4)", () => {
    const FORCE = prescriptionView("STRENGTH_LOWER");
    const DH = prescriptionView("DH_TECHNICAL");
    const SQUAT = FORCE.blocks.flatMap((b) => b.items).find((i) => i.kind === "exercise" && i.exerciseId === "goblet_squat") as ExerciseItemView;
    const DRILL = DH.blocks.find((b) => b.role === "main")!.items[0] as DrillItemView;
    let n = 0;
    const result = (itemId: string, setNumber: number, patch: Partial<SetResultRow> = {}): SetResultRow => ({
      id: `r-${(n += 1)}`, prescription_item_id: itemId, other_exercise_name: null, set_number: setNumber, done: true, measure_type: "reps", measure_value: 8, load_kg: 20, rpe_actual: 7,
      success: null, supersedes_id: null, occurred_at: "2026-08-19T07:10:00Z", recorded_at: `2026-08-19T07:${String(10 + n).padStart(2, "0")}:00Z`, ...patch,
    });
    const execution = (events: string[], results: SetResultRow[], fp: string, decisionId = "d-1"): ExecutionRow => ({
      id: `e-${events.join("-")}-${decisionId}`, session_date: "2026-08-19", decision_id: decisionId, final_prescription_id: fp, started_at: "2026-08-19T07:00:00Z", recorded_at: "2026-08-19T07:00:00Z",
      execution_events: events.map((event_type, i) => ({ event_type, event_seq: i + 1 })), exercise_set_results: results, session_activity_results: [],
    });
    const pass = (setNumber: number, success: boolean) => result(DRILL.prescriptionItemId, setNumber, { measure_type: "pass", measure_value: null, success, load_kg: null, rpe_actual: null });

    it("Force completed: status, frozen prescription, active results (a correction replaces its original), empty sets read 'Aucun résultat enregistré', no input", async () => {
      const original = result(SQUAT.prescriptionItemId, 1, { measure_value: 6 });
      const correction = result(SQUAT.prescriptionItemId, 1, { measure_value: 8, supersedes_id: original.id });
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadExecutions.mockResolvedValue([execution(["started", "completed"], [original, correction, result(SQUAT.prescriptionItemId, 2)], FORCE.id)]);
      mockedLoadPrescription.mockResolvedValue({ kind: "created", prescription: FORCE });
      renderDetailPage();
      // PARTIAL-01 — completed with 2 of its prescribed sets (slot 3 empty): partial, never « terminée » alone.
      expect(await screen.findByTestId("history-guided-status")).toHaveTextContent("◐ Séance guidée partiellement réalisée");
      const slot = (k: number) => (document.querySelector(`[data-slot="${SQUAT.prescriptionItemId.toLowerCase()}#${k}"]`) as HTMLElement).textContent;
      expect(slot(1)).toContain("Réalisé : 8 répétitions · RPE 7 · 20 kg · corrigée");
      expect(slot(2)).toContain("Réalisé : 8 répétitions · RPE 7 · 20 kg");
      expect(slot(3)).toContain("Aucun résultat enregistré");
      expect(screen.getByText(SQUAT.name)).toBeInTheDocument();
      expect(screen.queryByText("Pas de séance enregistrée.")).toBeNull();
      expect(screen.queryByRole("button", { name: /Saisir|Modifier|Enregistrer/ })).toBeNull();
      expect(screen.queryByText("À faire maintenant")).toBeNull();
      expect(mockedLoadPrescription).toHaveBeenCalledWith(FORCE.id);
    });

    it("DH stopped with 2 passes: 'Séance guidée arrêtée', the passes and their criterion", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadExecutions.mockResolvedValue([execution(["started", "abandoned"], [pass(1, true), pass(2, false)], DH.id)]);
      mockedLoadPrescription.mockResolvedValue({ kind: "created", prescription: DH });
      renderDetailPage();
      expect(await screen.findByTestId("history-guided-status")).toHaveTextContent("Séance guidée arrêtée");
      const passes = screen.getAllByTestId("pass-result").map((p) => p.textContent);
      expect(passes.slice(0, 3)).toEqual(["Enregistré · Critère atteint : Oui", "Enregistré · Critère atteint : Non", "Aucun résultat enregistré"]);
      expect(screen.getByTestId("dh-progress")).toHaveTextContent(`2 / ${DRILL.passes} passages enregistrés`);
    });

    it("an open session reads 'Séance guidée en cours'", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadExecutions.mockResolvedValue([execution(["started"], [], FORCE.id)]);
      mockedLoadPrescription.mockResolvedValue({ kind: "created", prescription: FORCE });
      renderDetailPage();
      expect(await screen.findByTestId("history-guided-status")).toHaveTextContent("Séance guidée en cours");
    });

    it("a guided session recorded from ANOTHER decision of the day: said and linked, never 'Pas de séance enregistrée'", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadExecutions.mockResolvedValue([execution(["started", "completed"], [result(SQUAT.prescriptionItemId, 1)], FORCE.id, "d-other")]);
      renderDetailPage();
      expect(await screen.findByText(OTHER_DECISION_COPY)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Voir la séance enregistrée" })).toHaveAttribute("href", "/history/d-other");
      expect(screen.queryByText("Pas de séance enregistrée.")).toBeNull();
      expect(mockedLoadPrescription).not.toHaveBeenCalled();
    });

    it("V1 first: a completed_sessions row linked to the decision keeps the historical rendering", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadCompleted.mockResolvedValue([{ id: "cs-1", session_date: "2026-08-19", decision_id: "d-1", session_type: "REST", completion_status: "done", actual_duration_min: null, rpe: null, post_leg_fatigue: null, post_grip_fatigue: null, new_pain: false, new_pain_note: null, intervention: { kind: "REST" }, main_content: null, session_load: null, updated_at: "2026-08-19T20:00:00Z", technical_outcome: null, change_reason: null, change_reason_note: null }]);
      mockedLoadExecutions.mockResolvedValue([execution(["started", "completed"], [], FORCE.id)]);
      mockedLoadPrescription.mockResolvedValue({ kind: "created", prescription: FORCE });
      renderDetailPage();
      expect(await screen.findByText("Réalisée")).toBeInTheDocument();
      expect(screen.queryByTestId("history-guided-status")).toBeNull();
    });

    it("an older catalogue (prescription no longer readable): neutral note, the recorded values stay readable", async () => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      mockedLoadExecutions.mockResolvedValue([execution(["started", "completed"], [result(SQUAT.prescriptionItemId, 1), result(SQUAT.prescriptionItemId, 2, { rpe_actual: null, load_kg: null })], "fp-old")]);
      mockedLoadPrescription.mockResolvedValue({ kind: "unsupported_schema_or_catalog", reason: "catalogue session-model-v2.1" });
      renderDetailPage();
      expect(await screen.findByText(PRESCRIPTION_NO_LONGER_READABLE)).toBeInTheDocument();
      const values = screen.getByTestId("history-recorded-values");
      expect(values).toHaveTextContent("Exercice 1");
      expect(values).toHaveTextContent("Série 1 · 8 répétitions · RPE 7 · 20 kg");
      expect(values).toHaveTextContent("Série 2 · 8 répétitions");
    });

    it.each([
      ["the executions read", () => mockedLoadExecutions.mockRejectedValue(new Error("network"))],
      [
        "the frozen prescription read",
        () => {
          mockedLoadExecutions.mockResolvedValue([execution(["started", "completed"], [], FORCE.id)]);
          mockedLoadPrescription.mockRejectedValue(new Error("network"));
        },
      ],
    ])("a failure of %s is the page error, never 'Pas de séance enregistrée'", async (_label, arrange) => {
      mockedLoad.mockResolvedValue(VALID_ROW);
      arrange();
      renderDetailPage();
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger cette décision. Réessaie."));
      expect(screen.queryByText("Pas de séance enregistrée.")).toBeNull();
    });
  });
});
