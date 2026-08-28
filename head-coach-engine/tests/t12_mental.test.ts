import { describe, it, expect } from "vitest";
import { computeMentalDomain } from "../src/domains/mental.js";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { SignalTrace } from "../src/engine/signalTrace.js";
import { ATHLETE_COACHING_PROFILE } from "../src/config/athleteCoachingProfile.js";
import { baseRawContext } from "../fixtures/louis.js";
import type { DimensionState, DimensionLevel } from "../src/types/dimensions.js";
import type { EventContext, RacePhase, UpcomingRace } from "../src/types/context.js";

const PRE_EVENT_FOCUS = "Comme à Wiriehorn.";
const AMBER_STRESS_HINT = "Fais quelques respirations lentes, puis reviens à une seule priorité.";
const AMBER_MOTIVATION_HINT = "Choisis une seule action simple et commence par celle-là.";
const RED_SUPPORTIVE_HINT = "Le plan du jour tient déjà compte de la charge mentale. Garde une seule priorité d'exécution.";

function dim(level: DimensionLevel, raw_signals: string[] = []): DimensionState {
  return { level, score: 0.5, raw_signals, reasons: [] };
}

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

describe("T12 — Mental (V0.3_002C)", () => {
  describe("Athlete profile config contract", () => {
    it("mental.preRaceCue has exactly the approved id and cue", () => {
      expect(ATHLETE_COACHING_PROFILE.mental.preRaceCue.id).toBe("wiriehorn_flow_reference");
      expect(ATHLETE_COACHING_PROFILE.mental.preRaceCue.cue).toBe(PRE_EVENT_FOCUS);
    });
  });

  describe("GREEN", () => {
    it("GREEN, no event → inactive", () => {
      const result = computeMentalDomain({ mentalDimension: dim("GREEN"), eventContext: undefined, signalTrace: new SignalTrace() });
      expect(result.mental).toEqual({ active: false });
      expect(result.triggeredRule).toBeUndefined();
    });

    it("GREEN + PRE_EVENT (priority A) → focus only, active", () => {
      const result = computeMentalDomain({
        mentalDimension: dim("GREEN"),
        eventContext: eventContext("PRE_EVENT", { race: race({ priority: "A" }) }),
        signalTrace: new SignalTrace(),
      });
      expect(result.mental).toEqual({ active: true, focus: PRE_EVENT_FOCUS });
    });

    it("GREEN + PRE_EVENT (priority B) → focus still fires, no priority filter", () => {
      const result = computeMentalDomain({
        mentalDimension: dim("GREEN"),
        eventContext: eventContext("PRE_EVENT", { race: race({ priority: "B" }) }),
        signalTrace: new SignalTrace(),
      });
      expect(result.mental).toEqual({ active: true, focus: PRE_EVENT_FOCUS });
    });

    it("GREEN + PRE_EVENT (priority C) → focus still fires", () => {
      const result = computeMentalDomain({
        mentalDimension: dim("GREEN"),
        eventContext: eventContext("PRE_EVENT", { race: race({ priority: "C" }) }),
        signalTrace: new SignalTrace(),
      });
      expect(result.mental.active).toBe(true);
      expect(result.mental.focus).toBe(PRE_EVENT_FOCUS);
    });
  });

  describe("AMBER", () => {
    it("stress AMBER alone → action_hint, MENTAL_AMBER_STRESS consumes stress_high", () => {
      const trace = new SignalTrace();
      const result = computeMentalDomain({ mentalDimension: dim("AMBER", ["stress_high"]), eventContext: undefined, signalTrace: trace });
      expect(result.mental).toEqual({ active: true, action_hint: AMBER_STRESS_HINT });
      expect(result.triggeredRule).toEqual({
        layer: "C",
        rule_id: "MENTAL_AMBER_STRESS",
        detail: "Stress travail élevé — coaching mental de régulation (respiration, priorité unique)",
        signals_used: ["stress_high"],
      });
      expect(trace.consumedByRule("stress_high")).toBe("MENTAL_AMBER_STRESS");
    });

    it("motivation AMBER alone → action_hint, MENTAL_AMBER_MOTIVATION consumes motivation_low", () => {
      const trace = new SignalTrace();
      const result = computeMentalDomain({ mentalDimension: dim("AMBER", ["motivation_low"]), eventContext: undefined, signalTrace: trace });
      expect(result.mental).toEqual({ active: true, action_hint: AMBER_MOTIVATION_HINT });
      expect(result.triggeredRule).toEqual({
        layer: "C",
        rule_id: "MENTAL_AMBER_MOTIVATION",
        detail: "Motivation basse — coaching mental de régulation (action simple, priorité unique)",
        signals_used: ["motivation_low"],
      });
      expect(trace.consumedByRule("motivation_low")).toBe("MENTAL_AMBER_MOTIVATION");
    });

    it("stress + motivation both AMBER → deterministic precedence, stress wins, motivation left unconsumed", () => {
      const trace = new SignalTrace();
      const result = computeMentalDomain({
        mentalDimension: dim("AMBER", ["stress_high", "motivation_low"]),
        eventContext: undefined,
        signalTrace: trace,
      });
      expect(result.mental).toEqual({ active: true, action_hint: AMBER_STRESS_HINT });
      expect(result.triggeredRule?.rule_id).toBe("MENTAL_AMBER_STRESS");
      expect(trace.consumedByRule("stress_high")).toBe("MENTAL_AMBER_STRESS");
      expect(trace.has("motivation_low")).toBe(false);
    });

    it("AMBER + PRE_EVENT → focus and action_hint both populated, independent", () => {
      const result = computeMentalDomain({
        mentalDimension: dim("AMBER", ["stress_high"]),
        eventContext: eventContext("PRE_EVENT"),
        signalTrace: new SignalTrace(),
      });
      expect(result.mental).toEqual({ active: true, focus: PRE_EVENT_FOCUS, action_hint: AMBER_STRESS_HINT });
    });

    it("stress AMBER consume() failure → no action_hint, no fallback to motivation, no crash", () => {
      const trace = new SignalTrace();
      trace.consume("stress_high", "SOME_OTHER_RULE"); // pre-claimed, simulates an unexpected invariant break
      const result = computeMentalDomain({
        mentalDimension: dim("AMBER", ["stress_high"]),
        eventContext: undefined,
        signalTrace: trace,
      });
      expect(result.mental).toEqual({ active: false });
      expect(result.triggeredRule).toBeUndefined();
    });
  });

  describe("RED — Training remains sole decision owner", () => {
    it("RED stress, pre-consumed by MENTAL_RED → supportive action_hint, no consume by Mental", () => {
      const trace = new SignalTrace();
      trace.consume("stress_high", "MENTAL_RED");
      const result = computeMentalDomain({ mentalDimension: dim("RED", ["stress_high"]), eventContext: undefined, signalTrace: trace });
      expect(result.mental).toEqual({ active: true, action_hint: RED_SUPPORTIVE_HINT });
      expect(result.triggeredRule).toBeUndefined();
      expect(trace.consumedByRule("stress_high")).toBe("MENTAL_RED");
      // Proves the signal remains genuinely owned by Training — a later
      // attempt under a different rule must fail.
      expect(trace.consume("stress_high", "SOME_OTHER_RULE")).toBe(false);
    });

    it("RED motivation, pre-consumed by MENTAL_RED → supportive action_hint, no consume by Mental", () => {
      const trace = new SignalTrace();
      trace.consume("motivation_low", "MENTAL_RED");
      const result = computeMentalDomain({ mentalDimension: dim("RED", ["motivation_low"]), eventContext: undefined, signalTrace: trace });
      expect(result.mental).toEqual({ active: true, action_hint: RED_SUPPORTIVE_HINT });
      expect(result.triggeredRule).toBeUndefined();
      expect(trace.consume("motivation_low", "SOME_OTHER_RULE")).toBe(false);
    });

    it("both stress and motivation RED → Training's stress_high precedence honored, motivation_low never touched by Mental, one supportive action only", () => {
      const trace = new SignalTrace();
      trace.consume("stress_high", "MENTAL_RED"); // mirrors training.ts's own precedence
      const result = computeMentalDomain({
        mentalDimension: dim("RED", ["stress_high", "motivation_low"]),
        eventContext: undefined,
        signalTrace: trace,
      });
      expect(result.mental).toEqual({ active: true, action_hint: RED_SUPPORTIVE_HINT });
      expect(result.triggeredRule).toBeUndefined();
      expect(trace.has("motivation_low")).toBe(false);
      expect(trace.consume("motivation_low", "MENTAL_AMBER_MOTIVATION")).toBe(true); // untouched, genuinely free
    });

    it("RED stress + motivation AMBER (mixed) → RED wins at dimension level, no AMBER consume attempted on motivation_low", () => {
      const trace = new SignalTrace();
      trace.consume("stress_high", "MENTAL_RED");
      const result = computeMentalDomain({
        mentalDimension: dim("RED", ["stress_high", "motivation_low"]),
        eventContext: undefined,
        signalTrace: trace,
      });
      expect(result.mental).toEqual({ active: true, action_hint: RED_SUPPORTIVE_HINT });
      expect(result.triggeredRule).toBeUndefined();
      expect(trace.consumedByRule("motivation_low")).toBeUndefined();
    });

    it("RED + PRE_EVENT → focus and supportive action_hint both populated", () => {
      const trace = new SignalTrace();
      trace.consume("stress_high", "MENTAL_RED");
      const result = computeMentalDomain({
        mentalDimension: dim("RED", ["stress_high"]),
        eventContext: eventContext("PRE_EVENT"),
        signalTrace: trace,
      });
      expect(result.mental).toEqual({ active: true, focus: PRE_EVENT_FOCUS, action_hint: RED_SUPPORTIVE_HINT });
    });

    it("RED with ownership unverifiable (never consumed by anyone) → no fabricated supportive claim", () => {
      const result = computeMentalDomain({
        mentalDimension: dim("RED", ["stress_high"]),
        eventContext: undefined,
        signalTrace: new SignalTrace(),
      });
      expect(result.mental).toEqual({ active: false });
      expect(result.triggeredRule).toBeUndefined();
    });
  });

  describe("Event phase does not globally suppress or manufacture Mental signals", () => {
    it("POST_EVENT + GREEN → inactive", () => {
      const result = computeMentalDomain({ mentalDimension: dim("GREEN"), eventContext: eventContext("POST_EVENT"), signalTrace: new SignalTrace() });
      expect(result.mental).toEqual({ active: false });
    });

    it("POST_EVENT + AMBER stress → action_hint active, no focus, no debrief wording", () => {
      const trace = new SignalTrace();
      const result = computeMentalDomain({ mentalDimension: dim("AMBER", ["stress_high"]), eventContext: eventContext("POST_EVENT"), signalTrace: trace });
      expect(result.mental).toEqual({ active: true, action_hint: AMBER_STRESS_HINT });
    });

    it("POST_EVENT + RED → supportive action_hint active, no focus, no debrief wording", () => {
      const trace = new SignalTrace();
      trace.consume("stress_high", "MENTAL_RED");
      const result = computeMentalDomain({ mentalDimension: dim("RED", ["stress_high"]), eventContext: eventContext("POST_EVENT"), signalTrace: trace });
      expect(result.mental).toEqual({ active: true, action_hint: RED_SUPPORTIVE_HINT });
    });

    it("RACE_DAY_GENERIC + GREEN → inactive", () => {
      const result = computeMentalDomain({
        mentalDimension: dim("GREEN"),
        eventContext: eventContext("RACE_DAY_GENERIC", { in_progress: true }),
        signalTrace: new SignalTrace(),
      });
      expect(result.mental).toEqual({ active: false });
    });

    it("RACE_DAY_GENERIC + AMBER → action_hint active, no live-coaching wording", () => {
      const result = computeMentalDomain({
        mentalDimension: dim("AMBER", ["stress_high"]),
        eventContext: eventContext("RACE_DAY_GENERIC", { in_progress: true }),
        signalTrace: new SignalTrace(),
      });
      expect(result.mental).toEqual({ active: true, action_hint: AMBER_STRESS_HINT });
    });

    it("RACE_DAY_GENERIC + RED → supportive action_hint active", () => {
      const trace = new SignalTrace();
      trace.consume("motivation_low", "MENTAL_RED");
      const result = computeMentalDomain({
        mentalDimension: dim("RED", ["motivation_low"]),
        eventContext: eventContext("RACE_DAY_GENERIC", { in_progress: true }),
        signalTrace: trace,
      });
      expect(result.mental).toEqual({ active: true, action_hint: RED_SUPPORTIVE_HINT });
    });
  });

  describe("Determinism", () => {
    it("identical input → identical output", () => {
      const trace = new SignalTrace();
      const params = { mentalDimension: dim("AMBER", ["stress_high"]), eventContext: eventContext("PRE_EVENT"), signalTrace: trace } as const;
      const first = computeMentalDomain(params);
      // second call reuses the same already-mutated trace, mirroring a
      // single buildDailyPlan execution calling this once — re-invoking
      // with a fresh trace must reproduce the identical mental section.
      const second = computeMentalDomain({ ...params, signalTrace: new SignalTrace() });
      expect(first.mental).toEqual(second.mental);
    });
  });

  describe("Wiring — buildDailyPlan", () => {
    it("Safety REST keeps mental exactly {active:false}, Mental never invoked", () => {
      const ctx = baseRawContext({ checkin: { suspected_concussion: true } });
      const plan = buildDailyPlan(ctx);
      expect(plan.mental).toEqual({ active: false });
    });

    it("AMBER stress via full RawContext → mental active, Training unchanged, new triggered_rules entry appended", () => {
      const ctx = baseRawContext({
        active_mode: "OFF_SEASON_DEVELOPMENT",
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
        checkin: { work_stress: 6 },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.mental).toEqual({ active: true, action_hint: AMBER_STRESS_HINT });
      expect(plan.decision).toBe("KEEP");
      expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
      expect(plan.triggered_rules.some((r) => r.rule_id === "MENTAL_AMBER_STRESS")).toBe(true);
    });

    it("PRE_EVENT (priority B, non-A/A+) still produces focus — no priority filter", () => {
      const ctx = baseRawContext({
        upcoming_races: [
          { event_name: "Course locale", event_start: "2026-08-27", event_end: "2026-08-27", priority: "B", race_format: "OTHER" },
        ],
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.mental.active).toBe(true);
      expect(plan.mental.focus).toBe(PRE_EVENT_FOCUS);
    });

    it("is deterministic: identical RawContext produces identical mental output", () => {
      const ctx = baseRawContext({ checkin: { work_stress: 6 } });
      const planA = buildDailyPlan(ctx);
      const planB = buildDailyPlan(ctx);
      expect(planA.mental).toEqual(planB.mental);
    });
  });

  describe("Training regression — RED mental fixture unchanged", () => {
    it("RED stress: Training decision/final_session/MENTAL_RED rule unchanged, Mental supportive output populated, no second consume", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" },
        checkin: { work_stress: 9 },
      });
      const plan = buildDailyPlan(ctx);

      // Existing Training/MENTAL_RED behavior — must remain exactly as
      // established before V0.3_002C (mirrors training.ts's own branch).
      expect(plan.final_session).toEqual({ kind: "AEROBIC_BASE", load_profile: "MODERATE" });
      expect(plan.decision).toBe("MODIFY");
      const mentalRedRule = plan.triggered_rules.find((r) => r.rule_id === "MENTAL_RED");
      expect(mentalRedRule).toBeDefined();
      expect(mentalRedRule?.signals_used).toEqual(["stress_high"]);

      // New V0.3_002C supportive output — no second causal rule.
      expect(plan.mental).toEqual({ active: true, action_hint: RED_SUPPORTIVE_HINT });
      expect(plan.triggered_rules.some((r) => r.rule_id === "MENTAL_AMBER_STRESS")).toBe(false);
      expect(plan.triggered_rules.some((r) => r.rule_id === "MENTAL_AMBER_MOTIVATION")).toBe(false);
    });
  });

  describe("Technique regression — unaffected by Mental", () => {
    it("a Technique-relevant fixture keeps dh_or_technical identical to the V0.3_002B contract", () => {
      const ctx = baseRawContext({ planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } });
      const plan = buildDailyPlan(ctx);
      expect(plan.dh_or_technical.active).toBe(true);
      expect(plan.dh_or_technical.focus).toBe("Fixe ta ligne, dose le freinage, laisse rouler.");
      expect(plan.dh_or_technical.spot_hint).toBe("Terrain adapté au focus technique du jour.");
    });
  });
});
