import { buildDailyPlan } from "../engine/buildDailyPlan.js";
import { baseRawContext, RACE_CALENDAR } from "../../fixtures/louis.js";
import type { RawContext } from "../types/rawContext.js";

/**
 * CLI de démonstration locale — docs/06_ARCHITECTURE.md §CLI de démonstration.
 * Usage : npm run run:example <scenario>
 */
const SCENARIOS: Record<string, () => RawContext> = {
  "t1-grip-red": () =>
    baseRawContext({
      planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
      checkin: { grip_fatigue: 8, leg_fatigue: 2 },
    }),
  "t1-legs-red": () =>
    baseRawContext({
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      checkin: { leg_fatigue: 8, grip_fatigue: 2 },
    }),
  "t1-mental-red": () =>
    baseRawContext({
      planned_session: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" },
      checkin: { work_stress: 8, motivation: 3, leg_fatigue: 2, grip_fatigue: 2, sleep_hours: 7.5 },
    }),
  "t1-sleep-deficit": () =>
    baseRawContext({
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      checkin: { sleep_hours: 5.5, sleep_quality: 4 },
    }),
  "t3-concussion": () => baseRawContext({ checkin: { suspected_concussion: true } }),
  "t3-pain-non-safety": () =>
    baseRawContext({
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" },
      checkin: { pain: true, pain_intensity: 3, pain_location_code: "wrist_R" },
    }),
  "t3-pain-safety-traumatic": () =>
    baseRawContext({
      checkin: { pain: true, pain_intensity: 4, pain_traumatic: true, pain_location_code: "wrist_R" },
    }),
  "t4-tx-respected": () =>
    baseRawContext({
      today: "2026-08-12", // T-3 avant La Berra
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
    }),
  "t4-tx-vs-planned": () =>
    baseRawContext({
      today: "2026-08-12", // T-3 avant La Berra → T-X recommande RECOVERY_ACTIVE
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" }, // plan générique, n'a pas anticipé la course
    }),
  "t5-race-in-progress": () =>
    baseRawContext({
      today: "2026-08-16",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
    }),
  "t5-post-event": () =>
    baseRawContext({
      today: "2026-08-17",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
    }),
  "t6-fallback": () =>
    baseRawContext({
      today: "2026-08-24", // lundi
      active_mode: "OFF_SEASON_DEVELOPMENT",
      planned_session: null,
    }),
  "t7-keep": () =>
    baseRawContext({
      active_mode: "OFF_SEASON_DEVELOPMENT",
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    }),
  "t10-overlapping-races": () =>
    // Incohérence STRUCTURELLE (deux courses "en cours" le même jour, donnée
    // synthétique volontairement impossible) → confidence LOW.
    baseRawContext({
      active_mode: "OFF_SEASON_DEVELOPMENT",
      today: "2026-08-16",
      upcoming_races: [
        RACE_CALENDAR.LA_BERRA,
        { ...RACE_CALENDAR.LA_BERRA, event_name: "Course fictive se chevauchant (scénario de test)" },
      ],
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    }),
  "t10-plausible-not-contradiction": () =>
    // systemic GREEN + recent_load RED : état plausible, PAS une contradiction → confidence MEDIUM.
    baseRawContext({
      active_mode: "OFF_SEASON_DEVELOPMENT",
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      recent_sessions: [
        { date: "2026-08-23", intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" } },
        { date: "2026-08-22", intervention: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" } },
        { date: "2026-08-21", intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } },
        { date: "2026-08-20", intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } },
        { date: "2026-08-19", intervention: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } },
      ],
    }),
  "soft-constraint-applied": () =>
    // strong ≠ ignoré : sans planned_intent, no_grip_heavy (RACE_WEEK, strong) est appliquée.
    baseRawContext({
      active_mode: "RACE_WEEK",
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
    }),
  "soft-constraint-overridden": () =>
    // strong ≠ hard : avec planned_intent, le plan initial est conservé malgré la contrainte.
    baseRawContext({
      active_mode: "RACE_WEEK",
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
      planned_intent: "Dernière séance grip volontairement maintenue avant repos complet, validée avec l'athlète",
    }),
  "a5-dh-planned": () =>
    baseRawContext({
      planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      active_health_flags: [{ type: "concussion_suspect", status: "monitoring" }],
    }),
  "a5-non-dh-planned": () =>
    baseRawContext({
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      active_health_flags: [{ type: "concussion_suspect", status: "monitoring" }],
    }),
};

function main(): void {
  const scenario = process.argv[2];

  if (!scenario || !SCENARIOS[scenario]) {
    console.log("Usage: npm run run:example <scenario>");
    console.log("Scénarios disponibles :");
    for (const key of Object.keys(SCENARIOS)) console.log(`  - ${key}`);
    process.exitCode = scenario ? 1 : 0;
    return;
  }

  const ctx = SCENARIOS[scenario]();
  const plan = buildDailyPlan(ctx);
  console.log(JSON.stringify(plan, null, 2));
}

main();
