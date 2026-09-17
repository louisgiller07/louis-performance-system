import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";

/**
 * V0.3.014 — SAFETY-013-001 (GPT-6 review of V0.3.013). Diagnosis: a single
 * withDowngradedLoad() notch (e.g. DH_PERFORMANCE HEAVY -> MODERATE) was
 * still incoherent with the "avoid strong solicitation" protection message
 * when the zone is genuinely solicited — the kind never changes, and
 * dhPrescription.ts's own duration table often leaves duration_min entirely
 * unchanged (planned 240min < DH_PERFORMANCE/MODERATE's 270min provisional
 * cap -> min(240,270)=240, no visible reduction at all). Fix: apply the
 * SAME existing withDowngradedLoad() helper TWICE in the solicited branch
 * only (downgradeLoadProfile is already idempotent at LIGHT) — reuses the
 * already-tested downstream duration table + DH_LOAD_GUIDANCE text, no new
 * mechanism, no change to safety.ts/C3.x/reasoningBuilder.ts/longitudinal
 * memory/KEEP-MODIFY-REPLACE architecture. See docs/11_DECISION_LOG.md
 * V0.3.014.
 */
describe("T22 — SAFETY-013-001 pain prescription coherence (V0.3.014)", () => {
  it("DH_PERFORMANCE HEAVY + douleur genou (knee_R) 240min → LIGHT + durée visiblement réduite", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { pain: true, pain_intensity: 5, pain_location_code: "knee_R" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).not.toBe("REST");
    expect(plan.final_session.kind).toBe("DH_PERFORMANCE");
    // Two notches from HEAVY always lands on LIGHT (downgradeLoadProfile:
    // HEAVY->MODERATE->LIGHT), never stops at the still-incoherent MODERATE.
    expect(plan.final_session.load_profile).toBe("LIGHT");
    // Real, visible duration reduction — the exact gap SAFETY-013-001
    // reported (MODERATE's 270min provisional cap didn't bite against a
    // planned 240min; LIGHT's 180min provisional cap does).
    expect(plan.final_session.duration_min).toBeLessThan(240);
    expect(plan.final_session.duration_min).toBe(180);

    const pain_rule = plan.decision_reasoning!.find((r) => r.rule_id === "PAIN_NON_SAFETY");
    expect(pain_rule?.detail).toContain("adaptation de la séance");
  });

  it("douleur sans zone (pain_location_code absent) → adaptation cohérente (LIGHT), jamais REST", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { pain: true, pain_intensity: 5 },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).not.toBe("REST");
    expect(plan.final_session.kind).toBe("DH_PERFORMANCE");
    expect(plan.final_session.load_profile).toBe("LIGHT");
    expect(plan.protection.do_not_do.some((p) => p.includes("zone non précisée"))).toBe(true);
  });

  it("shoulder_L (upper_grip) sur activité grip → double downgrade appliqué (HEAVY -> LIGHT)", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
      checkin: { pain: true, pain_intensity: 5, pain_location_code: "shoulder_L" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "GRIP_WORK", load_profile: "LIGHT" });
  });

  it("douleur sévère (8/10, traumatique, perte de fonction) → REST inchangé (safety.ts non touché)", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { pain: true, pain_intensity: 8, pain_traumatic: true, pain_function_loss: true },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("REST");
    expect(plan.final_session).toEqual({ kind: "REST" });
    expect(plan.triggered_rules.some((r) => r.rule_id === "A4")).toBe(true);
  });

  it("garde-fou — séance déjà LIGHT + douleur sollicitée: reste LIGHT, jamais de réduction excessive/impossible", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "LIGHT", duration_min: 180 },
      checkin: { pain: true, pain_intensity: 5, pain_location_code: "knee_R" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session.kind).toBe("DH_PERFORMANCE");
    expect(plan.final_session.load_profile).toBe("LIGHT");
    // Nothing pathological: no lower-than-LIGHT profile exists, duration
    // stays at its already-minimal provisional value, decision reflects a
    // real (if load-invisible) adaptation rather than a crash/undefined.
    expect(plan.final_session.duration_min).toBe(180);
  });

  it("garde-fou — zone spécifiée mais non concernée (neck) : aucune réduction, pas de double downgrade appliqué", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { pain: true, pain_intensity: 5, pain_location_code: "neck" },
    });

    const plan = buildDailyPlan(ctx);

    // Zone not solicited by this session -> the `solicited` branch never
    // runs at all -> no downgrade of any magnitude, single or double.
    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 });
  });
});
