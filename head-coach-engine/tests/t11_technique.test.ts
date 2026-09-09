import { describe, it, expect } from "vitest";
import { computeTechniqueDomain } from "../src/domains/technique.js";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext, RACE_CALENDAR } from "../fixtures/louis.js";
import type { TrainingIntervention } from "../src/types/trainingIntervention.js";
import type { DimensionLevel } from "../src/types/dimensions.js";
import type { UpcomingRace } from "../src/types/context.js";

const FOCUS = "Fixe ta ligne, dose le freinage, laisse rouler.";
// V0.3_006C1 — precedence-based terrain guidance (pain > fatigue > Mental
// RED > race-proximity > fresh/default), one winner, never concatenated —
// see domains/technique.ts#selectSpotHint.
const SPOT_HINT_DEFAULT =
  "Choisis un terrain connu ou représentatif où tu maîtrises déjà les lignes et peux travailler la vitesse avec précision.";
const SPOT_HINT_FATIGUE = "Choisis un terrain familier et lisible où tu peux garder de la marge et une exécution propre.";
const SPOT_HINT_RACE = "Terrain représentatif de la prochaine course.";
const SPOT_HINT_MENTAL_RED = "Privilégie un terrain familier et lisible pour réduire le nombre de décisions à prendre pendant le run.";
const SPOT_HINT_PAIN_UPPER_GRIP = "Privilégie un terrain familier, moins cassant et moins exigeant en freinage et en grip.";
const SPOT_HINT_PAIN_LOWER = "Privilégie un terrain familier et moins exigeant physiquement.";
const ALLOWED_SPOT_HINTS = new Set([
  SPOT_HINT_DEFAULT,
  SPOT_HINT_FATIGUE,
  SPOT_HINT_RACE,
  SPOT_HINT_MENTAL_RED,
  SPOT_HINT_PAIN_UPPER_GRIP,
  SPOT_HINT_PAIN_LOWER,
]);

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
  personalFocus?: string;
  painZoneCategory?: "upper_grip" | "lower" | "other";
  mentalRed?: boolean;
} = {}) {
  return {
    finalSession: overrides.finalSession ?? { kind: "DH_TECHNICAL" as const, load_profile: "MODERATE" as const },
    today: TODAY,
    upcomingRaces: overrides.upcomingRaces ?? [],
    systemicLevel: overrides.systemicLevel ?? GREEN,
    legsLevel: overrides.legsLevel ?? GREEN,
    armsGripLevel: overrides.armsGripLevel ?? GREEN,
    // V0.3_004A — pure input, mirrors what buildDailyPlan threads from
    // RawContext.coaching_profile.technique_primary_focus. Defaults to
    // Louis's own fixture value so every pre-existing call site in this
    // file keeps its exact prior behavior unless a test explicitly probes
    // a different/absent value.
    personalFocus: "personalFocus" in overrides ? overrides.personalFocus : FOCUS,
    painZoneCategory: overrides.painZoneCategory,
    mentalRed: overrides.mentalRed,
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

  describe("V0.3_004A — personalFocus is athlete-scoped pure input, never a global default", () => {
    it("a different athlete's personalFocus produces that exact different focus, never Louis's", () => {
      const otherFocus = "Regarde loin devant, pas la roue avant.";
      const result = computeTechniqueDomain(baseParams({ personalFocus: otherFocus }));
      expect(result.focus).toBe(otherFocus);
      expect(result.focus).not.toBe(FOCUS);
    });

    // V0.3_006B (Session Prescription V1) — corrects the prior expectation:
    // an absent personal focus no longer leaves `focus` omitted. A fixed,
    // deterministic generic fallback (keyed by DH kind, DH_GENERIC_FOCUS in
    // sessionPrescriptionPolicy.ts) is used instead, never presented as
    // learned personalization — see dhPrescription.ts#resolveDhFocus.
    it("personalFocus absent (athlete with no configured focus): Technique stays active, focus falls back to the fixed generic value for the kind, spot_hint remains the existing generic value", () => {
      const result = computeTechniqueDomain(baseParams({ personalFocus: undefined }));
      expect(result.active).toBe(true);
      expect(result.focus).toBe("Précision et qualité d'exécution");
      expect(result.focus).not.toBe(FOCUS);
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("personalFocus absent still respects the existing fatigue/race spot_hint contract unchanged, using the generic focus fallback", () => {
      const result = computeTechniqueDomain(baseParams({ personalFocus: undefined, legsLevel: AMBER }));
      expect(result.focus).toBe("Précision et qualité d'exécution");
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });
  });

  describe("V0.3_006C1 — execution_task", () => {
    it("present, matching the generic task for the kind, when personalFocus is absent", () => {
      const result = computeTechniqueDomain(baseParams({ personalFocus: undefined, finalSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } }));
      expect(result.execution_task).toBe(
        "Choisis une section technique courte et travaille un seul point à la fois ; répète jusqu'à obtenir une exécution propre avant de changer."
      );
    });

    it("absent when a personal focus is configured — never derived from arbitrary free text", () => {
      const result = computeTechniqueDomain(baseParams()); // default personalFocus = FOCUS
      expect(result.execution_task).toBeUndefined();
      expect(result.focus).toBe(FOCUS);
    });

    it("one deterministic generic task per DH kind, all four covered", () => {
      const expected: Record<string, string> = {
        DH_PERFORMANCE:
          "Choisis une section que tu connais bien, fixe un ou deux repères et répète la même ligne proprement avant d'augmenter la vitesse.",
        DH_TECHNICAL:
          "Choisis une section technique courte et travaille un seul point à la fois ; répète jusqu'à obtenir une exécution propre avant de changer.",
        DH_LIGHT: "Sur terrain connu, cherche une conduite fluide et relâchée sans objectif de vitesse.",
        PUMPTRACK: "Travaille la conservation de vitesse avec les appuis et le pompage, sans faire de la vitesse maximale l'objectif.",
      };
      for (const session of ACTIVE_KINDS) {
        const result = computeTechniqueDomain(baseParams({ finalSession: session, personalFocus: undefined }));
        expect(result.execution_task).toBe(expected[session.kind]);
      }
    });
  });

  describe("V0.3_006C1 (final correction) — load_guidance", () => {
    const HEAVY_GUIDANCE =
      "Séance orientée performance : fais monter l'engagement progressivement et travaille la vitesse sans sacrifier la précision ni le contrôle.";
    const MODERATE_GUIDANCE =
      "Priorise la qualité d'exécution. Engage davantage seulement quand tes lignes restent propres et ton contrôle bon ; ne cherche pas à pousser tous les runs.";
    const LIGHT_GUIDANCE =
      "Privilégie la fluidité et l'exécution propre. Ne cherche pas la vitesse et garde de la marge pendant toute la session.";

    it("HEAVY final load → HEAVY guidance", () => {
      const result = computeTechniqueDomain(baseParams({ finalSession: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" } }));
      expect(result.load_guidance).toBe(HEAVY_GUIDANCE);
    });

    it("MODERATE final load → MODERATE guidance", () => {
      const result = computeTechniqueDomain(baseParams({ finalSession: { kind: "DH_PERFORMANCE", load_profile: "MODERATE" } }));
      expect(result.load_guidance).toBe(MODERATE_GUIDANCE);
    });

    it("LIGHT final load → LIGHT guidance", () => {
      const result = computeTechniqueDomain(baseParams({ finalSession: { kind: "DH_LIGHT", load_profile: "LIGHT" } }));
      expect(result.load_guidance).toBe(LIGHT_GUIDANCE);
    });

    it("follows the FINAL load, not any prior/planned one — present regardless of personalFocus/pain/fatigue/Mental RED context", () => {
      const result = computeTechniqueDomain(
        baseParams({ finalSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, painZoneCategory: "upper_grip", mentalRed: true, legsLevel: AMBER })
      );
      expect(result.load_guidance).toBe(MODERATE_GUIDANCE);
    });

    it("absent for a non-DH-family kind (inactive dh_or_technical carries no load_guidance)", () => {
      for (const session of INACTIVE_KINDS) {
        const result = computeTechniqueDomain(baseParams({ finalSession: session }));
        expect(result).toEqual({ active: false });
      }
    });
  });

  describe("Fatigue (C1.6) — meaningful fatigue covers AMBER and RED (V0.3_006C1 final fatigue-terrain check)", () => {
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

    // Corrected (was: "does NOT trigger C1.6, default spot_hint") — a
    // severe RED fatigue must NOT fall through to fresh/race/default terrain
    // merely because it exceeded AMBER. See external-review RED scenario
    // (legs=9/grip=9 → DH_LIGHT/LIGHT, still DH-family, still deserves
    // reduced-demand terrain) proved end-to-end in
    // t15_dhSessionPrescription.test.ts.
    it("systemic RED alone → fatigue spot_hint (corrected: RED is meaningful fatigue too)", () => {
      const result = computeTechniqueDomain(baseParams({ systemicLevel: RED }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("legs RED alone → fatigue spot_hint (corrected: RED is meaningful fatigue too)", () => {
      const result = computeTechniqueDomain(baseParams({ legsLevel: RED }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("arms_grip RED alone → fatigue spot_hint (corrected: RED is meaningful fatigue too)", () => {
      const result = computeTechniqueDomain(baseParams({ armsGripLevel: RED }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("mixed RED + AMBER → fatigue spot_hint (either level alone is already sufficient)", () => {
      const result = computeTechniqueDomain(baseParams({ systemicLevel: RED, legsLevel: AMBER }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("GREEN on all three fatigue-relevant dimensions → no fatigue override (falls through to the next rank)", () => {
      const result = computeTechniqueDomain(baseParams({ systemicLevel: GREEN, legsLevel: GREEN, armsGripLevel: GREEN }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
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

  describe("V0.3_006C1 — terrain precedence (pain > fatigue > Mental RED > race-proximity > default)", () => {
    it("race in window + AMBER fatigue → fatigue wins (higher precedence), never a concatenated combined message", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(7)], legsLevel: AMBER }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    // V0.3_006C1 (final correction) — isolated race+pain regression: proves
    // pain still wins over race-proximity on its own (not only combined with
    // fatigue/Mental RED as the broader test below already does), making the
    // retirement of the old combined "race+fatigue" concatenated message an
    // explicit architectural decision rather than an accidental regression.
    it("race-proximate + pain (no fatigue, no Mental RED) → pain terrain guidance", () => {
      const result = computeTechniqueDomain(baseParams({ painZoneCategory: "upper_grip", upcomingRaces: [raceAt(7)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_PAIN_UPPER_GRIP);
    });

    it("upper_grip pain constraint beats fatigue, Mental RED, and race-proximity all at once", () => {
      const result = computeTechniqueDomain(
        baseParams({ painZoneCategory: "upper_grip", legsLevel: AMBER, mentalRed: true, upcomingRaces: [raceAt(7)] })
      );
      expect(result.spot_hint).toBe(SPOT_HINT_PAIN_UPPER_GRIP);
    });

    it("lower-limb pain constraint beats fatigue, Mental RED, and race-proximity all at once", () => {
      const result = computeTechniqueDomain(
        baseParams({ painZoneCategory: "lower", legsLevel: AMBER, mentalRed: true, upcomingRaces: [raceAt(7)] })
      );
      expect(result.spot_hint).toBe(SPOT_HINT_PAIN_LOWER);
    });

    it("painZoneCategory 'other' never triggers pain-specific terrain guidance (falls through to the next rank)", () => {
      const result = computeTechniqueDomain(baseParams({ painZoneCategory: "other", mentalRed: true }));
      expect(result.spot_hint).toBe(SPOT_HINT_MENTAL_RED);
    });

    it("fatigue beats Mental RED and race-proximity", () => {
      const result = computeTechniqueDomain(baseParams({ legsLevel: AMBER, mentalRed: true, upcomingRaces: [raceAt(7)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("Mental RED alone (no pain, no fatigue) produces the Mental RED terrain guidance", () => {
      const result = computeTechniqueDomain(baseParams({ mentalRed: true }));
      expect(result.spot_hint).toBe(SPOT_HINT_MENTAL_RED);
    });

    it("Mental RED beats race-proximity", () => {
      const result = computeTechniqueDomain(baseParams({ mentalRed: true, upcomingRaces: [raceAt(7)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_MENTAL_RED);
    });

    it("race-proximity alone (nothing higher-precedence) still produces the race guidance, unchanged", () => {
      const result = computeTechniqueDomain(baseParams({ upcomingRaces: [raceAt(7)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_RACE);
    });
  });

  // V0.3_006C1 (final fatigue-terrain check) — the exact A-F regression
  // matrix required after the external-review RED-fatigue scenario
  // (legs=9/grip=9): proves RED is treated identically to AMBER for terrain
  // purposes, including combined with race-proximity and losing to pain,
  // while GREEN never triggers a fatigue override.
  describe("V0.3_006C1 — required fatigue-terrain regression matrix (A-F)", () => {
    it("A. GREEN fatigue, no other constraint → fresh/default terrain", () => {
      const result = computeTechniqueDomain(baseParams({ systemicLevel: GREEN, legsLevel: GREEN, armsGripLevel: GREEN }));
      expect(result.spot_hint).toBe(SPOT_HINT_DEFAULT);
    });

    it("B. AMBER fatigue → fatigue terrain", () => {
      const result = computeTechniqueDomain(baseParams({ legsLevel: AMBER }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("C. RED fatigue → fatigue terrain", () => {
      const result = computeTechniqueDomain(baseParams({ legsLevel: RED }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("D. race-proximate + RED fatigue → fatigue terrain wins", () => {
      const result = computeTechniqueDomain(baseParams({ legsLevel: RED, upcomingRaces: [raceAt(7)] }));
      expect(result.spot_hint).toBe(SPOT_HINT_FATIGUE);
    });

    it("E. pain + RED fatigue → pain terrain wins", () => {
      const result = computeTechniqueDomain(baseParams({ painZoneCategory: "upper_grip", legsLevel: RED }));
      expect(result.spot_hint).toBe(SPOT_HINT_PAIN_UPPER_GRIP);
    });

    it("F. Mental RED + physical fatigue GREEN → mental terrain", () => {
      const result = computeTechniqueDomain(
        baseParams({ mentalRed: true, systemicLevel: GREEN, legsLevel: GREEN, armsGripLevel: GREEN })
      );
      expect(result.spot_hint).toBe(SPOT_HINT_MENTAL_RED);
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

    it("V0.3_004A — a different athlete's RawContext.coaching_profile produces that athlete's own focus, never Louis's", () => {
      const otherFocus = "Regarde loin devant, pas la roue avant.";
      const ctx = baseRawContext({
        planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        coaching_profile: { technique_primary_focus: otherFocus },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.dh_or_technical.focus).toBe(otherFocus);
      expect(plan.dh_or_technical.focus).not.toBe(FOCUS);
    });

    // V0.3_006B — corrects the prior expectation: absent coaching_profile no
    // longer leaves focus omitted; the fixed generic DH_TECHNICAL fallback
    // is used, never Louis's (or any other athlete's) personal value.
    it("V0.3_004A — coaching_profile entirely absent (new athlete, never configured): Technique stays active, focus falls back to the fixed generic value, never Louis's fixture value", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        coaching_profile: undefined,
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.dh_or_technical.active).toBe(true);
      expect(plan.dh_or_technical.focus).toBe("Précision et qualité d'exécution");
      expect(plan.dh_or_technical.focus).not.toBe(FOCUS);
      expect(plan.dh_or_technical.spot_hint).toBe(SPOT_HINT_DEFAULT);
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
