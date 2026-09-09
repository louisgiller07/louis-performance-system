import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyPlanResult } from "./DailyPlanResult";
import { DailyPlanView } from "./DailyPlanView";
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

  // V0.3_005C (NAL-002) — the exact dogfood-observed leak: sleep.notes
  // currently always carries an internal placeholder/doc-reference string
  // from the engine, never athlete copy. The presentation boundary must
  // replace it with clean French, never render the raw field. Rendered via
  // DailyPlanView directly (no technicalMetadata) so this proves the
  // athlete-facing rendering path specifically, not the dev-only debug
  // panel (which legitimately still dumps the raw DailyPlan for
  // developers — import.meta.env.DEV only, never in a production build).
  it("never renders the raw internal sleep.notes string (PROVISIONAL / docs path)", () => {
    render(
      <DailyPlanView
        dailyPlan={{
          ...BASE_PLAN,
          sleep: {
            active: true,
            target_hours: 8,
            notes: "Cible sommeil PROVISIONAL — à individualiser (docs/03_COACHING_MODEL.md C4.1)",
          },
        }}
        hasHealthSignal={false}
      />
    );
    expect(screen.queryByText(/PROVISIONAL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/docs\//)).not.toBeInTheDocument();
    expect(screen.queryByText(/03_COACHING_MODEL/)).not.toBeInTheDocument();
    expect(screen.getByText("Repère générique, pas encore individualisé pour toi.")).toBeInTheDocument();
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

  // V0.3_005C (NAL-002) — warnings are internal adapter diagnostics, never
  // athlete copy (every current producer is a data-reconciliation note,
  // e.g. an ambiguous legacy row) — never rendered to the athlete, even
  // though the underlying data is still fully present in DailyRunResponse.
  it("never renders warnings to the athlete, regardless of content", () => {
    render(<DailyPlanResult result={makeResult({}, { warnings: ["Le check-in date d'hier"] })} />);
    expect(screen.queryByText("Avertissements")).not.toBeInTheDocument();
    expect(screen.queryByText("Le check-in date d'hier")).not.toBeInTheDocument();
  });

  it("never renders an internal doc-provenance warning, even if one is present in the response", () => {
    render(
      <DailyPlanView
        dailyPlan={BASE_PLAN}
        warnings={[
          'race_calendar row "X" has race_format = NULL — mapped to "OTHER". See docs/05_DATA_MODEL.md §race_calendar and docs/11_DECISION_LOG.md.',
        ]}
        hasHealthSignal={false}
      />
    );
    expect(screen.queryByText(/docs\//)).not.toBeInTheDocument();
    expect(screen.queryByText("Avertissements")).not.toBeInTheDocument();
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

  // V0.3_006A1 — corrects the prior expectation: rule.detail is shown, but
  // rule.layer/rule.rule_id (e.g. "A · A1") must never be rendered as
  // athlete copy (see safetyPresentation.ts). The underlying triggered_rules
  // array itself is untouched — only what's rendered changes.
  // Rendered via DailyPlanView directly (no technicalMetadata) — the
  // dev-only debug <pre> legitimately still dumps the raw rule_id, exactly
  // like the sleep.notes/concussion_suspect precedents above.
  it("renders triggered_rules' detail text, but never the raw layer/rule_id", () => {
    render(
      <DailyPlanView
        dailyPlan={{
          ...BASE_PLAN,
          triggered_rules: [{ layer: "A", rule_id: "A1", detail: "Sommeil insuffisant détecté sur 3 nuits." }],
        }}
        hasHealthSignal={false}
      />
    );
    expect(screen.getByText("Pourquoi cette décision ?")).toBeInTheDocument();
    expect(screen.getByText("Sommeil insuffisant détecté sur 3 nuits.")).toBeInTheDocument();
    expect(screen.queryByText("A · A1")).not.toBeInTheDocument();
    expect(screen.queryByText(/A1/)).not.toBeInTheDocument();
  });

  // V0.3_006A1 (REV2-003) — the exact reviewer-observed leak: A5's own
  // triggered_rule.detail embeds the raw HealthFlagType slug
  // "concussion_suspect". Must never reach the athlete, in either the
  // always-visible hero reasoning or the "Pourquoi cette décision ?"
  // collapsible — while the underlying DailyPlan (triggered_rules, dailyPlan
  // itself) stays byte-for-byte what the engine emitted. Rendered via
  // DailyPlanView directly (no technicalMetadata), same as the sleep.notes
  // precedent above — the dev-only debug <pre> legitimately still dumps the
  // raw DailyPlan (import.meta.env.DEV only), which is exactly where
  // "technical provenance persisted" is expected to remain.
  it("never renders the raw concussion_suspect slug or A · A5, in hero or collapsible, for an A5 plan", () => {
    const a5Detail = "Flag concussion_suspect actif non résolu — DH interdit tant que non validé médicalement";
    render(
      <DailyPlanView
        dailyPlan={{
          ...BASE_PLAN,
          reasoning: a5Detail,
          triggered_rules: [{ layer: "A", rule_id: "A5", detail: a5Detail }],
          protection: { do_not_do: ["Aucune activité DH tant que la validation médicale post-commotion n'est pas obtenue"] },
        }}
        hasHealthSignal={false}
      />
    );
    expect(screen.queryByText(/concussion_suspect/)).not.toBeInTheDocument();
    expect(screen.queryByText("A · A5")).not.toBeInTheDocument();
    expect(screen.queryByText(/A5/)).not.toBeInTheDocument();
    // Factual, athlete-safe replacement text is shown instead (appears both
    // in the hero and the collapsible, since both derive from the same
    // sanitized rule).
    expect(screen.getAllByText(/toujours actif/).length).toBeGreaterThan(0);
  });

  // V0.3_006A1 — the flip side of the test above: technical provenance
  // (the raw A5 rule_id and the concussion_suspect slug) must still be
  // fully present in the persisted DailyPlan / dev-only debug panel — this
  // is a presentation sanitization, not data deletion.
  it("still carries the raw A5 rule_id and concussion_suspect slug in the underlying DailyPlan / dev debug panel", () => {
    const a5Detail = "Flag concussion_suspect actif non résolu — DH interdit tant que non validé médicalement";
    render(
      <DailyPlanResult
        result={makeResult({
          reasoning: a5Detail,
          triggered_rules: [{ layer: "A", rule_id: "A5", detail: a5Detail }],
        })}
      />
    );
    // import.meta.env.DEV is true under vitest, so the raw JSON dump is present.
    expect(screen.getByText("Détails techniques")).toBeInTheDocument();
    expect(screen.getAllByText(/concussion_suspect/).length).toBeGreaterThan(0);
  });

  // V0.3_006A1 (REV2-003) — presentation precedence: when a Safety-layer (A)
  // rule is active, "À éviter" must render before "Récupération" so a
  // generic Recovery suggestion never visually reads as overriding an active
  // Safety restriction. Pure DOM order — content of either section is
  // unchanged.
  it("renders À éviter before Récupération when a Safety-layer rule is active", () => {
    render(
      <DailyPlanResult
        result={makeResult({
          triggered_rules: [{ layer: "A", rule_id: "A5", detail: "Flag concussion_suspect actif non résolu." }],
          protection: { do_not_do: ["Aucune activité DH tant que la validation médicale post-commotion n'est pas obtenue"] },
          recovery: { active: true, actions: ["Journée orientée récupération : mobilité douce, marche, pas de charge structurée"] },
        })}
      />
    );
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("À éviter")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("Récupération")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("À éviter")).toBeLessThan(headings.indexOf("Récupération"));
  });

  // V0.3_006A1 — regression: without any Safety-layer rule, ordering stays
  // exactly as before (Récupération, then À éviter further down) — the
  // precedence swap is conditional, not a global reorder.
  it("keeps the original Récupération-before-À éviter order when no Safety-layer rule is active", () => {
    render(
      <DailyPlanResult
        result={makeResult({
          triggered_rules: [],
          protection: { do_not_do: ["Pas de squats lourds"] },
          recovery: { active: true, actions: ["Étirements 10 min"] },
        })}
      />
    );
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Récupération")).toBeLessThan(headings.indexOf("À éviter"));
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
