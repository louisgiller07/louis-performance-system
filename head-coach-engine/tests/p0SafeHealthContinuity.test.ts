/**
 * P0-SAFE (HPM 2026-10-12) — governed M1 evolution of the Safety layer (rules/safety.ts):
 *   A6 — a severe pain (≥ 6/10, A2's canonical threshold) protects even when not declared "new";
 *   A7 — an injury / illness / persistent-pain signal still open from a previous day keeps the day a REST
 *        until the rider closes it explicitly.
 * Each rule has its counter-proofs: A1–A5 unchanged, light pain and fatigue never blocked.
 */
import { describe, expect, it } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { evaluateSafety } from "../src/rules/safety.js";
import { baseCheckin, baseRawContext } from "../fixtures/louis.js";
import type { HealthFlag } from "../src/types/healthFlag.js";

const knee = (intensity: number, extra = {}) => ({ pain: true, pain_intensity: intensity, pain_new: false, pain_location_code: "knee_R", ...extra });
const injury: HealthFlag = { type: "injury_suspect", status: "active", flag_date: "2026-08-22" };
const illness: HealthFlag = { type: "illness", status: "active", flag_date: "2026-08-23" };
const concussion: HealthFlag = { type: "concussion_suspect", status: "active", flag_date: "2026-08-20" };
const DH = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 } as const;
/** Every athlete-facing string of a plan: no internal slug, no raw action token. */
const riderText = (plan: ReturnType<typeof buildDailyPlan>) =>
  [plan.reasoning, ...plan.triggered_rules.map((t) => t.detail), ...plan.protection.do_not_do, ...plan.monitoring.observe, ...plan.recovery.actions!].join(" | ");

describe("P0-SAFE — A6 severe pain, whatever its novelty", () => {
  it("incident A: knee 8/10, not new, no trauma, no function loss, not worse, on a planned 90-min DH → REST, injury signal, professional orientation", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: DH, checkin: knee(8) }));
    expect([plan.decision, plan.final_session]).toEqual(["REST", { kind: "REST" }]);
    expect(plan.triggered_rules).toEqual([expect.objectContaining({ layer: "A", rule_id: "A6", signals_used: ["pain_severe"] })]);
    expect(plan.health_flag_to_create).toEqual({ type: "injury_suspect", reason: "Douleur sévère déclarée (8/10) — knee_R" });
    expect(plan.reasoning).toBe("Douleur forte déclarée. Par prudence, NALYNT suspend ses propositions d'entraînement. L'avis d'un professionnel de santé est recommandé avant de reprendre l'entraînement.");
    expect(plan.dh_or_technical.active).toBe(false);
  });

  it("threshold is A2's own (6/10): 6 → A6, 5 → still non-Safety pain with the session kept and adapted", () => {
    expect(evaluateSafety(baseCheckin(knee(6)), [])?.rule_id).toBe("A6");
    expect(evaluateSafety(baseCheckin(knee(5)), [])).toBeNull();
    const plan = buildDailyPlan(baseRawContext({ planned_session: DH, checkin: knee(5) }));
    expect(plan.final_session.kind).toBe("DH_TECHNICAL");
    expect(plan.triggered_rules.map((t) => t.rule_id)).toContain("PAIN_NON_SAFETY");
  });

  it("precedence unchanged: new severe pain → A2 (same copy), gravity criterion → A4, fever → A3, concussion → A1", () => {
    const a2 = evaluateSafety(baseCheckin(knee(8, { pain_new: true })), []);
    expect(a2?.rule_id).toBe("A2");
    expect(a2?.reasoning).toBe("Douleur nouvelle et sévère déclarée. Repos et consultation d'un professionnel de santé recommandée avant de reprendre l'entraînement.");
    expect(evaluateSafety(baseCheckin(knee(8, { pain_traumatic: true })), [])?.rule_id).toBe("A4");
    expect(evaluateSafety(baseCheckin({ ...knee(8), fever_or_illness: true }), [])?.rule_id).toBe("A3");
    expect(evaluateSafety(baseCheckin({ ...knee(8), suspected_concussion: true }), [])?.rule_id).toBe("A1");
  });
});

describe("P0-SAFE — A7 open health signal from a previous day", () => {
  it("incident B: an open injury signal + a normal check-in on a planned DH → REST, reminded with type and date, no new signal", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: DH, active_health_flags: [injury] }));
    expect([plan.decision, plan.final_session]).toEqual(["REST", { kind: "REST" }]);
    expect(plan.triggered_rules).toEqual([expect.objectContaining({ layer: "A", rule_id: "A7", signals_used: ["unresolved_health_flag"] })]);
    expect(plan.health_flag_to_create).toBeUndefined();
    expect(plan.reasoning).toContain("suspicion de blessure du 22.08");
    expect(plan.reasoning).toMatch(/NALYNT suspend ses propositions d'entraînement tant qu'il n'est pas clôturé/);
    expect(plan.reasoning).toMatch(/clôturer dans l'application/);
    expect(plan.reasoning).toMatch(/professionnel de santé/);
    expect(plan.protection.do_not_do).toEqual(["Pas d'entraînement proposé par NALYNT tant que le signal de santé est ouvert"]);
  });

  it("illness and persistent pain are followed too; several open signals are all named", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, active_health_flags: [injury, illness] }));
    expect(plan.triggered_rules[0]!.rule_id).toBe("A7");
    expect(plan.reasoning).toContain("suspicion de blessure du 22.08, maladie / fièvre du 23.08");
    expect(evaluateSafety(baseCheckin(), [{ type: "pain_persistent", status: "monitoring" }])?.rule_id).toBe("A7");
  });

  it("a resolved signal never protects; a signal without date is named without inventing one", () => {
    expect(evaluateSafety(baseCheckin(), [{ ...injury, status: "resolved" }])).toBeNull();
    const plan = buildDailyPlan(baseRawContext({ active_health_flags: [{ type: "illness", status: "active" }] }));
    expect(plan.reasoning).toContain("(maladie / fièvre)");
  });

  it("today's declarations come first (A1–A4, A6 create or reuse the signal); A7 before A5 when both apply; A5 alone suspends (SPORT-SAFE-02)", () => {
    expect(evaluateSafety(baseCheckin(knee(8, { pain_new: true })), [injury])?.rule_id).toBe("A2");
    expect(evaluateSafety(baseCheckin(knee(7)), [injury])?.rule_id).toBe("A6");
    expect(evaluateSafety(baseCheckin({ suspected_concussion: true }), [injury])?.rule_id).toBe("A1");
    expect(evaluateSafety(baseCheckin(), [concussion, injury])?.rule_id).toBe("A7");
    const a5 = evaluateSafety(baseCheckin(), [concussion]);
    expect([a5?.rule_id, a5?.action]).toEqual(["A5", "REST"]);
  });

  it("other Safety REST plans keep their original copy byte for byte (only A7 has its own)", () => {
    const a3 = buildDailyPlan(baseRawContext({ checkin: { fever_or_illness: true } }));
    expect(a3.protection.do_not_do).toEqual(["Aucune activité physique tant que non validé médicalement"]);
    expect(a3.recovery.actions).toEqual(["Repos complet", "Suivre les consignes du professionnel de santé"]);
    expect(a3.monitoring.observe).toEqual(["Évolution des symptômes déclarés"]);
  });

  it("HPM wording: A6 / A7 suspend NALYNT's proposals, never a medical order of absolute rest", () => {
    for (const plan of [buildDailyPlan(baseRawContext({ checkin: knee(8) })), buildDailyPlan(baseRawContext({ active_health_flags: [injury] }))]) {
      const text = riderText(plan);
      expect(text).toMatch(/suspend/);
      expect(text).not.toMatch(/Aucune activité physique|repos complet|Repos complet|tant que non validé médicalement/);
    }
  });

  it("athlete-facing copy of A6 / A7 never exposes a slug or a raw action token", () => {
    for (const plan of [buildDailyPlan(baseRawContext({ checkin: knee(8) })), buildDailyPlan(baseRawContext({ active_health_flags: [injury, illness, { type: "pain_persistent", status: "active" }] }))]) {
      const text = riderText(plan);
      expect(text).not.toMatch(/injury_suspect|pain_persistent|illness\b|REST\b|SAFETY|A[1-7]\b/);
    }
  });
});

describe("P0-SAFE — no permanent block without a medical signal", () => {
  it("severe fatigue, short night, low energy, no pain → never a Safety rule, no signal", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: DH, checkin: { sleep_hours: 4, sleep_quality: 2, energy: 2, leg_fatigue: 9, grip_fatigue: 9 } }));
    expect(plan.triggered_rules.some((t) => t.layer === "A")).toBe(false);
    expect(plan.health_flag_to_create).toBeUndefined();
  });

  it("no open signal and a normal check-in → the planned session", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: DH }));
    expect([plan.decision, plan.final_session.kind]).toEqual(["KEEP", "DH_TECHNICAL"]);
  });
});
