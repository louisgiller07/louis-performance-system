import { describe, it, expect } from "vitest";
import { computeNutritionDomain } from "../src/domains/nutrition.js";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { NUTRITION_POLICY } from "../src/config/nutritionPolicy.js";
import { baseRawContext } from "../fixtures/louis.js";
import type { TrainingIntervention } from "../src/types/trainingIntervention.js";
import type { EventContext, RacePhase, TrainingMode, UpcomingRace } from "../src/types/context.js";

const RACE_WEEK_FOCUS = "En race week : pense à augmenter légèrement l'apport énergétique.";
const RACE_DAY_NOTES = "Jour de course : petit-déjeuner consistant au moins 2 h avant le premier run.";
const DH_DAY_NOTES = "Jour DH : vise environ 3 à 3,5 L sur la journée.";
const STRENGTH_NOTES = "Séance de force planifiée : protéines + glucides dans les 60 minutes après.";

const DH_KINDS: TrainingIntervention[] = [
  { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
  { kind: "DH_PERFORMANCE", load_profile: "MODERATE" },
  { kind: "DH_LIGHT", load_profile: "LIGHT" },
  { kind: "PUMPTRACK", load_profile: "LIGHT" },
];

const STRENGTH_KINDS: TrainingIntervention[] = [
  { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
  { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
  { kind: "STRENGTH_FULL_LIGHT", load_profile: "LIGHT" },
  { kind: "POWER", load_profile: "HEAVY" },
  { kind: "GRIP_WORK", load_profile: "MODERATE" },
];

const NEUTRAL_SESSION: TrainingIntervention = { kind: "AEROBIC_BASE", load_profile: "LIGHT" };

function race(overrides: Partial<UpcomingRace> = {}): UpcomingRace {
  return {
    event_name: "Fixture race",
    event_start: "2026-08-24",
    event_end: "2026-08-24",
    priority: "A",
    race_format: "OTHER",
    ...overrides,
  };
}

function eventContext(phase: RacePhase, overrides: Partial<EventContext> = {}): EventContext {
  return {
    race: race(),
    days_to_event: 0,
    days_from_event: 0,
    event_day: null,
    in_progress: false,
    phase,
    ...overrides,
  };
}

function baseParams(overrides: {
  finalSession?: TrainingIntervention;
  plannedSession?: TrainingIntervention | null;
  activeMode?: TrainingMode;
  eventContext?: EventContext;
} = {}) {
  return {
    finalSession: overrides.finalSession ?? NEUTRAL_SESSION,
    plannedSession: overrides.plannedSession ?? null,
    activeMode: overrides.activeMode ?? ("IN_SEASON" as TrainingMode),
    eventContext: overrides.eventContext,
  };
}

describe("T13 — Nutrition (V0.3_002D)", () => {
  describe("NUTRITION_POLICY provenance", () => {
    it("holds exactly the approved canonical numeric constants", () => {
      expect(NUTRITION_POLICY.baselineHydrationTargetL).toBe(2);
      expect(NUTRITION_POLICY.dhHydrationRangeL).toEqual({ min: 3, max: 3.5 });
      expect(NUTRITION_POLICY.strengthPostWindowMinutes).toBe(60);
      expect(NUTRITION_POLICY.raceBreakfastLeadHours).toBe(2);
    });
  });

  describe("No trigger", () => {
    it("normal day, no context → inactive", () => {
      const result = computeNutritionDomain(baseParams());
      expect(result).toEqual({ active: false });
    });

    it("PRE_EVENT alone, not RACE_WEEK → inactive", () => {
      const result = computeNutritionDomain(baseParams({ eventContext: eventContext("PRE_EVENT") }));
      expect(result).toEqual({ active: false });
    });
  });

  describe("PRE_EVENT orthogonality — contributes nothing itself, never suppresses an independent trigger", () => {
    it("PRE_EVENT + final DH → exactly DH Nutrition", () => {
      const result = computeNutritionDomain(
        baseParams({ eventContext: eventContext("PRE_EVENT"), finalSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } })
      );
      expect(result).toEqual({ active: true, notes: DH_DAY_NOTES });
    });

    it("PRE_EVENT + planned strength → exactly strength Nutrition, hydration_target_l = 2", () => {
      const result = computeNutritionDomain(
        baseParams({ eventContext: eventContext("PRE_EVENT"), plannedSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } })
      );
      expect(result).toEqual({ active: true, hydration_target_l: 2, notes: STRENGTH_NOTES });
    });
  });

  describe("RACE_WEEK — focus only", () => {
    it("active_mode RACE_WEEK alone → focus only, no notes, no hydration", () => {
      const result = computeNutritionDomain(baseParams({ activeMode: "RACE_WEEK" }));
      expect(result).toEqual({ active: true, focus: RACE_WEEK_FOCUS });
    });
  });

  describe("V0.3_004C — UNSPECIFIED never triggers the RACE_WEEK-only focus", () => {
    it("active_mode UNSPECIFIED alone → inactive, exactly like any other non-RACE_WEEK mode", () => {
      const result = computeNutritionDomain(baseParams({ activeMode: "UNSPECIFIED" }));
      expect(result).toEqual({ active: false });
    });
  });

  describe("DH day — final_session", () => {
    for (const session of DH_KINDS) {
      it(`final ${session.kind} → DH notes, hydration_target_l absent`, () => {
        const result = computeNutritionDomain(baseParams({ finalSession: session }));
        expect(result).toEqual({ active: true, notes: DH_DAY_NOTES });
        expect(result.hydration_target_l).toBeUndefined();
      });
    }
  });

  describe("Planned strength — planned_session", () => {
    for (const session of STRENGTH_KINDS) {
      it(`planned ${session.kind} → strength notes + hydration_target_l = 2`, () => {
        const result = computeNutritionDomain(baseParams({ plannedSession: session }));
        expect(result).toEqual({ active: true, hydration_target_l: 2, notes: STRENGTH_NOTES });
      });
    }

    it("uses PLANNED session, not final_session — planned strength survives a non-strength final session", () => {
      const result = computeNutritionDomain(
        baseParams({ finalSession: { kind: "RECOVERY_ACTIVE" }, plannedSession: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" } })
      );
      expect(result).toEqual({ active: true, hydration_target_l: 2, notes: STRENGTH_NOTES });
    });
  });

  describe("Cross-trigger composition", () => {
    it("RACE_WEEK + strength → focus + strength notes + hydration 2", () => {
      const result = computeNutritionDomain(
        baseParams({ activeMode: "RACE_WEEK", plannedSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } })
      );
      expect(result).toEqual({ active: true, focus: RACE_WEEK_FOCUS, hydration_target_l: 2, notes: STRENGTH_NOTES });
    });

    it("RACE_WEEK + DH → focus + DH notes, no hydration", () => {
      const result = computeNutritionDomain(
        baseParams({ activeMode: "RACE_WEEK", finalSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } })
      );
      expect(result).toEqual({ active: true, focus: RACE_WEEK_FOCUS, notes: DH_DAY_NOTES });
    });

    it("RACE_WEEK + race day → focus + race-day notes, hydration_target_l absent", () => {
      const result = computeNutritionDomain(
        baseParams({ activeMode: "RACE_WEEK", eventContext: eventContext("RACE_DAY_GENERIC", { in_progress: true }) })
      );
      expect(result).toEqual({ active: true, focus: RACE_WEEK_FOCUS, notes: RACE_DAY_NOTES });
      expect(result.hydration_target_l).toBeUndefined();
    });
  });

  describe("Race day (in_progress) — highest precedence", () => {
    it("in_progress race day → race-day notes", () => {
      const result = computeNutritionDomain(baseParams({ eventContext: eventContext("RACE_DAY_GENERIC", { in_progress: true }) }));
      expect(result).toEqual({ active: true, notes: RACE_DAY_NOTES });
    });

    it("in_progress with a granular curated race_phase → race-day notes still fire (in_progress is authoritative, not phase)", () => {
      const result = computeNutritionDomain(baseParams({ eventContext: eventContext("QUALI", { in_progress: true }) }));
      expect(result).toEqual({ active: true, notes: RACE_DAY_NOTES });
    });

    it("race day + planned strength → race-day branch wins, hydration_target_l absent", () => {
      const result = computeNutritionDomain(
        baseParams({
          eventContext: eventContext("RACE_DAY_GENERIC", { in_progress: true }),
          plannedSession: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
        })
      );
      expect(result).toEqual({ active: true, notes: RACE_DAY_NOTES });
      expect(result.hydration_target_l).toBeUndefined();
    });

    it("race day + final DH → race-day branch wins over DH branch", () => {
      const result = computeNutritionDomain(
        baseParams({
          eventContext: eventContext("RACE_DAY_GENERIC", { in_progress: true }),
          finalSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        })
      );
      expect(result).toEqual({ active: true, notes: RACE_DAY_NOTES });
    });
  });

  describe("DH vs strength precedence", () => {
    it("final DH + planned strength (no race day) → DH branch wins, hydration_target_l absent", () => {
      const result = computeNutritionDomain(
        baseParams({
          finalSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
          plannedSession: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
        })
      );
      expect(result).toEqual({ active: true, notes: DH_DAY_NOTES });
      expect(result.hydration_target_l).toBeUndefined();
    });
  });

  describe("POST_EVENT — no debrief branch, but does not suppress other triggers", () => {
    it("POST_EVENT alone → inactive", () => {
      const result = computeNutritionDomain(baseParams({ eventContext: eventContext("POST_EVENT") }));
      expect(result).toEqual({ active: false });
    });

    it("POST_EVENT + independently-valid planned strength → strength behavior preserved", () => {
      const result = computeNutritionDomain(
        baseParams({ eventContext: eventContext("POST_EVENT"), plannedSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } })
      );
      expect(result).toEqual({ active: true, hydration_target_l: 2, notes: STRENGTH_NOTES });
    });
  });

  describe("Determinism", () => {
    it("identical input → identical output", () => {
      const params = baseParams({ activeMode: "RACE_WEEK", finalSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } });
      const first = computeNutritionDomain(params);
      const second = computeNutritionDomain(params);
      expect(first).toEqual(second);
    });
  });

  describe("Wiring — buildDailyPlan", () => {
    it("Safety REST keeps nutrition exactly {active:false}, Nutrition never invoked", () => {
      const ctx = baseRawContext({ checkin: { suspected_concussion: true } });
      const plan = buildDailyPlan(ctx);
      expect(plan.nutrition).toEqual({ active: false });
    });

    it("planned strength via full RawContext → nutrition active, Training unchanged, no NUTRITION_* triggered rule", () => {
      const ctx = baseRawContext({
        active_mode: "OFF_SEASON_DEVELOPMENT",
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.nutrition).toEqual({ active: true, hydration_target_l: 2, notes: STRENGTH_NOTES });
      expect(plan.decision).toBe("KEEP");
      expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
      expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("NUTRITION"))).toBe(false);
    });

    it("is deterministic: identical RawContext produces identical nutrition output", () => {
      const ctx = baseRawContext({ active_mode: "RACE_WEEK" });
      const planA = buildDailyPlan(ctx);
      const planB = buildDailyPlan(ctx);
      expect(planA.nutrition).toEqual(planB.nutrition);
    });

    // The exact-current ENGINE_VERSION provenance assertion lives solely in
    // tests/engineVersion.test.ts — T13 does not own the mutable global
    // current version.

    it("real race-day: a genuine in-progress race (via computeEventContext, not a hand-built EventContext) reaches Nutrition, and the strength hydration value cannot leak in", () => {
      // baseRawContext's default `today` is 2026-08-24 — bracket it with a
      // real race so EventContext.in_progress is computed by the actual
      // production date-math (engine/eventContext.ts), never passed by hand.
      // Also includes a planned strength session to simultaneously prove
      // the hydration_target_l leak-prevention integration case (§13),
      // without a redundant second integration test.
      const ctx = baseRawContext({
        upcoming_races: [
          { event_name: "Course en cours", event_start: "2026-08-23", event_end: "2026-08-25", priority: "A", race_format: "OTHER" },
        ],
        planned_session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.event_context?.in_progress).toBe(true);
      expect(plan.nutrition.notes).toBe(RACE_DAY_NOTES);
      expect(plan.nutrition.hydration_target_l).toBeUndefined();
    });

    it("Safety hard-stop dominates a genuinely competing Nutrition trigger (RACE_WEEK + planned strength)", () => {
      const ctx = baseRawContext({
        checkin: { suspected_concussion: true },
        active_mode: "RACE_WEEK",
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.nutrition).toEqual({ active: false });
    });
  });

  describe("triggered_rules — Nutrition never owns a rule", () => {
    // Not a paired-equality regression (Nutrition has no SignalTrace/late-push
    // mechanism to protect against — see production source doc-comment).
    // This proves only the true, narrower contract: across several
    // independently representative Nutrition-active scenarios, no
    // NUTRITION_*-prefixed TriggeredRule is ever present, and Training's own
    // rules remain whatever that scenario legitimately produces on its own
    // terms (not compared against an unrelated context).
    it("no NUTRITION_* rule_id appears in triggered_rules across representative Nutrition-active scenarios", () => {
      const scenarios = [
        baseRawContext({ active_mode: "RACE_WEEK" }),
        baseRawContext({ planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } }),
        baseRawContext({ planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } }),
        baseRawContext({
          upcoming_races: [
            { event_name: "Course en cours", event_start: "2026-08-23", event_end: "2026-08-25", priority: "A", race_format: "OTHER" },
          ],
        }),
      ];

      for (const ctx of scenarios) {
        const plan = buildDailyPlan(ctx);
        expect(plan.nutrition.active).toBe(true);
        expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("NUTRITION"))).toBe(false);
      }
    });
  });

  describe("Regression — Training/Technique/Mental/Recovery unaffected by Nutrition", () => {
    it("T7.1-equivalent — KEEP decision/final_session unaffected", () => {
      const ctx = baseRawContext({
        active_mode: "OFF_SEASON_DEVELOPMENT",
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
      expect(plan.decision).toBe("KEEP");
    });

    it("Technique regression — a Technique-relevant fixture keeps dh_or_technical unchanged", () => {
      const ctx = baseRawContext({ planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } });
      const plan = buildDailyPlan(ctx);
      expect(plan.dh_or_technical.active).toBe(true);
      expect(plan.dh_or_technical.focus).toBe("Fixe ta ligne, dose le freinage, laisse rouler.");
      expect(plan.dh_or_technical.spot_hint).toBe("Terrain adapté au focus technique du jour.");
      // And Nutrition's own DH branch fires independently, without disturbing Technique.
      expect(plan.nutrition).toEqual({ active: true, notes: DH_DAY_NOTES });
    });

    it("Mental regression — a Mental RED fixture keeps mental output unchanged", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" },
        checkin: { work_stress: 9 },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session).toEqual({ kind: "AEROBIC_BASE", load_profile: "MODERATE" });
      expect(plan.mental).toEqual({
        active: true,
        action_hint: "Le plan du jour tient déjà compte de la charge mentale. Garde une seule priorité d'exécution.",
      });
    });

    it("Recovery regression — unaffected by Nutrition activation", () => {
      // active_mode held constant (IN_SEASON → empty modeConstraints in both)
      // so only planned_session (which computeRecoveryDomain never reads)
      // varies — isolates the check to Nutrition's own effect, not a
      // side effect of changing modeConstraints/protect_sleep.
      const ctxWithout = baseRawContext({ active_mode: "IN_SEASON", planned_session: { kind: "AEROBIC_BASE", load_profile: "LIGHT" } });
      const ctxWith = baseRawContext({ active_mode: "IN_SEASON", planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } });
      const planWithout = buildDailyPlan(ctxWithout);
      const planWith = buildDailyPlan(ctxWith);
      expect(planWith.recovery).toEqual(planWithout.recovery);
      expect(planWithout.nutrition).toEqual({ active: false });
      expect(planWith.nutrition).toEqual({ active: true, hydration_target_l: 2, notes: STRENGTH_NOTES });
    });
  });
});
