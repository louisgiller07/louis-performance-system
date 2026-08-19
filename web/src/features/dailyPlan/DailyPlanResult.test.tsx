import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyPlanResult } from "./DailyPlanResult";
import type { DailyPlan, DailyRunResponse } from "./dailyPlanTypes";

const BASE_PLAN: DailyPlan = {
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
  planned_session_before: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

function makeResult(planOverrides: Partial<DailyPlan> = {}, responseOverrides: Partial<DailyRunResponse> = {}): DailyRunResponse {
  return {
    dailyPlan: { ...BASE_PLAN, ...planOverrides },
    decisionId: "11111111-1111-1111-1111-111111111111",
    healthFlagId: null,
    warnings: [],
    ...responseOverrides,
  };
}

describe("DailyPlanResult", () => {
  it("renders a KEEP decision with its French label", () => {
    render(<DailyPlanResult result={makeResult({ decision: "KEEP" })} />);
    expect(screen.getByText("Maintenir")).toBeInTheDocument();
  });

  it("renders a MODIFY decision with its French label", () => {
    render(<DailyPlanResult result={makeResult({ decision: "MODIFY" })} />);
    expect(screen.getByText("Adapter")).toBeInTheDocument();
  });

  it("displays the confidence level", () => {
    render(<DailyPlanResult result={makeResult({ confidence: "HIGH" })} />);
    expect(screen.getByText(/Confiance élevée/i)).toBeInTheDocument();
  });

  it("displays the active_mode as a human-readable label, not the raw enum", () => {
    render(<DailyPlanResult result={makeResult({ active_mode: "RACE_WEEK" })} />);
    expect(screen.getByText(/Semaine de course/)).toBeInTheDocument();
    expect(screen.queryByText("RACE_WEEK")).not.toBeInTheDocument();
  });

  it("renders the training section when active", () => {
    render(
      <DailyPlanResult
        result={makeResult({
          training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "LIGHT" }, objective: "Travail de virages" },
        })}
      />
    );
    expect(screen.getByText("Entraînement")).toBeInTheDocument();
    expect(screen.getByText(/DH technique/)).toBeInTheDocument();
    expect(screen.getByText("Travail de virages")).toBeInTheDocument();
  });

  it("does not render an empty training card when the section is inactive", () => {
    render(<DailyPlanResult result={makeResult({ training: { active: false } })} />);
    expect(screen.queryByText("Entraînement")).not.toBeInTheDocument();
  });

  it("renders recovery actions", () => {
    render(<DailyPlanResult result={makeResult({ recovery: { active: true, actions: ["Bain froid", "Étirements"] } })} />);
    expect(screen.getByText("Récupération")).toBeInTheDocument();
    expect(screen.getByText("Bain froid")).toBeInTheDocument();
    expect(screen.getByText("Étirements")).toBeInTheDocument();
  });

  it("renders the sleep target", () => {
    render(<DailyPlanResult result={makeResult({ sleep: { active: true, target_hours: 9 } })} />);
    expect(screen.getByText(/9 h/)).toBeInTheDocument();
  });

  it("renders protection entries only when present", () => {
    const { rerender } = render(<DailyPlanResult result={makeResult({ protection: { do_not_do: ["Pas de squats lourds"] } })} />);
    expect(screen.getByText("À éviter")).toBeInTheDocument();
    expect(screen.getByText("Pas de squats lourds")).toBeInTheDocument();

    rerender(<DailyPlanResult result={makeResult({ protection: { do_not_do: [] } })} />);
    expect(screen.queryByText("À éviter")).not.toBeInTheDocument();
  });

  it("renders monitoring entries only when present", () => {
    const { rerender } = render(<DailyPlanResult result={makeResult({ monitoring: { observe: ["Douleur genou"] } })} />);
    expect(screen.getByText("À surveiller")).toBeInTheDocument();
    expect(screen.getByText("Douleur genou")).toBeInTheDocument();

    rerender(<DailyPlanResult result={makeResult({ monitoring: { observe: [] } })} />);
    expect(screen.queryByText("À surveiller")).not.toBeInTheDocument();
  });

  it("renders warnings", () => {
    render(<DailyPlanResult result={makeResult({}, { warnings: ["Le check-in date d'hier"] })} />);
    expect(screen.getByText("Avertissements")).toBeInTheDocument();
    expect(screen.getByText("Le check-in date d'hier")).toBeInTheDocument();
  });

  it("renders an explicit health signal banner when the server reports one", () => {
    render(
      <DailyPlanResult
        result={makeResult(
          { health_flag_to_create: { type: "pain_persistent", reason: "Douleur signalée 3 jours de suite" } },
          { healthFlagId: "33333333-3333-3333-3333-333333333333" }
        )}
      />
    );
    expect(screen.getByText("Attention santé")).toBeInTheDocument();
    expect(screen.getByText("Douleur signalée 3 jours de suite")).toBeInTheDocument();
  });

  it("does not render a health banner when there is no server-side health signal", () => {
    render(<DailyPlanResult result={makeResult({}, { healthFlagId: null })} />);
    expect(screen.queryByText("Attention santé")).not.toBeInTheDocument();
  });

  it("renders triggered_rules verbatim without interpreting rule_id", () => {
    render(
      <DailyPlanResult
        result={makeResult({
          triggered_rules: [{ layer: "A", rule_id: "A1", detail: "Sommeil insuffisant détecté sur 3 nuits." }],
        })}
      />
    );
    expect(screen.getByText("Pourquoi cette décision ?")).toBeInTheDocument();
    expect(screen.getByText("Sommeil insuffisant détecté sur 3 nuits.")).toBeInTheDocument();
    expect(screen.getByText("A · A1")).toBeInTheDocument();
  });

  it("shows a planned-vs-final comparison when the sessions materially differ", () => {
    render(
      <DailyPlanResult
        result={makeResult({
          decision: "REPLACE",
          planned_session_before: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
          final_session: { kind: "RECOVERY_ACTIVE" },
        })}
      />
    );
    expect(screen.getByText("Séance")).toBeInTheDocument();
    expect(screen.getByText(/DH performance/)).toBeInTheDocument();
    expect(screen.getByText(/Récupération active/)).toBeInTheDocument();
  });

  it("does not show a planned-vs-final comparison for a KEEP with an unchanged session", () => {
    render(
      <DailyPlanResult
        result={makeResult({
          decision: "KEEP",
          planned_session_before: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
          final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
        })}
      />
    );
    expect(screen.queryByText("Séance")).not.toBeInTheDocument();
  });

  it("does not show a planned-vs-final comparison when there was no prior planned session (planned_session_before === null), even for a KEEP", () => {
    render(
      <DailyPlanResult
        result={makeResult({
          decision: "KEEP",
          planned_session_before: null,
          final_session: { kind: "PUMPTRACK", load_profile: "LIGHT" },
        })}
      />
    );
    expect(screen.queryByText("Séance")).not.toBeInTheDocument();
    // training/final_session/decision are still shown as usual.
    expect(screen.getByText("Maintenir")).toBeInTheDocument();
  });

  it("gates the technical debug details behind decisionId/engine_version, not invented UI copy", () => {
    render(<DailyPlanResult result={makeResult({ engine_version: "2.3.1" })} />);
    // import.meta.env.DEV is true under vitest's default (non-production)
    // test mode, so the dev-only <details> is expected to render here; the
    // gate itself is a plain `import.meta.env.DEV &&` conditional in
    // DailyPlanResult.tsx, verified by inspection.
    expect(screen.getByText("Détails techniques")).toBeInTheDocument();
    expect(screen.getAllByText(/2\.3\.1/).length).toBeGreaterThan(0);
  });
});
