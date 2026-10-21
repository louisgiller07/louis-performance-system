import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyPlanResult } from "./DailyPlanResult";
import type { DailyPlan, DailyRunResponse } from "./dailyPlanTypes";
import safetySource from "../../../../head-coach-engine/src/rules/safety.ts?raw";

// SPORT-SAFE-02 (HPM 2026-10-21, candidate) — Today under an open concussion follow-up: the A5 REST the engine now
// returns (head-coach-engine/src/rules/safety.ts) reads as a coaching suspension with an orientation, never a Force
// or endurance session at its dose, never a return protocol.

const DETAIL = "Suivi post-commotion ouvert — propositions d'entraînement suspendues jusqu'à l'évaluation d'un professionnel de santé";
const REASONING =
  "Un suivi post-commotion est en cours. Par prudence, NALYNT suspend ses propositions d'entraînement tant que ce suivi est ouvert. Consulte un professionnel de santé : lui seul peut évaluer ta reprise et les activités possibles en attendant. NALYNT ne propose aucun protocole de reprise.";
const DO_NOT = "Pas d'entraînement proposé par NALYNT tant que le suivi post-commotion est ouvert";

const A5_REST: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: false },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: true, actions: ["Propositions d'entraînement suspendues", "Consulter un professionnel de santé pour évaluer la reprise"] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [DO_NOT] },
  monitoring: { observe: ["Évolution des symptômes déclarés"] },
  reasoning: REASONING,
  confidence: "HIGH",
  triggered_rules: [{ layer: "A", rule_id: "A5", detail: DETAIL, signals_used: ["unresolved_concussion_flag"] }],
  decision_reasoning: [{ layer: "A", rule_id: "A5", detail: DETAIL, signals_used: ["unresolved_concussion_flag"] }],
  planned_session_before: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
  final_session: { kind: "REST" },
  decision: "REST",
  overrode_race_protocol: false,
  engine_version: "head-coach-engine@0.2.0-m1-sport-safe-02",
};
const result: DailyRunResponse = { dailyPlan: A5_REST, decisionId: "22222222-2222-2222-2222-222222222222", healthFlagId: null, warnings: [] };

describe("SPORT-SAFE-02 — Today under an open concussion follow-up", () => {
  it("the fixture is the engine's own copy (drift guard)", () => {
    for (const text of [DETAIL, REASONING, DO_NOT]) expect(safetySource).toContain(text);
  });

  it("« Coaching suspendu », the A5 sentence, the orientation; no planned Force session offered", () => {
    render(<DailyPlanResult result={result} />);
    // Athlete copy only: the collapsed « Détails techniques » debug dump (raw JSON, unchanged) is left out.
    const visible = document.body.cloneNode(true) as HTMLElement;
    visible.querySelectorAll("details").forEach((d) => d.remove());
    expect(screen.getAllByText(/Coaching suspendu/).length).toBeGreaterThan(0);
    expect(visible.textContent).toContain("Consulte un professionnel de santé");
    expect(visible.textContent).toContain(DO_NOT);
    expect(visible.textContent).not.toMatch(/concussion_suspect|ZERO_DH|\bREST\b|Flag /);
    expect(visible.textContent).not.toMatch(/reprise progressive|autorisation de reprise|le reste du plan/i);
    expect(screen.queryByTestId("dh-grip-safety")).toBeNull();
  });
});
