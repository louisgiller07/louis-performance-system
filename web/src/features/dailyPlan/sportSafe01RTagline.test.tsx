import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
// Real M1 plans and the real V2 A10 application (same cross-boundary import pattern as DailyPlanView.enriched.test.tsx).
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { applyV2TodayTimeConstraint } from "../../../../head-coach-engine/src/supabase/dailyV2/applyV2TodayTimeConstraint.js";
import { DecisionHero } from "./DecisionHero";
import { isValidDailyPlan } from "./dailyPlanValidation";
import type { DailyPlan } from "./dailyPlanTypes";

// SPORT-SAFE-01R / R.4 (HPM 2026-10-19) — the decision hero (History, and Today when it shows one) never says « prêt à
// performer » over a decision that asks for caution: a retained state signal (fatigue, pain…), a declared pain or an M1
// protection. It then says the stored decision in neutral, factual words. A decision without any of these keeps it.

const DH = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 } as const;
const ENDURANCE = { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 45 } as const;
function m1(checkin: Record<string, unknown>, planned: Record<string, unknown> = DH): DailyPlan {
  const plan = buildDailyPlan(baseRawContext({ planned_session: planned as never, active_mode: "UNSPECIFIED" as never, upcoming_races: [], checkin: checkin as never }));
  if (!isValidDailyPlan(plan)) throw new Error("engine produced an invalid DailyPlan");
  return plan;
}
const tagline = (plan: DailyPlan) => {
  const { container } = render(<DecisionHero dailyPlan={plan} />);
  return [...container.querySelectorAll("p")].map((p) => p.textContent ?? "").find((t) => t.startsWith("✓ ")) ?? null;
};
const SYSTEMIC_RED = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const before = { decision: "MODIFY" as const, kind: "AEROBIC_BASE", loadProfile: "LIGHT" as const, durationMin: 45 };
const recovery30 = { availableMinutes: 30, action: "adapted" as const, before, after: { decision: "REPLACE" as const, kind: "RECOVERY_ACTIVE" } };

describe("SPORT-SAFE-01R.4 — « prêt à performer » never over fatigue, pain or an M1 protection", () => {
  it.each([
    ["DH, knee pain 4/10 (MODIFY DH LIGHT)", { pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "knee_R" }, DH, "MODIFY", "✓ Séance ajustée"],
    ["endurance, wrist pain 4/10 (zone not solicited: KEEP, a declared pain)", { pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "wrist_R" }, ENDURANCE, "KEEP", "✓ Séance maintenue"],
    ["DH, legs 9/10 (REPLACE DH light, fatigue)", { leg_fatigue: 9 }, DH, "REPLACE", "✓ Séance remplacée"],
    ["endurance, short sleep (MODIFY LIGHT, fatigue)", SYSTEMIC_RED, ENDURANCE, "MODIFY", "✓ Séance ajustée"],
  ] as const)("%s → the decision's neutral line", (_, checkin, planned, decision, expected) => {
    const plan = m1(checkin, planned);
    expect(plan.decision).toBe(decision);
    expect(tagline(plan)).toBe(expected);
  });

  it("fatigue, then A10's active recovery as the alternative to a refused session (REPLACE) → « Séance remplacée »", () => {
    const plan = applyV2TodayTimeConstraint(m1(SYSTEMIC_RED, ENDURANCE), { status: "created", finalPrescription: {} as never, timeConstraint: recovery30, refusedModify: { code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported" } } } as never) as unknown as DailyPlan;
    expect(plan.decision).toBe("REPLACE");
    expect(tagline(plan)).toBe("✓ Séance remplacée");
  });

  it.each([
    ["no signal (KEEP)", m1({}), "✓ Prêt à performer"],
    ["no signal, only the rider's time (A10 active recovery, REPLACE)", applyV2TodayTimeConstraint(m1({}, ENDURANCE), { status: "created", finalPrescription: {} as never, timeConstraint: { ...recovery30, before: { ...before, decision: "KEEP" as const, loadProfile: "MODERATE" as const } } } as never) as unknown as DailyPlan, "✓ Nouveau plan — prêt à performer"],
  ] as const)("unchanged when nothing asks for caution: %s → %s", (_, plan, expected) => {
    expect(tagline(plan)).toBe(expected);
  });
});
