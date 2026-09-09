/**
 * V0.3_005A (NAL-001) — final DB→engine wiring proof. Every prior test for
 * this feature exercises either the pure engine (t4_raceProtocol.test.ts,
 * committedActivityFamily.test.ts) or the web RLS write path
 * (planningRepo.integration.test.ts) in isolation. This file proves the
 * complete real chain against a real local Supabase row, end to end:
 *
 *   planned_sessions.is_committed
 *   -> plannedSessionsRepo.getPlannedSessionFor
 *   -> mapPlannedSessionRow (plannedSessionIntervention.ts)
 *   -> buildRawContext -> RawContext.planned_session_committed
 *   -> runDailyFor -> buildDailyPlan (committed race-protocol arbitration)
 *   -> persist_daily_run -> decisions row
 *
 * Same pattern as runDailyFor.integration.test.ts (real athlete, real
 * fixture rows, real runDailyFor call, real persisted decisions row) — no
 * mock stands in for any part of this chain.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { ENGINE_VERSION } from "../../src/engine/buildDailyPlan.js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertCheckin,
  insertTrainingBlock,
  insertPlannedSession,
  insertRace,
  type TestAthlete,
} from "./testDb.js";

describe("V0.3_005A (NAL-001) — DB->engine wiring: planned_sessions.is_committed through runDailyFor", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  // T-5 before a real HOT_TRAIL_2DAY A_PLUS race -> ordinary T-X recommendation AEROBIC_BASE/LIGHT/30min.
  const TODAY = "2026-08-10";
  const RACE_START = "2026-08-15";
  const RACE_END = "2026-08-16";

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "V0.3_005A DB->engine wiring test athlete");
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertRace(client, athlete.athleteId, {
      event_name: "V0.3_005A T-5 fixture race",
      start_date: RACE_START,
      end_date: RACE_END,
      priority: "A_PLUS",
      race_format: "HOT_TRAIL_2DAY",
    });
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("Case A — is_committed=TRUE: committed DH-family adaptation survives the full DB round-trip, never AEROBIC_BASE", async () => {
    await insertPlannedSession(client, athlete.athleteId, TODAY, {
      session_type: "DH_PERFORMANCE",
      intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      is_committed: true,
    });

    // Database assertion first — the saved row actually carries the flag,
    // never inferred from anything downstream.
    const { data: savedRow } = await client
      .from("planned_sessions")
      .select("is_committed")
      .eq("athlete_id", athlete.athleteId)
      .eq("planned_date", TODAY)
      .single();
    expect(savedRow?.is_committed).toBe(true);

    const result = await runDailyFor(client, athlete.athleteId, TODAY);
    const plan = result.dailyPlan;

    expect(plan.planned_session_before).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY" });
    // duration_min: 150 — V0.3_006B provisional DH_LIGHT/LIGHT session window.
    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 150 });
    expect(plan.final_session.kind).not.toBe("AEROBIC_BASE");
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_PRESERVED")).toBe(true);
    // ENGINE_VERSION's exact value is engineVersion.test.ts's sole
    // responsibility — this only proves runDailyFor's live result matches
    // the real source constant, never a second hardcoded copy of the
    // literal that would go stale on every future provenance bump.
    expect(plan.engine_version).toBe(ENGINE_VERSION);

    const { data: decisionRow } = await client
      .from("decisions")
      .select("id, daily_plan, engine_version, final_session")
      .eq("id", result.persistence.decision_id)
      .single();
    // Self-consistency with the live result, not a second hardcoded
    // literal — proves the persistence round-trip is faithful regardless
    // of the current version string.
    expect(decisionRow?.engine_version).toBe(plan.engine_version);
    // Denormalized coarse column: DH_LIGHT has no dedicated DbSessionType — it
    // maps to RECOVERY (trainingInterventionToDbSessionType.ts), exactly like
    // MOBILITY/RECOVERY_ACTIVE. The rich kind survives only in daily_plan
    // JSONB, verified by the next assertion.
    expect(decisionRow?.final_session).toBe("RECOVERY");
    expect(decisionRow?.daily_plan).toEqual(plan as unknown as Record<string, unknown>);
  });

  it("Case B — is_committed=FALSE (control): legacy verbatim race-protocol substitution, no commitment trace", async () => {
    await insertPlannedSession(client, athlete.athleteId, TODAY, {
      session_type: "DH_PERFORMANCE",
      intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      is_committed: false,
    });

    const { data: savedRow } = await client
      .from("planned_sessions")
      .select("is_committed")
      .eq("athlete_id", athlete.athleteId)
      .eq("planned_date", TODAY)
      .single();
    expect(savedRow?.is_committed).toBe(false);

    const result = await runDailyFor(client, athlete.athleteId, TODAY);
    const plan = result.dailyPlan;

    expect(plan.planned_session_before).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY" });
    expect(plan.final_session).toEqual({ kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 30 });
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_PRESERVED")).toBe(false);
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_NO_ADAPTATION")).toBe(false);

    const { data: decisionRow } = await client
      .from("decisions")
      .select("final_session")
      .eq("id", result.persistence.decision_id)
      .single();
    expect(decisionRow?.final_session).toBe("AEROBIC_BASE");
  });
});
