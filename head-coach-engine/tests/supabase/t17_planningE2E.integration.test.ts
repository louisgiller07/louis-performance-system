/**
 * T17 — real local cross-stack regression (V0.3_003D): proves
 *   planned_sessions row (real DB) → getPlannedSessionFor → RawContext
 *   → real Head Coach arbitration (buildDailyPlan) → persist_daily_run
 *   → append-only decisions row
 * without changing any head-coach-engine/src/** behavior. Runs through
 * runDailyFor(admin, athleteId, date) directly — the same established
 * pattern already used by buildRawContext.integration.test.ts /
 * runDailyFor.integration.test.ts — never through the daily-run HTTP Edge
 * Function (no local Edge Function serving is set up or needed).
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient()
 * for the actual enforcement (the final backstop even if this file's own
 * skip logic ever regresses). This whole suite is skipped unless ALL of:
 *   RUN_LOCAL_SUPABASE_INTEGRATION=1
 *   a local server key is present
 *   the resolved SUPABASE_URL is explicitly http://127.0.0.1:54321 or
 *     http://localhost:54321
 * A missing opt-in, missing key, or non-loopback URL all show up as
 * SKIPPED, never a silent pass or a hard failure. There is no remote
 * integration-test mode.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertCheckin,
  insertTrainingBlock,
  insertPlannedSession,
  insertRace,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { inferFallbackSession } from "../../src/domains/fallbackInference.js";
import { NUTRITION_POLICY } from "../../src/config/nutritionPolicy.js";
import { mapTrainingInterventionToDbSessionType } from "../../src/mapping/trainingInterventionToDbSessionType.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

// Always-on, pure, network-free — proves the negative case directly rather
// than only by inspection: the real production project URL can never
// satisfy the gate, even with the other two conditions true.
describe("t17 gate — local-target safety (always-on, no network)", () => {
  it("the real production Supabase project URL is never loopback", () => {
    expect(isLoopbackSupabaseUrl("https://uvolpldwwyvadlamulvr.supabase.co")).toBe(false);
  });

  it("a production URL keeps the T17 gate closed even with opt-in and a key-shaped string present", () => {
    const wouldBeEnabled = "1" === "1" && !!"some-key-shaped-string" && isLoopbackSupabaseUrl("https://uvolpldwwyvadlamulvr.supabase.co");
    expect(wouldBeEnabled).toBe(false);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)("T17 — Planning → RawContext → DailyPlan → decision (real local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    admin = createTestClient();
  });

  async function withScratchAthlete<T>(name: string, run: (athlete: TestAthlete) => Promise<T>): Promise<T> {
    const athlete = await createTestAthlete(admin, name);
    try {
      return await run(athlete);
    } finally {
      // Cascades decisions/health_flags/planned_sessions/completed_sessions/
      // daily_checkins via FK — no manual decision cleanup needed. Runs even
      // if `run` throws, so a failed assertion never leaves an orphan.
      await deleteTestAthlete(admin, athlete);
    }
  }

  it("§16 never planned: falls back to inference, no rich intent anywhere", async () => {
    const date = "2026-09-07"; // Monday — WEEKDAY_SPLIT[0] via inferFallbackSession
    await withScratchAthlete("T17 never-planned", async (athlete) => {
      await insertTrainingBlock(admin, athlete.athleteId, "IN_SEASON");
      await insertCheckin(admin, athlete.athleteId, date);
      // Deliberately no insertPlannedSession call at all.

      const result = await runDailyFor(admin, athlete.athleteId, date);

      expect(result.rawContext.planned_session).toBeNull();
      expect(result.dailyPlan.planned_session_before).toBeNull();
      expect(result.dailyPlan.triggered_rules.some((r) => r.rule_id === "INFERENCE_FALLBACK")).toBe(true);
      expect(result.dailyPlan.final_session).toEqual(inferFallbackSession(date));

      const { data: decisionRow } = await admin
        .from("decisions")
        .select("daily_plan, planned_session_before")
        .eq("id", result.persistence.decision_id)
        .single();
      expect(decisionRow?.daily_plan.planned_session_before).toBeNull();
      expect(decisionRow?.planned_session_before).toBeNull();
    });
  });

  it("§17 planned then deleted: converges to the exact same no-intent contract as never-planned", async () => {
    const date = "2026-09-07"; // Monday, same weekday as the never-planned scenario, different scratch athlete
    await withScratchAthlete("T17 planned-then-deleted", async (athlete) => {
      await insertTrainingBlock(admin, athlete.athleteId, "IN_SEASON");
      await insertCheckin(admin, athlete.athleteId, date);
      await insertPlannedSession(admin, athlete.athleteId, date, { session_type: "REST", intervention: { kind: "REST" } });

      const { error: deleteError } = await admin
        .from("planned_sessions")
        .delete()
        .eq("athlete_id", athlete.athleteId)
        .eq("planned_date", date);
      if (deleteError) throw new Error(`scratch planned_sessions delete failed: ${deleteError.message}`);

      const result = await runDailyFor(admin, athlete.athleteId, date);

      expect(result.rawContext.planned_session).toBeNull();
      expect(result.dailyPlan.planned_session_before).toBeNull();
      expect(result.dailyPlan.final_session).toEqual(inferFallbackSession(date));

      const { data: decisionRow } = await admin
        .from("decisions")
        .select("daily_plan, planned_session_before")
        .eq("id", result.persistence.decision_id)
        .single();
      expect(decisionRow?.daily_plan.planned_session_before).toBeNull();
      expect(decisionRow?.planned_session_before).toBeNull();
    });
  });

  it("§18 explicit REST: survives intact and wins arbitration under neutral conditions", async () => {
    const date = "2026-09-08";
    await withScratchAthlete("T17 explicit REST", async (athlete) => {
      await insertTrainingBlock(admin, athlete.athleteId, "IN_SEASON");
      await insertCheckin(admin, athlete.athleteId, date);
      await insertPlannedSession(admin, athlete.athleteId, date, { session_type: "REST", intervention: { kind: "REST" } });

      const result = await runDailyFor(admin, athlete.athleteId, date);

      expect(result.rawContext.planned_session).toEqual({ kind: "REST" });
      expect(result.dailyPlan.planned_session_before).toEqual({ kind: "REST" });
      expect(result.dailyPlan.final_session.kind).toBe("REST");
      expect(result.dailyPlan.decision).toBe("KEEP");

      const { data: decisionRow } = await admin
        .from("decisions")
        .select("daily_plan, planned_session_before, final_session")
        .eq("id", result.persistence.decision_id)
        .single();
      expect(decisionRow?.daily_plan.planned_session_before).toEqual({ kind: "REST" });
      expect(decisionRow?.planned_session_before).toBe("REST");
      expect(decisionRow?.final_session).toBe("REST");
    });
  });

  it("§19 planned strength (STRENGTH_LOWER/HEAVY): rich intent + load survive, Nutrition strength branch activates", async () => {
    const date = "2026-09-09";
    await withScratchAthlete("T17 strength+nutrition", async (athlete) => {
      await insertTrainingBlock(admin, athlete.athleteId, "IN_SEASON");
      await insertCheckin(admin, athlete.athleteId, date);
      await insertPlannedSession(admin, athlete.athleteId, date, {
        session_type: "STRENGTH_A",
        intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      });

      const result = await runDailyFor(admin, athlete.athleteId, date);

      expect(result.rawContext.planned_session).toEqual({ kind: "STRENGTH_LOWER", load_profile: "HEAVY" });
      expect(result.dailyPlan.planned_session_before).toEqual({ kind: "STRENGTH_LOWER", load_profile: "HEAVY" });
      expect(result.dailyPlan.final_session.kind).toBe("STRENGTH_LOWER");
      expect(result.dailyPlan.nutrition.active).toBe(true);
      expect(result.dailyPlan.nutrition.hydration_target_l).toBe(NUTRITION_POLICY.baselineHydrationTargetL);
      expect(result.dailyPlan.nutrition.notes).toBeDefined();

      const { data: decisionRow } = await admin
        .from("decisions")
        .select("daily_plan, planned_session_before")
        .eq("id", result.persistence.decision_id)
        .single();
      expect(decisionRow?.daily_plan.planned_session_before).toEqual({ kind: "STRENGTH_LOWER", load_profile: "HEAVY" });
      expect(decisionRow?.planned_session_before).toBe(mapTrainingInterventionToDbSessionType({ kind: "STRENGTH_LOWER", load_profile: "HEAVY" }));
    });
  });

  it("§20 planned DH (DH_TECHNICAL/MODERATE): rich intent survives, Technique domain activates", async () => {
    const date = "2026-09-10";
    await withScratchAthlete("T17 DH+technique", async (athlete) => {
      await insertTrainingBlock(admin, athlete.athleteId, "IN_SEASON");
      await insertCheckin(admin, athlete.athleteId, date);
      await insertPlannedSession(admin, athlete.athleteId, date, {
        session_type: "DH_TECHNICAL",
        intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      });

      const result = await runDailyFor(admin, athlete.athleteId, date);

      expect(result.rawContext.planned_session).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
      expect(result.dailyPlan.planned_session_before).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
      expect(result.dailyPlan.final_session.kind).toBe("DH_TECHNICAL");
      expect(result.dailyPlan.dh_or_technical.active).toBe(true);
      expect(result.dailyPlan.dh_or_technical.focus).toBeDefined();
      expect(result.dailyPlan.dh_or_technical.spot_hint).toBeDefined();
    });
  });

  it("§21 race protocol precedence: RACE_ACTIVITY wins arbitration, raw athlete intent survives append-only", async () => {
    const date = "2026-09-11";
    await withScratchAthlete("T17 race precedence", async (athlete) => {
      await insertTrainingBlock(admin, athlete.athleteId, "IN_SEASON");
      await insertCheckin(admin, athlete.athleteId, date);
      await insertPlannedSession(admin, athlete.athleteId, date, {
        session_type: "DH_TECHNICAL",
        intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      });
      await insertRace(admin, athlete.athleteId, { event_name: "T17 scratch race", start_date: date, end_date: date });

      const result = await runDailyFor(admin, athlete.athleteId, date);

      // Athlete intent, loaded raw from planned_sessions — never substituted.
      expect(result.rawContext.planned_session).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
      expect(result.dailyPlan.planned_session_before).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });

      // Race protocol wins the engine baseline/final arbitration exactly as designed.
      expect(result.dailyPlan.final_session.kind).toBe("RACE_ACTIVITY");
      expect(result.dailyPlan.triggered_rules.some((r) => r.rule_id === "RACE_DAY_ACTIVE")).toBe(true);

      const { data: decisionRow } = await admin
        .from("decisions")
        .select("daily_plan, planned_session_before, final_session")
        .eq("id", result.persistence.decision_id)
        .single();
      // Rich JSONB source of truth: raw athlete intent survives append-only,
      // unsubstituted by the race recommendation that actually won arbitration.
      expect(decisionRow?.daily_plan.planned_session_before).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
      expect(decisionRow?.planned_session_before).toBe(mapTrainingInterventionToDbSessionType({ kind: "DH_TECHNICAL", load_profile: "MODERATE" }));
      expect(decisionRow?.final_session).toBe("RACE_PREP");
    });
  });
});
