import { describe, it, expect } from "vitest";
import { computeTechniqueDomain } from "../src/domains/technique.js";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext, RACE_CALENDAR } from "../fixtures/louis.js";
import type { TrainingIntervention } from "../src/types/trainingIntervention.js";
import type { DimensionLevel } from "../src/types/dimensions.js";
import type { UpcomingRace } from "../src/types/context.js";

const FOCUS = "Fixe ta ligne, dose le freinage, laisse rouler.";
const SPOT_HINT_DEFAULT = "Terrain adapté au focus technique du jour.";
const SPOT_HINT_FATIGUE = "Terrain proche, à faible coût logistique.";
const SPOT_HINT_RACE = "Terrain représentatif de la prochaine course.";
const SPOT_HINT_RACE_FATIGUE = "Terrain représentatif de la prochaine course, à faible coût logistique.";
const ALLOWED_SPOT_HINTS = new Set([SPOT_HINT_DEFAULT, SPOT_HINT_FATIGUE, SPOT_HINT_RACE, SPOT_HINT_RACE_FATIGUE]);

const TODAY = "2026-01-01";
const GREEN: DimensionLevel = "GREEN";
const AMBER: DimensionLevel = "AMBER";
const RED: DimensionLevel = "RED";

function baseParams(overrides: {
  finalSession?: TrainingIntervention;
  upcomingRaces?: readonly UpcomingRace[];
  systemicLevel?: DimensionLevel;
  legsLevel?: DimensionLevel;
  armsGripLevel?: DimensionLevel;
} = {}) {
  return {
    finalSession: overrides.finalSession ?? { kind: "DH_TECHNICAL" as const, load_profile: "MODERATE" as const },
    today: TODAY,
    upcomingRaces: overrides.upcomingRaces ?? [],
    systemicLevel: overrides.systemicLevel ?? GREEN,
    legsLevel: overrides.legsLevel ?? GREEN,
    armsGripLevel: overrides.armsGripLevel ?? GREEN,
  };
}

function raceAt(daysFromToday: number, overrides: Partial<UpcomingRace> = {}): UpcomingRace {
  const [y, m, d] = TODAY.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  const iso = date.toISOString().slice(0, 10);
  return {
    event_name: "Fixture race",
    event_start: iso,
    event_end: iso,
    priority: "A",
    race_format: "OTHER",
    ...overrides,
  };
}

const ACTIVE_KINDS: TrainingIntervention[] = [
  { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
  { kind: "DH_PERFORMANCE", load_profile: "MODERATE" },
  { kind: "DH_LIGHT", load_profile: "LIGHT" },
  { kind: "PUMPTRACK", load_profile: "LIGHT" },
];

const INACTIVE_KINDS: TrainingIntervention[] = [
  { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
  { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
  { kind: "STRENGTH_FULL_LIGHT", load_profile: "LIGHT" },
  { kind: "POWER", load_profile: "HEAVY" },
  { kind: "GRIP_WORK", load_profile: "MODERATE" },
  { kind: "AEROBIC_BASE", load_profile: "LIGHT" },
  { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" },
  { kind: "MOBILITY" },
  { kind: "RECOVERY_ACTIVE" },
  { kind: "REST" },
  { kind: "BIKE_MAINTENANCE" },
  { kind: "RACE_ACTIVITY" },
];

describe("T11 — Technique DH (V0.3_002B)", () => {
  describe("Activation", () => {
    for (const session of ACTIVE_KINDS) {
      it(`${session.kind} → active`, () => {
        const result = computeTechniqueDomain(baseParams({ finalSession: session }));
        expect(result.active).toBe(true);
      });
    }

    for (const session of INACTIVE_KINDS) {
      it(`${session.kind} → inactive`, () => {
        const result = computeTechniqueDomain(baseParams({ finalSession: session }));
        expect(result).toEqual({ active: false });
      });
    }
  });

  describe("Focus", () => {
    it("every active case has exactly the one approved focus string", () => {
      for (const session of ACTIVE_KINDS) {
        const result = computeTechniqueDomain(baseParams({ finalSession: session }));
        expect(result.focus).toBe(FOCUS);
      }
    });

    it("is deterministic on repeated calls with identical input (no rotation)", () => {
      const params = baseParams();
      const first = computeTechniqueDomain(params);
      const second = computeTechniqueDomain(params);
      expect(first).toEqual(second);
    });
  });

  describe("Fatigue (C1.6)", () => {
    it("systemic AMBER alone → fatigue spot_hint", () => {
      const result = computeTechniqueDomain(baseParams({ systemicLevel: AMBER }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("legs AMBER alone → fatigue spot_hint", () => {
      const result = computeTechniqueDomain(baseParams({ legsLevel: AMBER }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("arms_grip AMBER alone → fatigue spot_hint", () => {
      const result = computeTechniqueDomain(baseParams({ armsGripLevel: AMBER }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("systemic RED alone → does NOT trigger C1.6 (default spot_hint)", () => {
      const result = computeTechniqueDomain(baseParams({ systemicLevel: RED }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("legs RED alone → does NOT trigger C1.6 (default spot_hint)", () => {
      const result = computeTechniqueDomain(baseParams({ legsLevel: RED }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("arms_grip RED alone → does NOT trigger C1.6 (default spot_hint)", () => {
      const result = computeTechniqueDomain(baseParams({ armsGripLevel: RED }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("mixed RED + AMBER → C1.6 applies because an AMBER dimension exists", () => {
      const result = computeTechniqueDomain(baseParams({ systemicLevel: RED, legsLevel: AMBER }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });
  });

  describe("Race proximity (C1.5, J+1..J+14 inclusive)", () => {
    it("race at J+1 → race branch", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(1)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_RACE);
    });

    it("race at J+14 → race branch", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(14)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_RACE);
    });

    it("race at J+15 → no race branch (default spot_hint)", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(15)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("race at J+0 (today) → no race branch (day 0 excluded)", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(0)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("past race → no race branch", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(-1)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("no race at all → no race branch", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [] }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("multiple races, one relevant (order A) → race branch, deterministic", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(30), raceAt(5)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_RACE);
    });

    it("multiple races, one relevant (order B, reversed) → identical result", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(5), raceAt(30)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_RACE);
    });
  });

  describe("Combined race + fatigue", () => {
    it("race in window + AMBER fatigue → exact combined spot_hint, both constraints preserved", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(7)], legsLevel: AMBER }));
      expect(result.spot_hint).toBe(SPOT_HINT_RACE_FATIGUE);
    });
  });

  describe("Output allowlist", () => {
    it("every possible spot_hint across the full matrix is one of the 4 approved strings", () => {
      const fatigueOptions: DimensionLevel[] = [GREEN, AMBER, RED];
      const raceOptions: readonly UpcomingRace[][] = [[], [raceAt(1)], [raceAt(14)], [raceAt(15)]];

      for (const session of ACTIVE_KINDS) {
        for (const legsLevel of fatigueOptions) {
          for (const upcomingRaces of raceOptions) {
            const result = computeTechniqueDomain(baseParams({ finalSession: session, legsLevel, upcomingRaces }));
            expect(result.active).toBe(true);
            expect(ALLOWED_SPOT_HINTS.has(result.spot_hint as string)).toBe(true);
          }
        }
      }
    });
  });

  describe("Wiring — buildDailyPlan", () => {
    it("Safety REST keeps dh_or_technical exactly {active:false}", () => {
      const ctx = baseRawContext({ checkin: { suspected_concussion: true } });
      const plan = buildDailyPlan(ctx);
      expect(plan.dh_or_technical).toEqual({ active: false });
    });

    it("populates dh_or_technical on a relevant non-SAFETY technical day", () => {
      const ctx = baseRawContext({ planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } });
      const plan = buildDailyPlan(ctx);
      expect(plan.dh_or_technical.active).toBe(true);
      expect(plan.dh_or_technical.focus).toBe(FOCUS);
      expect(plan.dh_or_technical.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("uses the actual FINAL session, not the pre-adaptation planned_session", () => {
      // grip fatigue RED pivots a GRIP_WORK plan to STRENGTH_LOWER/RECOVERY_ACTIVE
      // (training.ts C3.5) — never technique-active — while the originally
      // planned session kind alone would give no such signal either way here.
      // Use the inverse: a DH_TECHNICAL plan downgraded by grip RED to DH_LIGHT
      // (training.ts DH_INTENSE_KINDS pivot) must still read as technique-active.
      const ctx = baseRawContext({
        planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        checkin: { grip_fatigue: 8 },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session.kind).toBe("DH_LIGHT");
      expect(plan.dh_or_technical.active).toBe(true);
    });

    it("is deterministic: identical RawContext produces identical dh_or_technical", () => {
      const ctx = baseRawContext({ planned_session: { kind: "PUMPTRACK", load_profile: "LIGHT" } });
      const planA = buildDailyPlan(ctx);
      const planB = buildDailyPlan(ctx);
      expect(planA.dh_or_technical).toEqual(planB.dh_or_technical);
    });
  });

  describe("Regression — Training behavior unchanged (mirrors T7.1/T7.3)", () => {
    it("T7.1-equivalent — KEEP decision/final_session/triggered_rules unaffected by Technique", () => {
      const ctx = baseRawContext({
        active_mode: "OFF_SEASON_DEVELOPMENT",
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
      expect(plan.decision).toBe("KEEP");
      expect(plan.dh_or_technical).toEqual({ active: false });
    });

    it("T7.3-equivalent — REPLACE decision/final_session/triggered_rules unaffected by Technique", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
        checkin: { grip_fatigue: 8 },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session.kind).not.toBe("GRIP_WORK");
      expect(plan.decision).toBe("REPLACE");
      expect(plan.triggered_rules.some((r) => r.rule_id === "C3.5")).toBe(true);
    });

    it("default fixture race calendar (all races >14 days out) never triggers the race branch", () => {
      const ctx = baseRawContext({ planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } });
      expect(ctx.upcoming_races).toEqual(Object.values(RACE_CALENDAR));
      const plan = buildDailyPlan(ctx);
      expect(plan.dh_or_technical.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });
  });
});
