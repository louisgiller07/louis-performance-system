import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
// Real M1 plans and the real V2 A10 application (same cross-boundary import pattern as DailyPlanView.enriched.test.tsx).
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { applyV2TodayTimeConstraint } from "../../../../head-coach-engine/src/supabase/dailyV2/applyV2TodayTimeConstraint.js";
import { DailyPlanResult } from "./DailyPlanResult";
import { DecisionHero } from "./DecisionHero";
import { MissionHero } from "./MissionHero";
import { coachWhy } from "./coachInsights";
import { NO_COMPATIBLE_SESSION_TITLE, noCompatibleSessionOf } from "./noCompatibleSession";
import { athleteSafeReasoning, athleteSafeRuleDetail } from "./safetyPresentation";
import { isValidDailyPlan } from "./dailyPlanValidation";
import type { DailyPlan } from "./dailyPlanTypes";
import type { FinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2Types";

// SPORT-SAFE-01R.4 (HPM 2026-10-19) — presentation only, from the stored decision and the day's check-in:
// 1. less time than the refused session and no admissible alternative → Today never presents that session as available;
// 2. C3.3's « nature de la séance préservée » is never shown once the session kind has really changed.

const ENDURANCE = { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 45 } as const;
const SYSTEMIC_RED = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const M1 = buildDailyPlan(baseRawContext({ planned_session: ENDURANCE as never, active_mode: "UNSPECIFIED" as never, upcoming_races: [], checkin: SYSTEMIC_RED as never })) as unknown as DailyPlan;
const refusedBefore = { decision: "MODIFY" as const, kind: "AEROBIC_BASE", loadProfile: "LIGHT" as const, durationMin: 45 };
const REFUSED: FinalPrescriptionV2State = { kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported", planned: "MODERATE", final: "LIGHT", durationMin: 45 } };
/** The real A10 application of each case (`applyV2TodayTimeConstraint`, head-coach). */
const NO_ALTERNATIVE_15 = applyV2TodayTimeConstraint(M1 as never, { ...REFUSED, status: "blocked", timeConstraint: { availableMinutes: 15, action: "no_alternative", before: refusedBefore, after: refusedBefore } } as never) as unknown as DailyPlan;
const ALTERNATIVE_30 = applyV2TodayTimeConstraint(M1 as never, { status: "created", finalPrescription: {} as never, timeConstraint: { availableMinutes: 30, action: "adapted", before: refusedBefore, after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } }, refusedModify: { code: "final_prescription_adaptation_not_defined", detail: REFUSED.kind === "blocked" ? REFUSED.detail! : {} } } as never) as unknown as DailyPlan;
const STALE_CLAIM = "nature de la séance préservée";

function today(plan: DailyPlan, state: FinalPrescriptionV2State | undefined, availableMinutes: number | null) {
  return render(
    <DailyPlanResult
      result={{ dailyPlan: plan, decisionId: "d1", healthFlagId: null, warnings: [] } as never}
      today={{ checkin: { checkin_date: "2026-10-16", available_minutes_today: availableMinutes, ...SYSTEMIC_RED } as never, revealed: false }}
      finalPrescriptionV2={state}
    />
  );
}

describe("SPORT-SAFE-01R.4 — less time than the refused session, no admissible alternative", () => {
  it("the real engine decisions: 15 min keeps M1's MODIFY LIGHT 45 (refused, no alternative); 30 min is A10's active recovery", () => {
    expect([NO_ALTERNATIVE_15.decision, NO_ALTERNATIVE_15.final_session]).toEqual(["MODIFY", { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }]);
    expect([ALTERNATIVE_30.decision, ALTERNATIVE_30.final_session]).toEqual(["REPLACE", { kind: "RECOVERY_ACTIVE" }]);
    expect(isValidDailyPlan(NO_ALTERNATIVE_15) && isValidDailyPlan(ALTERNATIVE_30)).toBe(true);
  });

  it.each([
    [15, REFUSED, { availableMinutes: 15, durationMin: 45 }],
    [20, { kind: "created" } as never, null],
    [30, { kind: "created" } as never, null],
    [60, REFUSED, null],
    [null, REFUSED, null],
  ] as const)("%s min declared → %j", (minutes, state, expected) => {
    expect(noCompatibleSessionOf(state, minutes)).toEqual(expected);
  });

  it("another blocked reason, or no V2 state → never this message", () => {
    expect(noCompatibleSessionOf({ kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "manual_kind_not_supported" } }, 15)).toBeNull();
    expect(noCompatibleSessionOf(undefined, 15)).toBeNull();
  });

  it("Today, 15 min: no compatible session — the declared time and the refused duration, never the 45-min session as available, never a rest or a recovery", () => {
    const { container } = today(NO_ALTERNATIVE_15, REFUSED, 15);
    const mission = container.querySelector("section[aria-labelledby='mission-title']")!;
    expect(mission.querySelector("h2")!.textContent).toBe(NO_COMPATIBLE_SESSION_TITLE);
    expect(screen.getByTestId("no-compatible-session").textContent).toBe(
      "Tu as indiqué 15 min aujourd'hui. La séance recommandée dure 45 min et NALYNT n'en a pas de version guidée plus légère : aucune séance guidée compatible aujourd'hui."
    );
    expect(mission.querySelector(".sr-only")!.textContent!.replace(/\u00a0/g, " ")).toBe("Prévu : Aérobie base (45 min · charge modérée). Adapté : Aucune séance compatible.");
    expect(mission.textContent).not.toMatch(/charge légère|Repos|Récupération active/i);
    // « Pourquoi ? »: the signals that asked for the adaptation, never « la charge est ajustée » (no session is offered).
    expect(mission.textContent).toContain("Signaux détectés : nuit trop courte, sommeil de mauvaise qualité, énergie basse, nuit hachée.");
    expect(mission.textContent).not.toContain("La charge est ajustée");
  });

  it.each([
    [30, "the alternative: Today presents the active recovery, no « no compatible session »", ALTERNATIVE_30, { kind: "created" } as never, "Récupération active"],
    [60, "the refused session fits the time: M1's decision as before (the guided session says the approved refusal)", NO_ALTERNATIVE_15, REFUSED, "charge légère"],
  ] as const)("Today, %s min — %s", (minutes, _, plan, state, adaptedPrimary) => {
    const { container } = today(plan, state, minutes);
    expect(screen.queryByTestId("no-compatible-session")).toBeNull();
    expect(container.querySelector(".mission-adapted")!.textContent).toContain(adaptedPrimary);
  });
});

describe("SPORT-SAFE-01R.4 — « nature de la séance préservée » never over a real change of session kind", () => {
  it("the alternative (endurance → active recovery): the claim goes, the replacement is explained (« Pourquoi ? », History hero, rule list)", () => {
    expect(ALTERNATIVE_30.reasoning).toContain(STALE_CLAIM); // the stored decision is not rewritten
    const why = coachWhy(ALTERNATIVE_30);
    expect(why).not.toContain(STALE_CLAIM);
    expect(why).toBe("Sommeil insuffisant — adaptation d'intensité. Tu as 30 min aujourd'hui : la séance prévue n'est pas proposée (NALYNT n'en a pas de version guidée plus légère, et elle ne tient pas dans ce temps). Autre séance à la place : récupération active.");
    const { container } = render(<DecisionHero dailyPlan={ALTERNATIVE_30} />);
    expect(container.textContent).not.toContain(STALE_CLAIM);
    const c33 = ALTERNATIVE_30.decision_reasoning!.find((r) => r.rule_id === "C3.3")!;
    expect(athleteSafeRuleDetail(c33, ALTERNATIVE_30)).toBe("Sommeil insuffisant — adaptation d'intensité.");
  });

  it("an ordinary A10 recovery after the same fatigue: the claim goes too", () => {
    const plan = applyV2TodayTimeConstraint(M1 as never, { status: "created", finalPrescription: {} as never, timeConstraint: { availableMinutes: 30, action: "adapted", before: refusedBefore, after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } } } as never) as unknown as DailyPlan;
    expect(athleteSafeReasoning(plan)).not.toContain(STALE_CLAIM);
  });

  it("unchanged kind (M1's MODIFY LIGHT of the same endurance): the claim is true and stays", () => {
    expect(athleteSafeReasoning(M1)).toContain(STALE_CLAIM);
    const c33 = M1.decision_reasoning!.find((r) => r.rule_id === "C3.3")!;
    expect(athleteSafeRuleDetail(c33, M1)).toBe(c33.detail);
  });

  it("MissionHero on the alternative: « Pourquoi ? » without the claim", () => {
    const { container } = render(<MissionHero dailyPlan={ALTERNATIVE_30} />);
    expect(container.textContent).not.toContain(STALE_CLAIM);
    expect(container.textContent).toContain("Autre séance à la place : récupération active.");
  });
});
