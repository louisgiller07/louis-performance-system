import { describe, expect, it } from "vitest";
import { powerFatigueGate } from "../../src/supabase/dailyV2/powerFatigueGate.js";
import { applyV2PowerFatigueHold, V2_POWER_FATIGUE_HOLD_RULE_ID } from "../../src/supabase/dailyV2/applyV2PowerFatigueHold.js";
import type { DailyPlan } from "../../src/types/index.js";
import type { FinalPrescriptionV2Result } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";

// PHYS-03 — M1 flags legs (C3.6) or grip (C3.5) fatigue but has no POWER branch: the power session is then not
// prescribed (docs/03 §5), M1's decision kept and traced. Only these two existing M1 rules are read.

const plan = (kind: string, ruleIds: string[]) =>
  ({
    decision: "KEEP",
    final_session: { kind, load_profile: "MODERATE", duration_min: 60 },
    triggered_rules: ruleIds.map((rule_id) => ({ layer: "C", rule_id, detail: rule_id, signals_used: [] })),
  }) as unknown as DailyPlan;

describe("PHYS-03 — powerFatigueGate", () => {
  it("a power session with C3.6 and / or C3.5: not cleared, the rules named", () => {
    expect(powerFatigueGate(plan("POWER", ["C3.6"]))).toEqual({ cleared: false, rules: ["C3.6"] });
    expect(powerFatigueGate(plan("POWER", ["C3.5", "C3.6"]))).toEqual({ cleared: false, rules: ["C3.6", "C3.5"] });
  });

  it("no fatigue rule, only the informative C3.7, or not a power session: cleared", () => {
    expect(powerFatigueGate(plan("POWER", []))).toEqual({ cleared: true });
    expect(powerFatigueGate(plan("POWER", ["C3.7"]))).toEqual({ cleared: true });
    expect(powerFatigueGate(plan("STRENGTH_UPPER", ["C3.6"]))).toEqual({ cleared: true });
  });

  it("the hold is traced, the decision unchanged; any other result returned as is", () => {
    const p = plan("POWER", ["C3.6"]);
    const after = applyV2PowerFatigueHold(p, { status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "power_fatigue_not_cleared", rules: ["C3.6"] } } as FinalPrescriptionV2Result);
    expect([after.decision, after.final_session]).toEqual([p.decision, p.final_session]);
    expect(after.triggered_rules.at(-1)).toEqual({
      layer: "ARBITRATION",
      rule_id: V2_POWER_FATIGUE_HOLD_RULE_ID,
      detail: "Séance de puissance non prescrite : fatigue signalée par M1 (C3.6) et puissance = qualité maximale (docs/03 §5). M1 : KEEP POWER MODERATE.",
      signals_used: [],
    });
    expect(applyV2PowerFatigueHold(p, { status: "none", reason: "rest" } as FinalPrescriptionV2Result)).toBe(p);
    expect(applyV2PowerFatigueHold(p, { status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "power_load_not_supported" } } as FinalPrescriptionV2Result)).toBe(p);
  });
});
