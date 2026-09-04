import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRawContext, NoCurrentCheckinError } from "../../src/supabase/buildRawContext.js";
import { buildDailyPlan } from "../../src/engine/buildDailyPlan.js";
import { IncompleteDailyCheckinError } from "../../src/supabase/mapping/dailyCheckinRow.js";
import { IncompleteCheckinPainCriteriaError } from "../../src/supabase/mapping/dailyCheckinPainCriteria.js";
import { InvalidTrainingModeError } from "../../src/supabase/mapping/trainingMode.js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertCheckin,
  insertTrainingBlock,
  insertPlannedSession,
  insertHealthFlag,
  insertRace,
  insertCoachingProfile,
  type TestAthlete,
} from "./testDb.js";

const TODAY = "2026-08-16";

describe("M2 read path — buildRawContext (integration, local Supabase)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "buildRawContext integration test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("builds a correct RawContext from a complete M2 checkin + current training block", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY, { sleep_hours: 6.5, leg_fatigue: 5 });
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const { rawContext, warnings } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.today).toBe(TODAY);
    expect(rawContext.checkin.sleep_hours).toBe(6.5);
    expect(rawContext.checkin.leg_fatigue).toBe(5);
    expect(rawContext.active_mode).toBe("IN_SEASON");
    expect(rawContext.active_experiments).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("rejects a current checkin with a NULL enriched pain criterion (M2_001 boundary)", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY, { pain_traumatic: null });
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    await expect(buildRawContext(client, athlete.athleteId, TODAY)).rejects.toThrow(
      IncompleteCheckinPainCriteriaError
    );
  });

  it("rejects a current checkin with a NULL required scalar field (sleep_hours)", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY, { sleep_hours: null });
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    await expect(buildRawContext(client, athlete.athleteId, TODAY)).rejects.toThrow(IncompleteDailyCheckinError);
  });

  it("rejects when no daily_checkins row exists for today", async () => {
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    await expect(buildRawContext(client, athlete.athleteId, TODAY)).rejects.toThrow(NoCurrentCheckinError);
  });

  it("includes an active health flag in active_health_flags", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertHealthFlag(client, athlete.athleteId, "concussion_suspect", "active");

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.active_health_flags).toEqual([{ type: "concussion_suspect", status: "active" }]);
  });

  it("includes a monitoring health flag in active_health_flags", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertHealthFlag(client, athlete.athleteId, "concussion_suspect", "monitoring");

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.active_health_flags).toEqual([{ type: "concussion_suspect", status: "monitoring" }]);
  });

  it("excludes a resolved health flag from active_health_flags", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertHealthFlag(client, athlete.athleteId, "concussion_suspect", "resolved");

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.active_health_flags).toEqual([]);
  });

  it("uses the rich intervention JSONB as source of truth for planned_session", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertPlannedSession(client, athlete.athleteId, TODAY, {
      session_type: "STRENGTH_A",
      intervention: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" },
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "HEAVY" });
  });

  it("falls back to the deterministic inversion for a legacy REST row with no intervention", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertPlannedSession(client, athlete.athleteId, TODAY, { session_type: "REST" });

    const { rawContext, warnings } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_session).toEqual({ kind: "REST" });
    expect(warnings).toEqual([]);
  });

  it("never fabricates a rich intervention for a legacy ambiguous session_type, and surfaces a warning", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertPlannedSession(client, athlete.athleteId, TODAY, { session_type: "STRENGTH_A" });

    const { rawContext, warnings } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_session).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("STRENGTH_A");
  });

  it("never derives planned_intent from primary_objective — only the explicit planned_intent column is used", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    // primary_objective is intentionally not settable via insertPlannedSession's
    // typed fixture helper — there is structurally no path for it to leak into
    // RawContext.planned_intent through this boundary.
    await insertPlannedSession(client, athlete.athleteId, TODAY, {
      session_type: "REST",
      planned_intent: "Explicit intent from planned_intent column",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_intent).toBe("Explicit intent from planned_intent column");
  });

  it("leaves planned_session null and planned_intent undefined when no planned_sessions row exists for today", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const { rawContext, warnings } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_session).toBeNull();
    expect(rawContext.planned_intent).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe("V0.3_002B — widened race window (today+14) — M1 inertness", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "V0.3_002B race window test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("CASE A — race only at J+8: RawContext includes it, but EventContext/Training decision are unchanged", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const { rawContext: baseline } = await buildRawContext(client, athlete.athleteId, TODAY);
    const baselinePlan = buildDailyPlan(baseline);

    await insertRace(client, athlete.athleteId, {
      event_name: "J+8 fixture race",
      start_date: "2026-08-24",
      end_date: "2026-08-24",
    });
    const { rawContext: withRace } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(withRace.upcoming_races).toHaveLength(1);

    const plan = buildDailyPlan(withRace);
    expect(plan.event_context).toBeUndefined();
    expect(plan.decision).toBe(baselinePlan.decision);
    expect(plan.final_session).toEqual(baselinePlan.final_session);
    expect(plan.triggered_rules).toEqual(baselinePlan.triggered_rules);
  });

  it("CASE B — race only at J+14: RawContext includes it, but EventContext/Training decision are unchanged", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const { rawContext: baseline } = await buildRawContext(client, athlete.athleteId, TODAY);
    const baselinePlan = buildDailyPlan(baseline);

    await insertRace(client, athlete.athleteId, {
      event_name: "J+14 fixture race",
      start_date: "2026-08-30",
      end_date: "2026-08-30",
    });
    const { rawContext: withRace } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(withRace.upcoming_races).toHaveLength(1);

    const plan = buildDailyPlan(withRace);
    expect(plan.event_context).toBeUndefined();
    expect(plan.decision).toBe(baselinePlan.decision);
    expect(plan.final_session).toEqual(baselinePlan.final_session);
    expect(plan.triggered_rules).toEqual(baselinePlan.triggered_rules);
  });

  it("CASE C — race at J+15 is excluded from RawContext.upcoming_races", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "J+15 fixture race",
      start_date: "2026-08-31",
      end_date: "2026-08-31",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toEqual([]);
  });

  it("CASE D — race at J+7 (existing EventContext window) behaves exactly as before the widening", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "J+7 fixture race",
      start_date: "2026-08-23",
      end_date: "2026-08-23",
      priority: "A",
      race_format: "HOT_TRAIL_2DAY",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toHaveLength(1);

    const plan = buildDailyPlan(rawContext);
    expect(plan.event_context?.phase).toBe("PRE_EVENT");
    expect(plan.event_context?.days_to_event).toBe(7);
  });

  it("CASE E — an irrelevant J+8 race alongside a nearer J+3 race does not change EventContext/Training vs. J+3 alone", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "J+3 nearer race",
      start_date: "2026-08-19",
      end_date: "2026-08-19",
      priority: "A",
      race_format: "HOT_TRAIL_2DAY",
    });

    const { rawContext: onlyNear } = await buildRawContext(client, athlete.athleteId, TODAY);
    const baselinePlan = buildDailyPlan(onlyNear);

    await insertRace(client, athlete.athleteId, {
      event_name: "J+8 farther irrelevant race",
      start_date: "2026-08-24",
      end_date: "2026-08-24",
    });
    const { rawContext: both } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(both.upcoming_races).toHaveLength(2);

    const plan = buildDailyPlan(both);
    expect(plan.event_context).toEqual(baselinePlan.event_context);
    expect(plan.decision).toBe(baselinePlan.decision);
    expect(plan.final_session).toEqual(baselinePlan.final_session);
    expect(plan.triggered_rules).toEqual(baselinePlan.triggered_rules);
  });

  it("CASE F — historical/post-event backward window remains exactly unchanged", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "Recent past race",
      start_date: "2026-08-13",
      end_date: "2026-08-14",
      priority: "A",
      race_format: "HOT_TRAIL_2DAY",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toHaveLength(1);

    const plan = buildDailyPlan(rawContext);
    expect(plan.event_context?.phase).toBe("POST_EVENT");
  });

  describe("V0.3_004A — coaching_profile mapping (real athlete_coaching_profiles table)", () => {
    it("profile row exists → RawContext.coaching_profile contains the exact stored strings", async () => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      await insertCoachingProfile(client, athlete.athleteId, {
        technique_primary_focus: "Fixe ta ligne, dose le freinage, laisse rouler.",
        mental_pre_race_cue: "Comme à Wiriehorn.",
      });

      const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
      expect(rawContext.coaching_profile).toEqual({
        technique_primary_focus: "Fixe ta ligne, dose le freinage, laisse rouler.",
        mental_pre_race_cue: "Comme à Wiriehorn.",
      });
    });

    it("no profile row → RawContext.coaching_profile is absent (never a fabricated default)", async () => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      // Deliberately no insertCoachingProfile call at all — the exact
      // new-athlete state.

      const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
      expect(rawContext.coaching_profile).toBeUndefined();
      expect(rawContext).not.toHaveProperty("coaching_profile");
    });

    it("a partially-configured profile (only technique focus set) maps only that field, mental cue stays absent", async () => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      await insertCoachingProfile(client, athlete.athleteId, { technique_primary_focus: "Regarde loin devant." });

      const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
      expect(rawContext.coaching_profile).toEqual({ technique_primary_focus: "Regarde loin devant." });
      expect(rawContext.coaching_profile).not.toHaveProperty("mental_pre_race_cue");
    });

    it("a partially-configured profile (only mental cue set) maps only that field, technique focus stays absent — symmetric case", async () => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      await insertCoachingProfile(client, athlete.athleteId, { mental_pre_race_cue: "Respire, regarde la ligne." });

      const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
      expect(rawContext.coaching_profile).toEqual({ mental_pre_race_cue: "Respire, regarde la ligne." });
      expect(rawContext.coaching_profile).not.toHaveProperty("technique_primary_focus");
    });

    it("athlete A's profile can never enter athlete B's RawContext — no global/latest lookup", async () => {
      const athleteB = await createTestAthlete(client, "buildRawContext cross-athlete profile B");
      try {
        await insertCheckin(client, athlete.athleteId, TODAY);
        await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
        await insertCoachingProfile(client, athlete.athleteId, {
          technique_primary_focus: "Focus athlète A",
          mental_pre_race_cue: "Cue athlète A",
        });

        await insertCheckin(client, athleteB.athleteId, TODAY);
        await insertTrainingBlock(client, athleteB.athleteId, "IN_SEASON");
        // athleteB deliberately gets no coaching profile of its own.

        const { rawContext: rawA } = await buildRawContext(client, athlete.athleteId, TODAY);
        const { rawContext: rawB } = await buildRawContext(client, athleteB.athleteId, TODAY);

        expect(rawA.coaching_profile).toEqual({
          technique_primary_focus: "Focus athlète A",
          mental_pre_race_cue: "Cue athlète A",
        });
        expect(rawB.coaching_profile).toBeUndefined();
      } finally {
        await deleteTestAthlete(client, athleteB);
      }
    });
  });

  describe("V0.3_004C — active_mode UNSPECIFIED (real athlete_coaching_profiles-adjacent training_blocks cases)", () => {
    it("CASE 1 — zero current training_blocks rows -> active_mode = UNSPECIFIED (never an error)", async () => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      // Deliberately no insertTrainingBlock call at all.

      const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
      expect(rawContext.active_mode).toBe("UNSPECIFIED");
    });

    it("CASE 3 — a current training_blocks row exists but mode is NULL -> explicit InvalidTrainingModeError, never silently mapped to UNSPECIFIED", async () => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      // Same shape insertTrainingBlock uses, but with mode explicitly NULL
      // instead of a valid enum value — malformed configured data, not an
      // absent row.
      const { error } = await client.from("training_blocks").insert({
        athlete_id: athlete.athleteId,
        name: "Malformed current block",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        primary_focus: "test",
        is_current: true,
        mode: null,
      });
      if (error) throw new Error(`malformed training_blocks insert failed: ${error.message}`);

      await expect(buildRawContext(client, athlete.athleteId, TODAY)).rejects.toThrow(InvalidTrainingModeError);
    });

    it("CASE 4 — cross-athlete isolation: A has a current block, B has none -> B gets UNSPECIFIED, never A's mode", async () => {
      const athleteB = await createTestAthlete(client, "buildRawContext V0.3_004C cross-athlete B");
      try {
        await insertCheckin(client, athlete.athleteId, TODAY);
        await insertTrainingBlock(client, athlete.athleteId, "RACE_WEEK");

        await insertCheckin(client, athleteB.athleteId, TODAY);
        // athleteB deliberately gets no training_blocks row of its own.

        const { rawContext: rawA } = await buildRawContext(client, athlete.athleteId, TODAY);
        const { rawContext: rawB } = await buildRawContext(client, athleteB.athleteId, TODAY);

        expect(rawA.active_mode).toBe("RACE_WEEK");
        expect(rawB.active_mode).toBe("UNSPECIFIED");
      } finally {
        await deleteTestAthlete(client, athleteB);
      }
    });
  });
});
