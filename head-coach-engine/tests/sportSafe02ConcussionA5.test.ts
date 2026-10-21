/**
 * SPORT-SAFE-02 (HPM 2026-10-21) — CANDIDATE correction of A5, prepared locally; its publication needs a separate HPM
 * decision. An open concussion follow-up (`concussion_suspect` not resolved) suspends NALYNT's training proposals on
 * EVERY session family — never DH only with Force and endurance at their planned dose. Orientation to a health
 * professional; no return protocol; the signal is still closed only outside the rider's reach (unchanged).
 *
 * Counter-proof: on production main (582558b) A5 returns ZERO_DH and a planned Force / endurance session is KEPT at its
 * dose — every "suspends" test below fails there.
 */
import { describe, expect, it } from "vitest";
import { buildDailyPlan, ENGINE_VERSION } from "../src/engine/buildDailyPlan.js";
import { evaluateSafety } from "../src/rules/safety.js";
import { baseCheckin, baseRawContext } from "../fixtures/louis.js";
import type { HealthFlag } from "../src/types/healthFlag.js";
import type { TrainingIntervention } from "../src/types/trainingIntervention.js";

const concussion: HealthFlag = { type: "concussion_suspect", status: "active", flag_date: "2026-08-20" };
const injury: HealthFlag = { type: "injury_suspect", status: "active", flag_date: "2026-08-22" };
const riderText = (plan: ReturnType<typeof buildDailyPlan>) =>
  [plan.reasoning, ...plan.triggered_rules.map((t) => t.detail), ...plan.protection.do_not_do, ...plan.monitoring.observe, ...plan.recovery.actions!].join(" | ");

const PLANNED: Array<[string, TrainingIntervention | null]> = [
  ["DH technique", { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }],
  ["Force haut du corps", { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }],
  ["Force bas du corps", { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }],
  ["endurance", { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 60 }],
  ["récupération active", { kind: "RECOVERY_ACTIVE" }],
  ["aucune séance prévue", null],
];

describe("SPORT-SAFE-02 — A5: an open concussion follow-up suspends every family", () => {
  it("A5 is a Safety REST (layer A), creates no new signal", () => {
    const r = evaluateSafety(baseCheckin(), [concussion]);
    expect([r?.rule_id, r?.action, r?.triggered_rule.layer, r?.health_flag_to_create]).toEqual(["A5", "REST", "A", undefined]);
  });

  it.each(PLANNED)("planned %s → REST, no Force or endurance at its dose", (_, planned) => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: planned, active_health_flags: [concussion] }));
    expect([plan.decision, plan.final_session]).toEqual(["REST", { kind: "REST" }]);
    expect(plan.triggered_rules.map((t) => t.rule_id)).toEqual(["A5"]);
    expect(plan.training.active).toBe(false);
  });

  it("the rider reads a suspension of NALYNT's proposals and an orientation to a health professional — never a medical clearance, never a return protocol", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, active_health_flags: [concussion] }));
    expect(plan.reasoning).toBe(
      "Un suivi post-commotion est en cours. Par prudence, NALYNT suspend ses propositions d'entraînement tant que ce suivi est ouvert. Consulte un professionnel de santé : lui seul peut évaluer ta reprise et les activités possibles en attendant. NALYNT ne propose aucun protocole de reprise."
    );
    expect(plan.protection.do_not_do).toEqual(["Pas d'entraînement proposé par NALYNT tant que le suivi post-commotion est ouvert"]);
    expect(plan.monitoring.observe).toEqual(["Évolution des symptômes déclarés"]);
    expect(plan.recovery.actions).toEqual(["Propositions d'entraînement suspendues", "Consulter un professionnel de santé pour évaluer la reprise"]);
    const text = riderText(plan);
    expect(text).not.toMatch(/concussion_suspect|ZERO_DH|REST\b|Flag /);
    expect(text).not.toMatch(/autoris|reprise progressive|étape|le reste du plan/i);
  });

  it("a race day under an open concussion follow-up: REST, never the race activity", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "RACE_ACTIVITY" }, active_health_flags: [concussion] }));
    expect([plan.decision, plan.final_session.kind]).toEqual(["REST", "REST"]);
  });

  it("order unchanged: today's suspicion (A1) first; an open injury / illness follow-up (A7) before A5 — both suspend", () => {
    expect(evaluateSafety(baseCheckin({ suspected_concussion: true }), [concussion])?.rule_id).toBe("A1");
    const both = evaluateSafety(baseCheckin(), [concussion, injury]);
    expect([both?.rule_id, both?.action]).toEqual(["A7", "REST"]);
  });

  it("a resolved concussion signal no longer suspends: the next decision follows the plan (no return protocol is invented)", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, active_health_flags: [{ ...concussion, status: "resolved" }] }));
    expect(plan.triggered_rules.some((t) => t.layer === "A")).toBe(false);
    expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
  });

  it("A1 (suspicion declared today, A5-P0 candidate): a coaching suspension with an orientation, never « Repos complet », a signal created", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, checkin: { suspected_concussion: true } }));
    expect([plan.decision, plan.final_session.kind, plan.health_flag_to_create?.type]).toEqual(["REST", "REST", "concussion_suspect"]);
    expect(plan.reasoning).toBe(
      "Suspicion de commotion déclarée. Par prudence, NALYNT suspend ses propositions d'entraînement. Consulte un professionnel de santé : lui seul peut évaluer la situation, te dire quelles activités sont possibles et quand reprendre. NALYNT ne propose aucun protocole de reprise."
    );
    expect(plan.recovery.actions).toEqual(["Propositions d'entraînement suspendues", "Consulter un professionnel de santé"]);
    expect(plan.protection.do_not_do).toEqual(["Pas d'entraînement proposé par NALYNT tant que la suspicion de commotion n'a pas été évaluée"]);
    expect(riderText(plan)).not.toMatch(/Repos complet|REST|concussion_suspect|reprise progressive|étape/i);
  });

  it("the decisions carry the new provenance", () => {
    expect(ENGINE_VERSION).toBe("head-coach-engine@0.2.0-m1-sport-safe-02");
  });
});
