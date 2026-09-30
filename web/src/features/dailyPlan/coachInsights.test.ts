import { describe, expect, it } from "vitest";
// Drift guard sources: every file of the frozen M1 engine that emits a check-in signal name.
import mentalSource from "../../../../head-coach-engine/src/domains/mental.ts?raw";
import trainingSource from "../../../../head-coach-engine/src/domains/training.ts?raw";
import dimensionsSource from "../../../../head-coach-engine/src/engine/computeDimensions.ts?raw";
import safetySource from "../../../../head-coach-engine/src/rules/safety.ts?raw";
import { coachWhy, retainedSignals, SIGNAL_LABELS } from "./coachInsights";
import type { DailyPlan, TriggeredRule } from "./dailyPlanTypes";

const BASE: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } },
  dh_or_technical: { active: true },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Raisonnement du moteur.",
  confidence: "HIGH",
  triggered_rules: [],
  planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 240 },
  final_session: { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 150 },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

const rule = (layer: TriggeredRule["layer"], signals: string[], detail = "détail"): TriggeredRule => ({ layer, rule_id: "X", detail, signals_used: signals });

describe("SIGNAL_LABELS — drift guard against the frozen engine", () => {
  it("every signal name the engine can emit has a rider-facing label", () => {
    const emitted = new Set<string>();
    for (const source of [mentalSource, trainingSource, dimensionsSource, safetySource]) {
      for (const match of source.matchAll(/signals_used:\s*\[([^\]]*)\]/g)) {
        for (const literal of match[1]!.matchAll(/"([a-z_]+)"/g)) emitted.add(literal[1]!);
      }
      for (const match of source.matchAll(/raw_signals\.push\("([a-z_]+)"\)/g)) emitted.add(match[1]!);
    }
    expect(emitted.size).toBeGreaterThanOrEqual(10);
    const missing = [...emitted].filter((signal) => !Object.prototype.hasOwnProperty.call(SIGNAL_LABELS, signal));
    expect(missing).toEqual([]);
  });

  it("labels are rider French, never an identifier", () => {
    for (const label of Object.values(SIGNAL_LABELS)) expect(label).not.toMatch(/_|[A-Z]{2,}/);
  });
});

describe("retainedSignals", () => {
  it("reads only what the engine consumed for the final decision (decision_reasoning), deduplicated by label, in order", () => {
    const plan = {
      ...BASE,
      triggered_rules: [rule("C", ["recent_load_very_high"])],
      decision_reasoning: [rule("C", ["leg_fatigue_high"]), rule("A", ["pain_new_severe", "pain_severity_criterion"]), rule("C", ["stress_high"])],
    };
    expect(retainedSignals(plan).map((entry) => entry.label)).toEqual(["Fatigue jambes élevée", "Douleur signalée", "Stress élevé"]);
  });

  it("falls back to triggered_rules for a decision persisted before decision_reasoning existed", () => {
    expect(retainedSignals({ ...BASE, triggered_rules: [rule("C", ["sleep_deficit"])] }).map((entry) => entry.label)).toEqual(["Nuit trop courte"]);
  });

  it("an unknown signal is never shown (no raw identifier)", () => {
    expect(retainedSignals({ ...BASE, decision_reasoning: [rule("C", ["future_signal_x", "toString"])] })).toEqual([]);
  });
});

describe("coachWhy — validated wording (UX-04)", () => {
  it("Maintenir without a retained signal", () => {
    expect(coachWhy({ ...BASE, decision: "KEEP" })).toBe("Rien dans ton état du jour ne nécessite d'adaptation. Tu suis ton plan.");
  });

  it("Adapter: the detected signal(s), then the charge is adjusted to preserve the objective", () => {
    expect(coachWhy({ ...BASE, decision: "MODIFY", decision_reasoning: [rule("C", ["leg_fatigue_high"])] })).toBe(
      "Signal détecté : fatigue jambes élevée. La charge est ajustée pour préserver ton objectif."
    );
    expect(coachWhy({ ...BASE, decision: "MODIFY", decision_reasoning: [rule("C", ["sleep_deficit", "energy_low"])] })).toBe(
      "Signaux détectés : nuit trop courte, énergie basse. La charge est ajustée pour préserver ton objectif."
    );
  });

  it("Remplacer: the detected signal, then an adapted session", () => {
    expect(coachWhy({ ...BASE, decision: "REPLACE", decision_reasoning: [rule("C", ["grip_fatigue_high"])] })).toBe(
      "Signal détecté : avant-bras fatigués. Ton état du jour demande une autre approche."
    );
  });

  it.each([
    ["REST", { decision: "REST" as const }],
    ["an active safety rule (layer A)", { decision: "MODIFY" as const, decision_reasoning: [rule("A", ["fever_or_illness"])] }],
    ["a race protocol rule (layer B)", { decision: "MODIFY" as const, decision_reasoning: [rule("B", [])] }],
    ["an overridden race protocol", { decision: "MODIFY" as const, overrode_race_protocol: true, decision_reasoning: [rule("C", ["leg_fatigue_high"])] }],
    ["no planned session to compare against", { decision: "KEEP" as const, planned_session_before: null }],
    ["an adaptation without any retained signal", { decision: "MODIFY" as const }],
  ])("%s: the engine's own sanitized reasoning, never a template", (_label, overrides: Partial<DailyPlan>) => {
    expect(coachWhy({ ...BASE, ...overrides, triggered_rules: overrides.decision_reasoning ?? [] })).toBe("Raisonnement du moteur.");
  });

  it("never judges a value the engine did not flag (no 'sommeil est bon')", () => {
    for (const decision of ["KEEP", "MODIFY", "REPLACE"] as const) {
      expect(coachWhy({ ...BASE, decision, decision_reasoning: [rule("C", ["leg_fatigue_high"])] })).not.toMatch(/bon|bonne|excellent/i);
    }
  });
});
