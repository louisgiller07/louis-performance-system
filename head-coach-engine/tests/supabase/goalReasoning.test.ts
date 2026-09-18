/**
 * V0.3_011 — pure unit coverage for the goal → reasoning mapping itself,
 * independent of runDailyFor's orchestration (see runDailyFor.test.ts's
 * "V0.3_011" describe block for the end-to-end wiring tests).
 */
import { describe, expect, it } from "vitest";
import { resolveGoalRationale, applyGoalPersonalization } from "../../src/supabase/goalReasoning.js";
import type { DailyPlan } from "../../src/types/index.js";

function buildFixtureDailyPlan(reasoning: string): DailyPlan {
  return {
    date: "2026-08-16",
    active_mode: "IN_SEASON",
    training: { active: true, session_type: { kind: "AEROBIC_BASE", load_profile: "MODERATE" } },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    reasoning,
    confidence: "MEDIUM",
    triggered_rules: [],
    planned_session_before: null,
    final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
    decision: "KEEP",
    overrode_race_protocol: false,
    engine_version: "v0.2",
  };
}

describe("resolveGoalRationale", () => {
  const SUPPORTED_GOALS = ["Race performance", "Consistency", "Technical skills", "Fitness", "Injury prevention"];

  it.each(SUPPORTED_GOALS)("returns a non-empty fixed sentence for %s", (goal) => {
    const sentence = resolveGoalRationale(goal);
    expect(typeof sentence).toBe("string");
    expect(sentence!.length).toBeGreaterThan(0);
  });

  it("every supported goal produces a distinct sentence", () => {
    const sentences = SUPPORTED_GOALS.map((g) => resolveGoalRationale(g));
    expect(new Set(sentences).size).toBe(SUPPORTED_GOALS.length);
  });

  it("returns undefined for undefined (no onboarding)", () => {
    expect(resolveGoalRationale(undefined)).toBeUndefined();
  });

  it("returns undefined for an unrecognized value", () => {
    expect(resolveGoalRationale("some_future_or_legacy_value")).toBeUndefined();
  });

  it("is case-sensitive — a differently-cased match is not recognized (never a silent fuzzy match)", () => {
    expect(resolveGoalRationale("race performance")).toBeUndefined();
  });
});

describe("applyGoalPersonalization", () => {
  it("appends the goal sentence as a new paragraph when the goal is recognized", () => {
    const plan = buildFixtureDailyPlan("Improve cornering confidence.");

    const personalized = applyGoalPersonalization(plan, "Race performance");

    expect(personalized.reasoning).toBe(
      `Improve cornering confidence.\n\n${resolveGoalRationale("Race performance")}`
    );
  });

  it("returns the exact same object reference when no goal is declared", () => {
    const plan = buildFixtureDailyPlan("Improve cornering confidence.");

    const personalized = applyGoalPersonalization(plan, undefined);

    expect(personalized).toBe(plan);
  });

  it("returns the exact same object reference for an unrecognized goal", () => {
    const plan = buildFixtureDailyPlan("Improve cornering confidence.");

    const personalized = applyGoalPersonalization(plan, "not_a_real_goal");

    expect(personalized).toBe(plan);
  });

  it("never changes any field other than reasoning", () => {
    const plan = buildFixtureDailyPlan("Improve cornering confidence.");

    const personalized = applyGoalPersonalization(plan, "Fitness");

    expect(personalized.final_session).toEqual(plan.final_session);
    expect(personalized.decision).toBe(plan.decision);
    expect(personalized.active_mode).toBe(plan.active_mode);
    expect(personalized.training).toEqual(plan.training);
    expect(personalized.triggered_rules).toBe(plan.triggered_rules);
  });
});
