import { describe, expect, it } from "vitest";
import { enduranceFallbackPainGate } from "../../src/supabase/dailyV2/enduranceFallbackPainGate.js";
import { applyV2IntervalsLightFallback, V2_INTERVALS_LIGHT_FALLBACK_RULE_ID } from "../../src/supabase/dailyV2/applyV2IntervalsLightFallback.js";
import type { DailyCheckin } from "../../src/types/checkin.js";
import type { DailyPlan } from "../../src/types/index.js";
import type { FinalPrescriptionV2Result } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";

// PHYS-02.1 — the intervals LIGHT fallback offers activities (bike, home trainer, running): only for a pain the
// EXISTING pain rule (M1 PAIN_NON_SAFETY zones, read-only) clears for endurance. No activity-level rule exists.

const base = { pain: false } as unknown as DailyCheckin;
const pain = (location: string | undefined): DailyCheckin =>
  ({ pain: true, pain_intensity: 3, pain_new: false, ...(location ? { pain_location_code: location } : {}), pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false }) as unknown as DailyCheckin;

describe("PHYS-02.1 — enduranceFallbackPainGate", () => {
  it("no pain (or no check-in): cleared — the fallback as before", () => {
    expect(enduranceFallbackPainGate(base)).toEqual({ cleared: true });
    expect(enduranceFallbackPainGate(null)).toEqual({ cleared: true });
  });

  it("a pain the rule says endurance solicits (lower limbs): not cleared", () => {
    for (const zone of ["knee_R", "ankle_L", "hip_R", "quad_L", "hamstring_R", "calf_L"]) expect(enduranceFallbackPainGate(pain(zone)), zone).toEqual({ cleared: false, zone: "lower" });
  });

  it("a pain the rule says endurance does not solicit (upper body / grip): cleared", () => {
    for (const zone of ["wrist_R", "forearm_L", "elbow_R", "shoulder_L", "hand_R", "thumb_L"]) expect(enduranceFallbackPainGate(pain(zone)), zone).toEqual({ cleared: true });
  });

  it("no location (the rule's cautious reading) or a zone the rule leaves unclassified (back, neck…): not cleared", () => {
    expect(enduranceFallbackPainGate(pain(undefined))).toEqual({ cleared: false, zone: "unspecified" });
    for (const zone of ["lower_back", "upper_back", "neck", "groin", "chest", "abs", "head", "other"]) expect(enduranceFallbackPainGate(pain(zone)), zone).toEqual({ cleared: false, zone: "other" });
  });
});

describe("PHYS-02.1 — a withheld fallback is traced, the decision kept", () => {
  it("blocked for the pain: M1's decision unchanged, the trace added (reason and zone category)", () => {
    const plan = {
      decision: "MODIFY",
      final_session: { kind: "AEROBIC_INTERVALS", load_profile: "LIGHT", duration_min: 53 },
      training: { active: true, session_type: { kind: "AEROBIC_INTERVALS", load_profile: "LIGHT", duration_min: 53 } },
      triggered_rules: [{ layer: "C", rule_id: "PAIN_NON_SAFETY", detail: "Douleur non-SAFETY (knee_R)", signals_used: ["pain_non_safety_knee_R"] }],
    } as unknown as DailyPlan;
    const after = applyV2IntervalsLightFallback(plan, { status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "intervals_fallback_pain_not_cleared", zone: "lower" } } as FinalPrescriptionV2Result);
    expect([after.decision, after.final_session, after.training]).toEqual([plan.decision, plan.final_session, plan.training]);
    expect(after.triggered_rules.at(-1)).toEqual({
      layer: "ARBITRATION",
      rule_id: V2_INTERVALS_LIGHT_FALLBACK_RULE_ID,
      detail: "Repli non proposé : douleur du jour (zone lower) que la règle douleur existante ne libère pas pour l'endurance ; compatibilité d'activité non établie, aucune séance du jour. M1 : MODIFY AEROBIC_INTERVALS LIGHT.",
      signals_used: [],
    });
  });
});
