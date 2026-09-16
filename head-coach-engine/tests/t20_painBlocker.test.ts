import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";

/**
 * V0.3.013 — PILOT-BLOCK-001 (Douleur non-SAFETY / painNonSafety.ts).
 *
 * Bug: pain reported with NO zone specified (pain_location_code is
 * optional — checkinValidation.ts) always resolved to zoneCategory
 * "other" -> never "solicited" -> the session was never adapted, while the
 * generic protection message ("Éviter toute charge sollicitant fortement
 * zone non précisée") was still shown next to the full, unmodified
 * prescription — a safety restriction rendered as pure information next
 * to an incompatible prescription. Fixed: unspecified location now
 * defaults to "possibly solicited" (cautious one-notch downgrade, never
 * REST, never a new safety action) for any session whose intensity is
 * actually adaptable. A specified-but-unclassified zone (e.g. "neck") is
 * deliberately left unchanged — no product decision made on that here.
 * See docs/11_DECISION_LOG.md V0.3.013.
 */
describe("T20 — PILOT-BLOCK-001 pain safety-blocker (V0.3.013)", () => {
  it("Cas 1 — douleur 5/10, non traumatique, sans perte de fonction, ZONE NON PRÉCISÉE: no contradiction, prescription adapted, reasoning coherent", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: {
        pain: true,
        pain_intensity: 5,
        pain_new: false,
        pain_traumatic: false,
        pain_function_loss: false,
        pain_getting_worse: false,
        // pain_location_code intentionally omitted — the exact reproduction case.
      },
    });

    const plan = buildDailyPlan(ctx);

    // No SAFETY escalation — this is non-SAFETY pain, never REST.
    expect(plan.decision).not.toBe("REST");
    expect(plan.final_session.kind).toBe("DH_PERFORMANCE");

    // The bug: the session stayed HEAVY (unmodified, "aggressive") while a
    // protection message told the athlete to protect the zone. Fixed
    // behavior: the load is actually downgraded — prescription and
    // restriction are now compatible. (duration_min is separately
    // recomputed by dhPrescription.ts's own policy — not asserted here.)
    expect(plan.final_session.kind).toBe("DH_PERFORMANCE");
    expect(plan.final_session.load_profile).toBe("MODERATE");

    // Protection message present (still shown — the restriction itself is real).
    expect(plan.protection.do_not_do.some((p) => p.includes("zone non précisée"))).toBe(true);

    // decision_reasoning (V0.3.012) must actually reflect the adaptation —
    // never a bare "protect" info line next to an unexplained load change.
    expect(plan.decision_reasoning).toBeDefined();
    const pain_rule = plan.decision_reasoning!.find((r) => r.rule_id === "PAIN_NON_SAFETY");
    expect(pain_rule).toBeDefined();
    expect(pain_rule!.detail).toContain("adaptation de la séance");
    expect(plan.reasoning).toContain("adaptation de la séance");
  });

  it("Cas 2 — douleur 8/10, traumatique, perte de fonction: REST conservé (A4, regression lock)", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: {
        pain: true,
        pain_intensity: 8,
        pain_traumatic: true,
        pain_function_loss: true,
        pain_getting_worse: false,
      },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("REST");
    expect(plan.final_session).toEqual({ kind: "REST" });
    expect(plan.triggered_rules.some((r) => r.rule_id === "A4")).toBe(true);
    expect(plan.health_flag_to_create).toBeDefined();
  });

  it("shoulder_L/shoulder_R now classify as upper_grip (previously unmatched, never adapted GRIP_WORK/STRENGTH_UPPER)", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" },
      checkin: { pain: true, pain_intensity: 4, pain_location_code: "shoulder_L" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
    expect(plan.protection.do_not_do.some((p) => p.includes("shoulder_L"))).toBe(true);
  });

  it("regression: a SPECIFIED but unclassified zone (e.g. neck) is unchanged — not silently adapted, no product decision made here", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { pain: true, pain_intensity: 5, pain_location_code: "neck" },
    });

    const plan = buildDailyPlan(ctx);

    // Unchanged from pre-V0.3.013 behavior: a specified-but-unmapped zone
    // stays "not solicited" — only the NO-location case was fixed.
    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 });
    expect(plan.decision_reasoning!.find((r) => r.rule_id === "PAIN_NON_SAFETY")?.detail).toContain(
      "séance non concernée",
    );
  });
});
