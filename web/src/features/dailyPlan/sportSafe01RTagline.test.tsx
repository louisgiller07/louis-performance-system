import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
// Real M1 plans (same cross-boundary import pattern as DailyPlanView.enriched.test.tsx).
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { DecisionHero } from "./DecisionHero";
import { isValidDailyPlan } from "./dailyPlanValidation";
import type { DailyPlan } from "./dailyPlanTypes";

// SPORT-SAFE-01R (HPM 2026-10-18, A1) — a pain M1 adapted for (PAIN_NON_SAFETY) asks for caution: the decision hero
// (shown in History) no longer closes with « prêt à performer ». Other decisions keep their tagline.

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

describe("SPORT-SAFE-01R — no « prêt à performer » over a declared pain", () => {
  it.each([
    ["DH, knee pain 4/10 (MODIFY DH LIGHT)", { pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "knee_R" }, DH],
    ["DH, wrist pain 4/10 (MODIFY DH LIGHT)", { pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "wrist_R" }, DH],
    ["endurance, wrist pain 4/10 (zone not solicited: KEEP, still a declared pain)", { pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "wrist_R" }, ENDURANCE],
  ] as const)("%s → no tagline", (_, checkin, planned) => {
    const plan = m1(checkin, planned);
    expect(plan.triggered_rules.map((r) => r.rule_id)).toContain("PAIN_NON_SAFETY");
    expect(tagline(plan)).toBeNull();
  });

  it.each([
    ["no signal (KEEP)", {}, DH, "✓ Prêt à performer"],
    ["legs 9/10 (REPLACE DH light, fatigue)", { leg_fatigue: 9 }, DH, "✓ Nouveau plan — prêt à performer"],
    ["short sleep (MODIFY endurance LIGHT, fatigue)", { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 }, ENDURANCE, "✓ Ajusté — prêt à performer"],
  ] as const)("unchanged: %s → %s", (_, checkin, planned, expected) => {
    expect(tagline(m1(checkin, planned))).toBe(expected);
  });
});
