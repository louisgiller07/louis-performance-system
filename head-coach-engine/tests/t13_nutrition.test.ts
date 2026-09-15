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
  activeMode?: TrainingMode;
  eventContext?: EventContext;
} = {}) {
  return {
    finalSession: overrides.finalSession ?? NEUTRAL_SESSION,
    activeMode: overrides.activeMode ?? ("IN_SEASON" as TrainingMode),
    eventContext: overrides.eventContext,
  };
}

describe("T13 — Nutrition (V0.3_002D, corrigé DOG-001)", () => {
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

    it("PRE_EVENT + final strength → exactly strength Nutrition, hydration_target_l = 2", () => {
      const result = computeNutritionDomain(
        baseParams({ eventContext: eventContext("PRE_EVENT"), finalSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } })
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

  describe("Strength day — final_session (DOG-001: driven by final_session, never planned)", () => {
    for (const session of STRENGTH_KINDS) {
      it(`final ${session.kind} → strength notes + hydration_target_l = 2`, () => {
        const result = computeNutritionDomain(baseParams({ finalSession: session }));
        expect(result).toEqual({ active: true, hydration_target_l: 2, notes: STRENGTH_NOTES });
      });
    }

    // DOG-001 — this is the exact regression this ticket fixes. The function
    // no longer even accepts a `plannedSession` parameter: only
    // `finalSession.kind` can ever drive the strength branch, so a REPLACE
    // arbitration away from strength can never leak stale strength notes.
    it("a non-strength final_session never produces strength notes, regardless of what was originally planned", () => {
      const result = computeNutritionDomain(baseParams({ finalSession: { kind: "RECOVERY_ACTIVE" } }));
      expect(result).toEqual({ active: false });
      expect(result.notes).toBeUndefined();
      expect(result.hydration_target_l).toBeUndefined();
    });

    // Mirror of the case above, proving the fix is symmetric, not just
    // "planned strength doesn't leak" but "only final_session ever matters,
    // in either direction". Deliberately a pure computeNutritionDomain call
    // (function-level), not a buildDailyPlan/arbitration scenario: no
    // Training rule in this engine ever upgrades a lighter/recovery kind
    // into a development kind, so "planned RECOVERY_ACTIVE, final
    // STRENGTH_LOWER" cannot occur via real arbitration — this proves the
    // general guarantee the function itself makes, independent of whether
    // any specific rule happens to produce it today.
    it("a strength final_session always produces strength notes, even if a hypothetical plan had been non-strength (function depends only on finalSession)", () => {
      const result = computeNutritionDomain(baseParams({ finalSession: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" } }));
      expect(result).toEqual({ active: true, hydration_target_l: 2, notes: STRENGTH_NOTES });
    });
  });

  describe("Cross-trigger composition", () => {
    it("RACE_WEEK + final strength → focus + strength notes + hydration 2", () => {
      const result = computeNutritionDomain(
        baseParams({ activeMode: "RACE_WEEK", finalSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } })
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

    it("race day + final strength → race-day branch wins, hydration_target_l absent", () => {
      const result = computeNutritionDomain(
        baseParams({
          eventContext: eventContext("RACE_DAY_GENERIC", { in_progress: true }),
          finalSession: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
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

  describe("POST_EVENT — no debrief branch, but does not suppress other triggers", () => {
    it("POST_EVENT alone → inactive", () => {
      const result = computeNutritionDomain(baseParams({ eventContext: eventContext("POST_EVENT") }));
      expect(result).toEqual({ active: false });
    });

    it("POST_EVENT + independently-valid final strength → strength behavior preserved", () => {
      const result = computeNutritionDomain(
        baseParams({ eventContext: eventContext("POST_EVENT"), finalSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } })
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

    // DOG-001 — the real production case: planned STRENGTH_LOWER/MODERATE,
    // both legs and grip fatigue RED simultaneously fires C3.5/C3.6's
    // combined-fatigue pivot (domains/training.ts), REPLACE → RECOVERY_ACTIVE.
    // Nutrition must follow the arbitrated final_session, never the stale
    // Planning intent — see docs/11_DECISION_LOG.md DOG-001.
    it("DOG-001 regression: planned strength REPLACEd to RECOVERY_ACTIVE by combined leg+grip fatigue → nutrition reflects RECOVERY_ACTIVE, never stale strength notes", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
        checkin: { leg_fatigue: 8, grip_fatigue: 8 },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
      expect(plan.decision).toBe("REPLACE");
      expect(plan.nutrition).toEqual({ active: false });
      expect(plan.nutrition.notes).toBeUndefined();
    });

    // Second real trigger path identified during the DOG-001 investigation:
    // the `no_development` mode soft constraint (rules/modes.ts) replaces a
    // HEAVY/MODERATE development-kind session (STRENGTH_LOWER included) with
    // RECOVERY_ACTIVE — same stale-nutrition risk, different arbitration path.
    it("DOG-001 regression (second path): planned strength REPLACEd to RECOVERY_ACTIVE by the no_development soft constraint → nutrition reflects RECOVERY_ACTIVE", () => {
      // INJURY_RECOVERY carries `no_development` at `weight: "strong"` (see
      // rules/modes.ts) — OFF_SEASON_RECOVERY's own no_development is only
      // "moderate" and is never enforced by buildDailyPlan.ts's strong-only
      // constraint loop, so it would not reproduce this path.
      const ctx = baseRawContext({
        active_mode: "INJURY_RECOVERY",
        planned_session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
      expect(plan.nutrition).toEqual({ active: false });
    });

    // Third real trigger path — a non-Safety REST outcome (T-X race taper,
    // rules/raceProtocol.ts, hard=true at T-2/T-1, overrides even a
    // committed planned session). Explicitly distinct from the Safety-REST
    // early-return path above (which bypasses computeNutritionDomain
    // entirely) — this REST comes from ordinary arbitration and must still
    // clear stale strength notes.
    it("DOG-001 regression (third path): planned strength REPLACEd to REST by a T-2 race taper → nutrition inactive, no stale strength notes", () => {
      const ctx = baseRawContext({
        today: "2026-08-24",
        upcoming_races: [
          // race_format must be HOT_TRAIL_2DAY or IXS_3DAY — the T-X table
          // (rules/raceProtocol.ts) only exists for those two formats; any
          // other format returns no recommendation at all (see PRE_EVENT_TABLES).
          { event_name: "T-2 race", event_start: "2026-08-26", event_end: "2026-08-26", priority: "A_PLUS", race_format: "HOT_TRAIL_2DAY" },
        ],
        planned_session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session).toEqual({ kind: "REST" });
      expect(plan.nutrition).toEqual({ active: false });
      expect(plan.nutrition.notes).toBeUndefined();
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
      expect(plan.dh_or_technical.spot_hint).toBe(
        "Choisis un terrain connu ou représentatif où tu maîtrises déjà les lignes et peux travailler la vitesse avec précision."
      );
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
