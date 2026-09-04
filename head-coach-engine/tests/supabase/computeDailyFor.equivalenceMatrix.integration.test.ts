/**
 * M2 closure pass — fixture ↔ Supabase equivalence matrix
 * (docs/10_TEST_PLAN.md §M2.D).
 *
 * `t6-fallback` and `t3-concussion` are already covered by
 * computeDailyFor.integration.test.ts. This file covers every other
 * canonical scenario from head-coach-engine/src/cli/runExample.ts's
 * `SCENARIOS` map (`t1-*`, `t3-pain-*`, `t4-*`, `t5-*`, `t7-keep`,
 * `t10-*`, `soft-constraint-*`, `a5-*`) — 17 scenarios, all representable
 * from the current M2 schema without inventing any data.
 *
 * `runExample.ts`'s `SCENARIOS` map is not imported directly: the file is
 * a CLI entrypoint (unexported map, `main()` runs as a module-level side
 * effect), so importing it would execute the CLI. Each scenario's
 * *fixture-construction recipe* is therefore reproduced here using the
 * same `baseRawContext`/`baseCheckin`/`RACE_CALENDAR` fixtures — but the
 * reference `DailyPlan` itself always comes from a real call to
 * `buildDailyPlan()` (M1, frozen), never hand-typed, and the Supabase-side
 * `DailyPlan` always comes from a real call to `computeDailyFor()` — only
 * the "given" (input construction) is duplicated, never the engine or the
 * expectations.
 *
 * `upcoming_races`: for scenarios that don't explicitly override it,
 * `baseRawContext` defaults to the full 4-race `RACE_CALENDAR`, all of
 * which fall outside `PROVISIONAL_THRESHOLDS.event`'s pre/post windows on
 * every `today` used below (verified directly against
 * src/engine/eventContext.ts's `classify()`) — `computeEventContext`
 * returns `null` and `hasOverlappingInProgressRaces` is `false` whether 0
 * or 4 irrelevant races are supplied. No `race_calendar` rows are seeded
 * for those scenarios; only scenarios that explicitly override
 * `upcoming_races` (`t4-*`, `t5-*`, `t10-overlapping-races`) seed real rows.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDailyPlan } from "../../src/engine/buildDailyPlan.js";
import { mapTrainingInterventionToDbSessionType } from "../../src/mapping/trainingInterventionToDbSessionType.js";
import { computeDailyFor } from "../../src/supabase/computeDailyFor.js";
import { baseRawContext, RACE_CALENDAR, LOUIS_COACHING_PROFILE } from "../../fixtures/louis.js";
import type { DailyCheckin } from "../../src/types/checkin.js";
import type { RawContext } from "../../src/types/rawContext.js";
import type { TrainingIntervention } from "../../src/types/trainingIntervention.js";
import type { TrainingMode, UpcomingRace } from "../../src/types/context.js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertCheckin,
  insertTrainingBlock,
  insertPlannedSession,
  insertRace,
  insertCompletedSession,
  insertHealthFlag,
  insertCoachingProfile,
  type TestAthlete,
} from "./testDb.js";

interface Scenario {
  name: string;
  today: string;
  activeMode: TrainingMode;
  checkinOverrides?: Partial<DailyCheckin>;
  plannedSession?: TrainingIntervention | null;
  plannedIntent?: string;
  races?: UpcomingRace[];
  recentSessions?: { date: string; intervention: TrainingIntervention }[];
  healthFlags?: { type: string; status: "active" | "monitoring" }[];
  buildFixtureContext: () => RawContext;
}

function race(r: UpcomingRace, eventNameOverride?: string): UpcomingRace {
  return eventNameOverride ? { ...r, event_name: eventNameOverride } : r;
}

const SCENARIOS: Scenario[] = [
  {
    name: "t1-grip-red",
    today: "2026-08-24",
    activeMode: "RACE_CLUSTER",
    checkinOverrides: { grip_fatigue: 8, leg_fatigue: 2 },
    plannedSession: { kind: "GRIP_WORK", load_profile: "HEAVY" },
    buildFixtureContext: () =>
      baseRawContext({
        planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
        checkin: { grip_fatigue: 8, leg_fatigue: 2 },
      }),
  },
  {
    name: "t1-legs-red",
    today: "2026-08-24",
    activeMode: "RACE_CLUSTER",
    checkinOverrides: { leg_fatigue: 8, grip_fatigue: 2 },
    plannedSession: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
    buildFixtureContext: () =>
      baseRawContext({
        planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
        checkin: { leg_fatigue: 8, grip_fatigue: 2 },
      }),
  },
  {
    name: "t1-mental-red",
    today: "2026-08-24",
    activeMode: "RACE_CLUSTER",
    checkinOverrides: { work_stress: 8, motivation: 3, leg_fatigue: 2, grip_fatigue: 2, sleep_hours: 7.5 },
    plannedSession: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" },
    buildFixtureContext: () =>
      baseRawContext({
        planned_session: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" },
        checkin: { work_stress: 8, motivation: 3, leg_fatigue: 2, grip_fatigue: 2, sleep_hours: 7.5 },
      }),
  },
  {
    name: "t1-sleep-deficit",
    today: "2026-08-24",
    activeMode: "RACE_CLUSTER",
    checkinOverrides: { sleep_hours: 5.5, sleep_quality: 4 },
    plannedSession: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
    buildFixtureContext: () =>
      baseRawContext({
        planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
        checkin: { sleep_hours: 5.5, sleep_quality: 4 },
      }),
  },
  {
    name: "t3-pain-non-safety",
    today: "2026-08-24",
    activeMode: "RACE_CLUSTER",
    checkinOverrides: { pain: true, pain_intensity: 3, pain_location_code: "wrist_R" },
    plannedSession: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" },
    buildFixtureContext: () =>
      baseRawContext({
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" },
        checkin: { pain: true, pain_intensity: 3, pain_location_code: "wrist_R" },
      }),
  },
  {
    name: "t3-pain-safety-traumatic",
    today: "2026-08-24",
    activeMode: "RACE_CLUSTER",
    checkinOverrides: { pain: true, pain_intensity: 4, pain_traumatic: true, pain_location_code: "wrist_R" },
    plannedSession: null,
    buildFixtureContext: () =>
      baseRawContext({
        checkin: { pain: true, pain_intensity: 4, pain_traumatic: true, pain_location_code: "wrist_R" },
      }),
  },
  {
    name: "t4-tx-respected",
    today: "2026-08-12",
    activeMode: "RACE_CLUSTER",
    plannedSession: null,
    races: [RACE_CALENDAR.LA_BERRA],
    buildFixtureContext: () =>
      baseRawContext({ today: "2026-08-12", upcoming_races: [RACE_CALENDAR.LA_BERRA] }),
  },
  {
    name: "t4-tx-vs-planned",
    today: "2026-08-12",
    activeMode: "RACE_CLUSTER",
    plannedSession: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
    races: [RACE_CALENDAR.LA_BERRA],
    buildFixtureContext: () =>
      baseRawContext({
        today: "2026-08-12",
        upcoming_races: [RACE_CALENDAR.LA_BERRA],
        planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      }),
  },
  {
    name: "t5-race-in-progress",
    today: "2026-08-16",
    activeMode: "RACE_CLUSTER",
    plannedSession: null,
    races: [RACE_CALENDAR.LA_BERRA],
    buildFixtureContext: () =>
      baseRawContext({ today: "2026-08-16", upcoming_races: [RACE_CALENDAR.LA_BERRA] }),
  },
  {
    name: "t5-post-event",
    today: "2026-08-17",
    activeMode: "RACE_CLUSTER",
    plannedSession: null,
    races: [RACE_CALENDAR.LA_BERRA],
    buildFixtureContext: () =>
      baseRawContext({ today: "2026-08-17", upcoming_races: [RACE_CALENDAR.LA_BERRA] }),
  },
  {
    name: "t7-keep",
    today: "2026-08-24",
    activeMode: "OFF_SEASON_DEVELOPMENT",
    plannedSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    buildFixtureContext: () =>
      baseRawContext({
        active_mode: "OFF_SEASON_DEVELOPMENT",
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      }),
  },
  {
    name: "t10-overlapping-races",
    today: "2026-08-16",
    activeMode: "OFF_SEASON_DEVELOPMENT",
    plannedSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    races: [RACE_CALENDAR.LA_BERRA, race(RACE_CALENDAR.LA_BERRA, "Course fictive se chevauchant (scénario de test)")],
    buildFixtureContext: () =>
      baseRawContext({
        active_mode: "OFF_SEASON_DEVELOPMENT",
        today: "2026-08-16",
        upcoming_races: [
          RACE_CALENDAR.LA_BERRA,
          { ...RACE_CALENDAR.LA_BERRA, event_name: "Course fictive se chevauchant (scénario de test)" },
        ],
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      }),
  },
  {
    name: "t10-plausible-not-contradiction",
    today: "2026-08-24",
    activeMode: "OFF_SEASON_DEVELOPMENT",
    plannedSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    races: [],
    recentSessions: [
      { date: "2026-08-23", intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" } },
      { date: "2026-08-22", intervention: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" } },
      { date: "2026-08-21", intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } },
      { date: "2026-08-20", intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } },
      { date: "2026-08-19", intervention: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } },
    ],
    buildFixtureContext: () =>
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
  },
  {
    name: "soft-constraint-applied",
    today: "2026-08-24",
    activeMode: "RACE_WEEK",
    plannedSession: { kind: "GRIP_WORK", load_profile: "HEAVY" },
    races: [],
    buildFixtureContext: () =>
      baseRawContext({
        active_mode: "RACE_WEEK",
        today: "2026-08-24",
        upcoming_races: [],
        planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
      }),
  },
  {
    name: "soft-constraint-overridden",
    today: "2026-08-24",
    activeMode: "RACE_WEEK",
    plannedSession: { kind: "GRIP_WORK", load_profile: "HEAVY" },
    plannedIntent: "Dernière séance grip volontairement maintenue avant repos complet, validée avec l'athlète",
    races: [],
    buildFixtureContext: () =>
      baseRawContext({
        active_mode: "RACE_WEEK",
        today: "2026-08-24",
        upcoming_races: [],
        planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
        planned_intent: "Dernière séance grip volontairement maintenue avant repos complet, validée avec l'athlète",
      }),
  },
  {
    name: "a5-dh-planned",
    today: "2026-08-24",
    activeMode: "RACE_CLUSTER",
    plannedSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    healthFlags: [{ type: "concussion_suspect", status: "monitoring" }],
    buildFixtureContext: () =>
      baseRawContext({
        planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        active_health_flags: [{ type: "concussion_suspect", status: "monitoring" }],
      }),
  },
  {
    name: "a5-non-dh-planned",
    today: "2026-08-24",
    activeMode: "RACE_CLUSTER",
    plannedSession: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    healthFlags: [{ type: "concussion_suspect", status: "monitoring" }],
    buildFixtureContext: () =>
      baseRawContext({
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
        active_health_flags: [{ type: "concussion_suspect", status: "monitoring" }],
      }),
  },
];

describe("M2 closure pass — fixture ↔ Supabase equivalence matrix (integration, local Supabase)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "equivalence matrix test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it.each(SCENARIOS)("$name", async (scenario) => {
    const expectedPlan = buildDailyPlan(scenario.buildFixtureContext());

    await insertCheckin(client, athlete.athleteId, scenario.today, scenario.checkinOverrides ?? {});
    await insertTrainingBlock(client, athlete.athleteId, scenario.activeMode);
    // V0.3_004A — the fixture side (buildFixtureContext -> baseRawContext)
    // defaults to Louis's own coaching_profile; mirror it into Supabase so
    // this remains a genuine fixture <-> Supabase equivalence check rather
    // than a false mismatch between "Louis's fixture cues" and "no profile
    // row at all" for the scratch athlete.
    await insertCoachingProfile(client, athlete.athleteId, LOUIS_COACHING_PROFILE);

    if (scenario.plannedSession) {
      await insertPlannedSession(client, athlete.athleteId, scenario.today, {
        session_type: mapTrainingInterventionToDbSessionType(scenario.plannedSession),
        intervention: scenario.plannedSession,
        planned_intent: scenario.plannedIntent ?? null,
      });
    }

    if (scenario.races) {
      for (const r of scenario.races) {
        await insertRace(client, athlete.athleteId, {
          event_name: r.event_name,
          start_date: r.event_start,
          end_date: r.event_end,
          priority: r.priority,
          race_format: r.race_format,
        });
      }
    }

    if (scenario.recentSessions) {
      for (const s of scenario.recentSessions) {
        await insertCompletedSession(
          client,
          athlete.athleteId,
          s.date,
          mapTrainingInterventionToDbSessionType(s.intervention),
          s.intervention
        );
      }
    }

    if (scenario.healthFlags) {
      for (const f of scenario.healthFlags) {
        await insertHealthFlag(client, athlete.athleteId, f.type, f.status);
      }
    }

    const { dailyPlan } = await computeDailyFor(client, athlete.athleteId, scenario.today);

    expect(dailyPlan).toEqual(expectedPlan);
  });
});
