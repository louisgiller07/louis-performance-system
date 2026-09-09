import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryDetail } from "./HistoryDetail";
import type { DecisionHistoryRow } from "./historyTypes";

const VALID_DAILY_PLAN = {
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
  final_session: { kind: "PUMPTRACK", load_profile: "LIGHT" },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

function makeRow(overrides: Partial<DecisionHistoryRow> = {}): DecisionHistoryRow {
  return {
    id: "d-1",
    decisionDate: "2026-08-19",
    createdAt: "2026-08-19T08:00:00Z",
    finalSessionDb: "REST",
    activeModeDb: "IN_SEASON",
    confidenceLevelDb: "MEDIUM",
    dailyPlan: VALID_DAILY_PLAN,
    ...overrides,
  };
}

describe("HistoryDetail", () => {
  it("renders the stored DailyPlan via the shared DailyPlanView for a valid row", () => {
    render(<HistoryDetail row={makeRow()} />);
    expect(screen.getByText("Maintenir")).toBeInTheDocument();
    expect(screen.getByText("Tout va bien.")).toBeInTheDocument();
  });

  it("does not render an empty card for an inactive section", () => {
    render(<HistoryDetail row={makeRow()} />);
    expect(screen.queryByText("Entraînement")).not.toBeInTheDocument();
  });

  it("renders an explicit health signal only when persisted in the stored DailyPlan", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: { ...VALID_DAILY_PLAN, health_flag_to_create: { type: "pain_persistent", reason: "Douleur 3 jours de suite" } },
        })}
      />
    );
    expect(screen.getByText("Attention santé")).toBeInTheDocument();
    expect(screen.getByText("Douleur 3 jours de suite")).toBeInTheDocument();
  });

  it("shows no health banner when the stored DailyPlan carries no health_flag_to_create", () => {
    render(<HistoryDetail row={makeRow()} />);
    expect(screen.queryByText("Attention santé")).not.toBeInTheDocument();
  });

  it("shows a degraded, safe fallback for a malformed/legacy stored plan, without crashing", () => {
    render(<HistoryDetail row={makeRow({ dailyPlan: { decision: "NOT_A_REAL_ENUM" }, finalSessionDb: "STRENGTH_A" })} />);

    expect(screen.getByText(/ne peut pas être affichée complètement/)).toBeInTheDocument();
    expect(screen.getByText("STRENGTH_A")).toBeInTheDocument();
    // Never invents a decision label from an untrusted shape.
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
  });

  it("enriches the degraded fallback with the real activeModeDb/confidenceLevelDb DB columns when present", () => {
    render(
      <HistoryDetail
        row={makeRow({ dailyPlan: { decision: "NOT_A_REAL_ENUM" }, activeModeDb: "RACE_WEEK", confidenceLevelDb: "HIGH" })}
      />
    );
    expect(screen.getByText(/Semaine de course/)).toBeInTheDocument();
    expect(screen.getByText(/Élevée/)).toBeInTheDocument();
  });

  it("omits mode/confidence from the degraded fallback for a pre-M2 row where both are null, never fabricating them", () => {
    render(<HistoryDetail row={makeRow({ dailyPlan: null, activeModeDb: null, confidenceLevelDb: null })} />);
    expect(screen.getByText(/ne peut pas être affichée complètement/)).toBeInTheDocument();
    expect(screen.queryByText(/Mode :/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confiance :/)).not.toBeInTheDocument();
  });

  // REV-001 — a fresh athlete's persisted decision (active_mode: UNSPECIFIED,
  // legitimate engine output since V0.3_004C) must render via the normal
  // rich DailyPlanView path, exactly like any other modern valid decision —
  // never the degraded fallback, and never the raw "UNSPECIFIED" string.
  it("renders a fresh-athlete row (active_mode: UNSPECIFIED) via the normal rich path, never the degraded fallback", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: { ...VALID_DAILY_PLAN, active_mode: "UNSPECIFIED", final_session: { kind: "RECOVERY_ACTIVE" } },
          activeModeDb: "UNSPECIFIED",
        })}
      />
    );
    expect(screen.queryByText(/ne peut pas être affichée complètement/)).not.toBeInTheDocument();
    expect(screen.getByText(/Phase non configurée/)).toBeInTheDocument();
    expect(screen.queryByText("UNSPECIFIED")).not.toBeInTheDocument();
  });

  // V0.3_006B — Session Prescription V1 (DH-first): History reuses the same
  // DailyPlanView as Today, from the persisted decisions.daily_plan JSONB
  // only — no recomputation, same consolidated "Séance DH" card.
  it("renders the consolidated 'Séance DH' card, hour-formatted, from a persisted decision", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: {
            ...VALID_DAILY_PLAN,
            training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, objective: "Séance DH" },
            dh_or_technical: { active: true, focus: "Précision et qualité d'exécution", spot_hint: "Terrain adapté au focus technique du jour." },
            final_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 240 },
          },
        })}
      />
    );
    expect(screen.getByText("Séance DH")).toBeInTheDocument();
    expect(screen.getByText(/Fenêtre de session\s*:\s*environ 4 h/)).toBeInTheDocument();
    expect(screen.queryByText("240 min")).not.toBeInTheDocument();
  });

  // A row persisted before V0.3_006B never had duration_min on a DH
  // final_session at all — must remain a fully valid, richly-rendered
  // History row, simply without a session-window line.
  it("a legacy DH row (persisted before V0.3_006B, no duration_min) still renders the rich path, no crash", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: {
            ...VALID_DAILY_PLAN,
            training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, objective: "Séance DH" },
            dh_or_technical: { active: true, focus: "Précision et qualité d'exécution", spot_hint: "Terrain adapté au focus technique du jour." },
            final_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
          },
        })}
      />
    );
    expect(screen.queryByText(/ne peut pas être affichée complètement/)).not.toBeInTheDocument();
    expect(screen.getByText("Séance DH")).toBeInTheDocument();
    expect(screen.queryByText(/Fenêtre de session/)).not.toBeInTheDocument();
  });
});
