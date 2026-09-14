import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRawContext, NoCurrentCheckinError } from "../../src/supabase/buildRawContext.js";
import { buildDailyPlan } from "../../src/engine/buildDailyPlan.js";
import { getRecentTechnicalCandidates } from "../../src/supabase/repositories/completedSessionsRepo.js";
import { getDecisionsByIds } from "../../src/supabase/repositories/decisionsRepo.js";
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
  insertCompletedSession,
  insertDecision,
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

describe("V0.3_005B (NAL-007A) — race status coaching-relevance filter (real Supabase)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "V0.3_005B race status filter test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it.each(["planned", "registered", "confirmed"] as const)(
    "A/B/C — a %s race 5 days out still produces PRE_EVENT, unchanged",
    async (status) => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      await insertRace(client, athlete.athleteId, {
        event_name: `${status} T-5 fixture race`,
        start_date: "2026-08-21",
        end_date: "2026-08-21",
        priority: "A_PLUS",
        race_format: "HOT_TRAIL_2DAY",
        status,
      });

      const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
      expect(rawContext.upcoming_races).toHaveLength(1);

      const plan = buildDailyPlan(rawContext);
      expect(plan.event_context?.phase).toBe("PRE_EVENT");
    }
  );

  it.each(["cancelled", "skipped"] as const)(
    "D/E — a %s race 5 days out is excluded entirely — no PRE_EVENT, no taper",
    async (status) => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      await insertRace(client, athlete.athleteId, {
        event_name: `${status} T-5 fixture race`,
        start_date: "2026-08-21",
        end_date: "2026-08-21",
        priority: "A_PLUS",
        race_format: "HOT_TRAIL_2DAY",
        status,
      });

      const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
      expect(rawContext.upcoming_races).toEqual([]);

      const plan = buildDailyPlan(rawContext);
      expect(plan.event_context).toBeUndefined();
    }
  );

  it.each(["cancelled", "skipped"] as const)(
    "F/G — a %s race spanning today produces no IN_PROGRESS / RACE_ACTIVITY",
    async (status) => {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      await insertRace(client, athlete.athleteId, {
        event_name: `${status} in-progress fixture race`,
        start_date: "2026-08-15",
        end_date: "2026-08-17",
        priority: "A_PLUS",
        status,
      });

      const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
      expect(rawContext.upcoming_races).toEqual([]);

      const plan = buildDailyPlan(rawContext);
      expect(plan.event_context?.in_progress).not.toBe(true);
      expect(plan.final_session.kind).not.toBe("RACE_ACTIVITY");
    }
  );

  it("H — a completed race that is still 5 days in the future is excluded (no PRE_EVENT)", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "completed-but-future fixture race",
      start_date: "2026-08-21",
      end_date: "2026-08-21",
      priority: "A_PLUS",
      status: "completed",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toEqual([]);

    const plan = buildDailyPlan(rawContext);
    expect(plan.event_context).toBeUndefined();
  });

  it("I — a completed race spanning today is excluded (no IN_PROGRESS / RACE_ACTIVITY)", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "completed in-progress fixture race",
      start_date: "2026-08-15",
      end_date: "2026-08-17",
      priority: "A_PLUS",
      status: "completed",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toEqual([]);

    const plan = buildDailyPlan(rawContext);
    expect(plan.event_context?.in_progress).not.toBe(true);
    expect(plan.final_session.kind).not.toBe("RACE_ACTIVITY");
  });

  it("J — a completed race that ended yesterday is INCLUDED, and POST_EVENT recovery still triggers", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "completed past fixture race",
      start_date: "2026-08-14",
      end_date: "2026-08-15", // ended yesterday relative to TODAY=2026-08-16
      priority: "A",
      race_format: "HOT_TRAIL_2DAY",
      status: "completed",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toHaveLength(1);

    const plan = buildDailyPlan(rawContext);
    expect(plan.event_context?.phase).toBe("POST_EVENT");
    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
  });

  it("K — an active (planned) race that ended yesterday still produces POST_EVENT exactly as before this change", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "planned past fixture race",
      start_date: "2026-08-14",
      end_date: "2026-08-15",
      priority: "A",
      race_format: "HOT_TRAIL_2DAY",
      status: "planned",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toHaveLength(1);

    const plan = buildDailyPlan(rawContext);
    expect(plan.event_context?.phase).toBe("POST_EVENT");
    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
  });

  it.each(["cancelled", "skipped"] as const)("L/M — a %s race that ended yesterday produces no POST_EVENT", async (status) => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: `${status} past fixture race`,
      start_date: "2026-08-14",
      end_date: "2026-08-15",
      priority: "A",
      status,
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toEqual([]);

    const plan = buildDailyPlan(rawContext);
    expect(plan.event_context).toBeUndefined();
  });

  it("N — race priority behavior is unaffected by this filter (A_PLUS still produces a strong soft constraint via raceProtocol)", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "priority fixture race",
      start_date: "2026-08-21",
      end_date: "2026-08-21",
      priority: "A_PLUS",
      race_format: "HOT_TRAIL_2DAY",
      status: "confirmed",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races[0]?.priority).toBe("A_PLUS");
  });

  it("O — NAL-001 committed activity vs a legitimate active (confirmed) race is unaffected: still reaches race-protocol arbitration", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "NAL-001 committed vs active race",
      start_date: "2026-08-21", // T-5
      end_date: "2026-08-21",
      priority: "A_PLUS",
      race_format: "HOT_TRAIL_2DAY",
      status: "confirmed",
    });
    await insertPlannedSession(client, athlete.athleteId, TODAY, {
      session_type: "DH_PERFORMANCE",
      intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      is_committed: true,
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    const plan = buildDailyPlan(rawContext);

    // T-5 ordinary recommendation is AEROBIC_BASE/LIGHT/30min — committed
    // family preservation must still fire exactly as in the pure-engine
    // NAL-001 tests.
    // duration_min: 150 — V0.3_006B provisional DH_LIGHT/LIGHT session window.
    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 150 });
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_PRESERVED")).toBe(true);
  });

  it("P — NAL-001 committed activity vs a cancelled race: the race never reaches race-protocol arbitration at all", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "NAL-001 committed vs cancelled race",
      start_date: "2026-08-21",
      end_date: "2026-08-21",
      priority: "A_PLUS",
      race_format: "HOT_TRAIL_2DAY",
      status: "cancelled",
    });
    await insertPlannedSession(client, athlete.athleteId, TODAY, {
      session_type: "DH_PERFORMANCE",
      intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      is_committed: true,
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    expect(rawContext.upcoming_races).toEqual([]);

    const plan = buildDailyPlan(rawContext);
    // No race at all -> the committed DH_PERFORMANCE session survives
    // completely untouched (no race protocol involvement whatsoever).
    // duration_min: 360 — V0.3_006B provisional DH_PERFORMANCE/HEAVY session
    // window (the athlete's own planned_session never carries an explicit
    // duration today, so the provisional default applies even on a true KEEP).
    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 });
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_PRESERVED")).toBe(false);
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_NO_ADAPTATION")).toBe(false);
  });
});

// V0.3_008A — Previous-Day Recovery Continuity, real DB wiring
// (completedSessionsRepo.ts's extended select -> mapRecentRecoveryContext
// -> RawContext.recent_recovery_context). The exhaustive eligibility matrix
// is already covered by the pure mapper unit tests
// (recentRecoveryContext.test.ts) — this proves only that the real select
// against a real completed_sessions row actually carries the new columns
// end to end.
describe("V0.3_008A — Previous-Day Recovery Continuity (real Supabase wiring)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;
  const TODAY = "2026-08-24";
  const YESTERDAY = "2026-08-23";

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "V0.3_008A recovery context test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("D-1 PARTIAL + fatigue_control + post fatigue -> RawContext.recent_recovery_context populated from the real row", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertCompletedSession(client, athlete.athleteId, YESTERDAY, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, {
      completionStatus: "partial",
      changeReason: "fatigue_control",
      postLegFatigue: 7,
      postGripFatigue: 7,
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_recovery_context).toEqual({
      session_date: YESTERDAY,
      completion_status: "partial",
      change_reason: "fatigue_control",
      post_leg_fatigue: 7,
      post_grip_fatigue: 7,
    });
  });

  it("D-1 SKIPPED + fatigue_control (no intervention, no post fatigue) -> still populated, nulls carried through", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertCompletedSession(client, athlete.athleteId, YESTERDAY, "DH_TECHNICAL", null, {
      completionStatus: "skipped",
      changeReason: "fatigue_control",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_recovery_context).toEqual({
      session_date: YESTERDAY,
      completion_status: "skipped",
      change_reason: "fatigue_control",
      post_leg_fatigue: null,
      post_grip_fatigue: null,
    });
  });

  it("D-1 DONE (no change_reason possible) -> RawContext.recent_recovery_context absent", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertCompletedSession(client, athlete.athleteId, YESTERDAY, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "MODERATE" });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_recovery_context).toBeUndefined();
    expect(rawContext).not.toHaveProperty("recent_recovery_context");
  });

  it("D-1 PARTIAL with a different change_reason (mechanical) -> absent, inert in V0.3_008A", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertCompletedSession(client, athlete.athleteId, YESTERDAY, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, {
      completionStatus: "partial",
      changeReason: "mechanical",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_recovery_context).toBeUndefined();
  });

  it("no D-1 completed session at all -> absent", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_recovery_context).toBeUndefined();
  });

  it("recentLoad regression: extending the select with the new columns does not change recentLoad's own classification", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    // 5 HEAVY/MODERATE sessions in the 7-day window -> RED, exactly as before this ticket.
    const dates = ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"];
    for (const date of dates) {
      await insertCompletedSession(client, athlete.athleteId, date, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "HEAVY" });
    }

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);
    const plan = buildDailyPlan(rawContext);

    expect(rawContext.recent_sessions).toHaveLength(5);
    expect(plan.monitoring.observe).toContain("Surveiller la charge cumulée sur 7 jours (très élevée)");
  });

  it("athlete A's D-1 fatigue_control never leaks into athlete B's RawContext — no global/latest lookup", async () => {
    const athleteB = await createTestAthlete(client, "V0.3_008A recovery context cross-athlete B");
    try {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      await insertCompletedSession(client, athlete.athleteId, YESTERDAY, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, {
        completionStatus: "partial",
        changeReason: "fatigue_control",
        postLegFatigue: 7,
        postGripFatigue: 7,
      });

      await insertCheckin(client, athleteB.athleteId, TODAY);
      await insertTrainingBlock(client, athleteB.athleteId, "IN_SEASON");
      // athleteB deliberately gets no completed session of its own.

      const { rawContext: rawA } = await buildRawContext(client, athlete.athleteId, TODAY);
      const { rawContext: rawB } = await buildRawContext(client, athleteB.athleteId, TODAY);

      expect(rawA.recent_recovery_context).toBeDefined();
      expect(rawB.recent_recovery_context).toBeUndefined();
    } finally {
      await deleteTestAthlete(client, athleteB);
    }
  });
});

// V0.3_008B — Technical Continuity, real DB wiring (completedSessionsRepo.ts's
// getRecentTechnicalCandidates -> decisionsRepo.ts's getDecisionsByIds ->
// resolveRecentTechnicalContext -> RawContext.recent_technical_context). The
// exhaustive resolution matrix (newest-wins, malformed-newest-falls-back,
// date-mismatch, invalid kind/outcome) is already covered by the pure
// resolver unit tests (recentTechnicalContext.test.ts) — this proves the
// real query bounds (window/limit), the real FK-linkage (decision_id ->
// decisions.id, including multiple same-date decisions), and cross-athlete
// isolation against the actual local Supabase stack.
describe("V0.3_008B — Technical Continuity (real Supabase wiring)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;
  const TODAY = "2026-09-14";
  const D1 = "2026-09-13";
  const D14 = "2026-08-31"; // exactly today - 14 days, still eligible
  const D15 = "2026-08-30"; // today - 15 days, ineligible
  const TOMORROW = "2026-09-15";

  const EXECUTION_TASK = "Choisis une section technique courte et travaille un seul point à la fois...";

  async function linkedCandidate(
    date: string,
    fields: { technicalOutcome?: "yes" | "partial" | "no"; executionTask?: string | null } = {}
  ): Promise<string> {
    const decisionId = await insertDecision(client, athlete.athleteId, date, {
      final_session: "DH_TECHNICAL",
      daily_plan:
        fields.executionTask === null
          ? { dh_or_technical: { active: true } }
          : { dh_or_technical: { active: true, execution_task: fields.executionTask ?? EXECUTION_TASK } },
    });
    await insertCompletedSession(client, athlete.athleteId, date, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, {
      completionStatus: "partial",
      decisionId,
      technicalOutcome: fields.technicalOutcome ?? "yes",
    });
    return decisionId;
  }

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "V0.3_008B technical continuity test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("D-1 valid technical fact -> RawContext.recent_technical_context populated from the real linked decision", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    const decisionId = await linkedCandidate(D1, { technicalOutcome: "partial" });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context).toEqual({
      source_decision_id: decisionId,
      session_date: D1,
      kind: "DH_TECHNICAL",
      execution_task: EXECUTION_TASK,
      technical_outcome: "partial",
      age_days: 1,
    });
  });

  it("D-14 (oldest eligible) valid technical fact -> still surfaces", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await linkedCandidate(D14);

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context?.session_date).toBe(D14);
    expect(rawContext.recent_technical_context?.age_days).toBe(14);
  });

  it("D-15 (one day older than the window) -> absent, the window boundary is exact", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await linkedCandidate(D15);

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context).toBeUndefined();
  });

  it("same-day D technical fact -> absent, no intra-day feedback loop", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await linkedCandidate(TODAY);

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context).toBeUndefined();
  });

  it("a future-dated technical fact -> absent (defensive; should not occur naturally)", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await linkedCandidate(TOMORROW);

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context).toBeUndefined();
  });

  it("no completed session at all in the window -> absent", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context).toBeUndefined();
    expect(rawContext).not.toHaveProperty("recent_technical_context");
  });

  it("a completed session with no decision_id/technical_outcome at all (ordinary DONE) never becomes a candidate", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertCompletedSession(client, athlete.athleteId, D1, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "MODERATE" });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context).toBeUndefined();
  });

  it("exact decision_id linkage: two decisions exist on the same historical date, the candidate resolves to exactly the one it's linked to", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    // A second, UNLINKED decision on the same date — must never be picked.
    await insertDecision(client, athlete.athleteId, D1, {
      final_session: "DH_TECHNICAL",
      daily_plan: { dh_or_technical: { active: true, execution_task: "Tâche d'une AUTRE décision — ne doit jamais apparaître" } },
    });
    const linkedDecisionId = await linkedCandidate(D1, { executionTask: "Tâche de la décision réellement liée" });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context?.source_decision_id).toBe(linkedDecisionId);
    expect(rawContext.recent_technical_context?.execution_task).toBe("Tâche de la décision réellement liée");
  });

  it("newest candidate malformed (linked decision has no execution_task — real case for any decision predating V0.3_008B0) -> falls back to the next older valid candidate", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    const D4 = "2026-09-10";
    await linkedCandidate(D1, { executionTask: null }); // malformed: no execution_task
    await linkedCandidate(D4, { executionTask: "Tâche valide plus ancienne" });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context?.session_date).toBe(D4);
    expect(rawContext.recent_technical_context?.execution_task).toBe("Tâche valide plus ancienne");
  });

  it("performed kind comes from completed_sessions.intervention.kind, never the linked decision's prescription", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    // The linked decision's own final_session is DH_PERFORMANCE (the
    // prescription), but the athlete actually performed DH_LIGHT.
    const decisionId = await insertDecision(client, athlete.athleteId, D1, {
      final_session: "DH_PERFORMANCE",
      daily_plan: { dh_or_technical: { active: true, execution_task: EXECUTION_TASK } },
    });
    // "DH_TECHNICAL" here is the coarse `public.session_type` DB enum value
    // (which has no DH_LIGHT/PUMPTRACK member — see docs/05_DATA_MODEL.md) —
    // the rich `intervention.kind` below (DH_LIGHT) is what the resolver
    // actually reads, exactly the coarse-vs-rich split V0.3_007B fixed.
    await insertCompletedSession(client, athlete.athleteId, D1, "DH_TECHNICAL", { kind: "DH_LIGHT", load_profile: "LIGHT" }, {
      completionStatus: "partial",
      decisionId,
      technicalOutcome: "yes",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context?.kind).toBe("DH_LIGHT");
  });

  it("Pumptrack source performed kind is a valid candidate", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    const decisionId = await insertDecision(client, athlete.athleteId, D1, {
      final_session: "DH_TECHNICAL", // coarse DB enum has no PUMPTRACK member
      daily_plan: { dh_or_technical: { active: true, execution_task: EXECUTION_TASK } },
    });
    await insertCompletedSession(client, athlete.athleteId, D1, "DH_TECHNICAL", { kind: "PUMPTRACK", load_profile: "LIGHT" }, {
      completionStatus: "partial",
      decisionId,
      technicalOutcome: "yes",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context?.kind).toBe("PUMPTRACK");
  });

  it("athlete A's technical fact never leaks into athlete B's RawContext — no global/latest lookup, explicit athlete_id filter on both queries", async () => {
    const athleteB = await createTestAthlete(client, "V0.3_008B technical continuity cross-athlete B");
    try {
      await insertCheckin(client, athlete.athleteId, TODAY);
      await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
      await linkedCandidate(D1);

      await insertCheckin(client, athleteB.athleteId, TODAY);
      await insertTrainingBlock(client, athleteB.athleteId, "IN_SEASON");
      // athleteB deliberately gets no completed session/decision of its own.

      const { rawContext: rawA } = await buildRawContext(client, athlete.athleteId, TODAY);
      const { rawContext: rawB } = await buildRawContext(client, athleteB.athleteId, TODAY);

      expect(rawA.recent_technical_context).toBeDefined();
      expect(rawB.recent_technical_context).toBeUndefined();
    } finally {
      await deleteTestAthlete(client, athleteB);
    }
  });

  it("zero candidate ids short-circuits: no decisions query is needed when there are no linked/outcome-bearing completed_sessions", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    // A completed session exists in the window but has neither decision_id
    // nor technical_outcome — never a candidate, and buildRawContext must
    // not throw/fail attempting to resolve zero decision ids.
    await insertCompletedSession(client, athlete.athleteId, D1, "AEROBIC_BASE", { kind: "AEROBIC_BASE", load_profile: "LIGHT" });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.recent_technical_context).toBeUndefined();
  });

  // §13/§41 — an actual repository/Supabase query failure must PROPAGATE
  // (per assertNoSupabaseError, the same canonical error policy every other
  // repository in this codebase already follows) — never silently
  // reinterpreted as "no technical context". A malformed `athlete_id`
  // (not a valid UUID) against the real local Postgres stack forces a real
  // query-level error from PostgREST (not a JS-level exception, so this
  // exercises the actual `{ data: null, error }` -> throw path), distinct
  // from every other test in this file which forces `undefined`/absence
  // through legitimate empty/ineligible data instead.
  it("getRecentTechnicalCandidates: an actual repository query failure propagates, never silently becomes an empty candidate list", async () => {
    await expect(getRecentTechnicalCandidates(client, "not-a-valid-uuid", TODAY)).rejects.toThrow(/Supabase read failed/);
  });

  it("getDecisionsByIds: an actual repository query failure propagates, never silently becomes an empty decision list", async () => {
    await expect(getDecisionsByIds(client, "not-a-valid-uuid", ["11111111-1111-1111-1111-111111111111"])).rejects.toThrow(
      /Supabase read failed/
    );
  });
});
