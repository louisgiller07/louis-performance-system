import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { persistDailyRun } from "../../src/supabase/persistDailyRun.js";
import type { DecisionInsertRow } from "../../src/supabase/mapping/dailyPlanToDecisionRow.js";
import type { DailyPlan } from "../../src/types/index.js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertCheckin,
  insertTrainingBlock,
  insertPlannedSession,
  insertCompletedSession,
  insertDecision,
  type TestAthlete,
} from "./testDb.js";

describe("M2 write path — runDailyFor (integration, local Supabase, real persist_daily_run)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "runDailyFor integration test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("A. neutral run: 1 decision, 0 new health_flag, health_flag_id = null, decision row matches the DailyPlan", async () => {
    const today = "2026-08-16";
    await insertCheckin(client, athlete.athleteId, today);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertPlannedSession(client, athlete.athleteId, today, { session_type: "REST" });

    const result = await runDailyFor(client, athlete.athleteId, today);

    expect(result.persistence.decision_id).toEqual(expect.any(String));
    expect(result.persistence.health_flag_id).toBeNull();

    const { data: flags } = await client.from("health_flags").select("id").eq("athlete_id", athlete.athleteId);
    expect(flags).toEqual([]);

    const { data: decisions } = await client
      .from("decisions")
      .select(
        "id, decision_date, final_session, reason, do_not_do, override_reason, engine_version, daily_plan, " +
          "active_mode, confidence_level, confidence, overridden_by_user, stop_conditions"
      )
      .eq("athlete_id", athlete.athleteId);
    expect(decisions).toHaveLength(1);

    const row = decisions![0] as unknown as Record<string, unknown>;
    expect(row.id).toBe(result.persistence.decision_id);
    expect(row.decision_date).toBe(today);
    expect(row.final_session).toBe("REST");
    expect(row.reason).toBe(result.dailyPlan.reasoning);
    expect(row.do_not_do).toEqual(result.dailyPlan.protection.do_not_do);
    expect(row.override_reason).toBe(result.dailyPlan.override_reason ?? null);
    expect(row.engine_version).toBe(result.dailyPlan.engine_version);
    expect(row.daily_plan).toEqual(result.dailyPlan as unknown as Record<string, unknown>);
    expect(row.active_mode).toBe(result.dailyPlan.active_mode);
    expect(row.confidence_level).toBe(result.dailyPlan.confidence);
    expect(row.confidence).toBeNull();
    expect(row.overridden_by_user).toBe(false);
    expect(row.stop_conditions).toBeNull();
  });

  it("B. SAFETY A1 (concussion) creates a health flag: 1 open flag, 1 decision, REST DailyPlan", async () => {
    const today = "2026-08-16";
    await insertCheckin(client, athlete.athleteId, today, { suspected_concussion: true });
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const result = await runDailyFor(client, athlete.athleteId, today);

    expect(result.dailyPlan.decision).toBe("REST");
    expect(result.dailyPlan.health_flag_to_create).toEqual({
      type: "concussion_suspect",
      reason: expect.any(String),
    });
    expect(result.persistence.health_flag_id).toEqual(expect.any(String));

    const { data: flags } = await client
      .from("health_flags")
      .select("flag_type, flag_date, description, status")
      .eq("athlete_id", athlete.athleteId);
    expect(flags).toHaveLength(1);
    expect(flags![0]).toEqual({
      flag_type: "concussion_suspect",
      flag_date: today,
      description: result.dailyPlan.health_flag_to_create!.reason,
      status: "active",
    });

    const { data: decisions } = await client.from("decisions").select("id").eq("athlete_id", athlete.athleteId);
    expect(decisions).toHaveLength(1);
  });

  it("10. idempotence: A1 repeated on day N+1 reuses the same open flag, appends a second decision", async () => {
    const dayN = "2026-08-16";
    const dayN1 = "2026-08-17";
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    await insertCheckin(client, athlete.athleteId, dayN, { suspected_concussion: true });
    const runN = await runDailyFor(client, athlete.athleteId, dayN);

    await insertCheckin(client, athlete.athleteId, dayN1, { suspected_concussion: true });
    const runN1 = await runDailyFor(client, athlete.athleteId, dayN1);

    expect(runN1.persistence.health_flag_id).toBe(runN.persistence.health_flag_id);
    expect(runN1.persistence.decision_id).not.toBe(runN.persistence.decision_id);

    const { data: flags } = await client
      .from("health_flags")
      .select("id")
      .eq("athlete_id", athlete.athleteId)
      .eq("flag_type", "concussion_suspect")
      .in("status", ["active", "monitoring"]);
    expect(flags).toHaveLength(1);

    const { data: decisions } = await client.from("decisions").select("id").eq("athlete_id", athlete.athleteId);
    expect(decisions).toHaveLength(2);
  });

  it("11. atomicity from TypeScript: a valid health flag payload + a deliberately invalid decision row leaves no trace", async () => {
    const today = "2026-08-16";

    const invalidDecisionRow = {
      athlete_id: athlete.athleteId,
      decision_date: today,
      planned_session_before: null,
      final_session: "REST",
      reason: "Atomicity test — invalid confidence_level",
      do_not_do: [],
      override_reason: null,
      engine_version: "v0.2",
      stop_conditions: null,
      daily_plan: { date: today } as unknown as DailyPlan,
      active_mode: "IN_SEASON",
      confidence_level: "VERY_HIGH", // not a valid confidence_level enum value
    } as unknown as DecisionInsertRow;

    await expect(
      persistDailyRun(
        client,
        athlete.athleteId,
        { flag_type: "illness", flag_date: today, description: "Atomicity test — would-be valid flag" },
        invalidDecisionRow
      )
    ).rejects.toThrow();

    const { data: flags } = await client
      .from("health_flags")
      .select("id")
      .eq("athlete_id", athlete.athleteId)
      .eq("flag_type", "illness");
    expect(flags).toEqual([]);

    const { data: decisions } = await client
      .from("decisions")
      .select("id")
      .eq("athlete_id", athlete.athleteId)
      .eq("reason", "Atomicity test — invalid confidence_level");
    expect(decisions).toEqual([]);
  });
});

// V0.3_008A — snapshot immutability (mandatory per the architecture decision,
// see docs/11_DECISION_LOG.md V0.3_008A). `decisions.daily_plan` already
// persists the WHOLE DailyPlan verbatim (mapDailyPlanToDecisionRow.ts,
// unchanged by this ticket) — this proves the new
// `recent_recovery_context` field rides that existing, already-immutable
// append-only mechanism correctly: no new persistence code was needed.
describe("V0.3_008A — recent_recovery_context persisted snapshot immutability (real Supabase)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "V0.3_008A snapshot immutability test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("correcting the source completed_sessions row AFTER generation does not alter the already-persisted decision's snapshot", async () => {
    const yesterday = "2026-08-23";
    const today = "2026-08-24";

    await insertCompletedSession(client, athlete.athleteId, yesterday, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, {
      completionStatus: "partial",
      changeReason: "fatigue_control",
      postLegFatigue: 7,
      postGripFatigue: 7,
    });
    await insertCheckin(client, athlete.athleteId, today);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const result = await runDailyFor(client, athlete.athleteId, today);
    expect(result.dailyPlan.recent_recovery_context).toEqual({
      session_date: yesterday,
      completion_status: "partial",
      change_reason: "fatigue_control",
      post_leg_fatigue: 7,
      post_grip_fatigue: 7,
    });

    // Athlete later corrects yesterday's completed session (e.g. 7/7 -> 4/4).
    const { error: correctionError } = await client
      .from("completed_sessions")
      .update({ post_leg_fatigue: 4, post_grip_fatigue: 4 })
      .eq("athlete_id", athlete.athleteId)
      .eq("session_date", yesterday);
    if (correctionError) throw new Error(`source correction failed: ${correctionError.message}`);

    // Re-read the ALREADY-PERSISTED decision — never regenerated.
    const { data: decisions } = await client
      .from("decisions")
      .select("daily_plan")
      .eq("id", result.persistence.decision_id)
      .single();

    const persistedPlan = decisions!.daily_plan as unknown as { recent_recovery_context?: { post_leg_fatigue: number | null; post_grip_fatigue: number | null } };
    expect(persistedPlan.recent_recovery_context?.post_leg_fatigue).toBe(7);
    expect(persistedPlan.recent_recovery_context?.post_grip_fatigue).toBe(7);

    // The live source row, by contrast, now genuinely reflects the correction.
    const { data: liveRow } = await client
      .from("completed_sessions")
      .select("post_leg_fatigue, post_grip_fatigue")
      .eq("athlete_id", athlete.athleteId)
      .eq("session_date", yesterday)
      .single();
    expect(liveRow?.post_leg_fatigue).toBe(4);
    expect(liveRow?.post_grip_fatigue).toBe(4);
  });

  it("a decision generated with no eligible D-1 context persists no recent_recovery_context key at all — legacy-shaped, no crash on reread", async () => {
    const today = "2026-08-24";
    await insertCheckin(client, athlete.athleteId, today);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const result = await runDailyFor(client, athlete.athleteId, today);
    expect(result.dailyPlan.recent_recovery_context).toBeUndefined();

    const { data: decisions } = await client
      .from("decisions")
      .select("daily_plan")
      .eq("id", result.persistence.decision_id)
      .single();
    const persistedPlan = decisions!.daily_plan as unknown as Record<string, unknown>;
    expect(persistedPlan).not.toHaveProperty("recent_recovery_context");
  });
});

// V0.3_008B — snapshot immutability (mandatory per the architecture
// decision, see docs/11_DECISION_LOG.md V0.3_008B), re-proven directly for
// the NEW nested `dh_or_technical.prior_task_reference` snapshot using the
// exact same mechanism V0.3_008A already proved for
// `recent_recovery_context` (decisions.daily_plan, existing append-only
// JSONB, unchanged by this ticket) — no new persistence code, but a
// distinct nested field deserves its own direct real-DB proof rather than
// inferring it from V0.3_008A's.
describe("V0.3_008B — prior_task_reference persisted snapshot immutability (real Supabase)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "V0.3_008B snapshot immutability test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("correcting the source completed_sessions.technical_outcome AFTER generation does not alter the already-persisted decision's prior_task_reference; a new decision afterward reflects the correction", async () => {
    const today = "2026-09-14";
    const historicalDate = "2026-09-12"; // D-2, clearly inter-day and inside the 14-day window
    const executionTask = "Choisis une section technique courte et travaille un seul point à la fois...";

    // Historical source H: valid DH-family decision + linked completed
    // session, technical_outcome = PARTIAL.
    const historicalDecisionId = await insertDecision(client, athlete.athleteId, historicalDate, {
      final_session: "DH_TECHNICAL",
      daily_plan: { dh_or_technical: { active: true, execution_task: executionTask } },
    });
    await insertCompletedSession(
      client,
      athlete.athleteId,
      historicalDate,
      "DH_TECHNICAL",
      { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      { completionStatus: "partial", decisionId: historicalDecisionId, technicalOutcome: "partial" }
    );

    // Current day D: check-in + a committed DH-family plan so the final
    // session is itself DH-family (required for prior_task_reference to be
    // surfaced at all — see the today-relevance gate).
    await insertCheckin(client, athlete.athleteId, today);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertPlannedSession(client, athlete.athleteId, today, {
      session_type: "DH_TECHNICAL",
      intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    });

    const resultB = await runDailyFor(client, athlete.athleteId, today);
    expect(resultB.dailyPlan.dh_or_technical.prior_task_reference).toEqual({
      source_decision_id: historicalDecisionId,
      session_date: historicalDate,
      kind: "DH_TECHNICAL",
      execution_task: executionTask,
      technical_outcome: "partial",
    });

    // Athlete later corrects H's technical_outcome (PARTIAL -> YES) through
    // the same direct-update path V0.3_008A's own proof already uses.
    const { error: correctionError } = await client
      .from("completed_sessions")
      .update({ technical_outcome: "yes" })
      .eq("athlete_id", athlete.athleteId)
      .eq("session_date", historicalDate);
    if (correctionError) throw new Error(`source correction failed: ${correctionError.message}`);

    // Re-read the ALREADY-PERSISTED Decision B — never regenerated.
    const { data: decisionsAfterCorrection } = await client
      .from("decisions")
      .select("daily_plan")
      .eq("id", resultB.persistence.decision_id)
      .single();
    const persistedPlanB = decisionsAfterCorrection!.daily_plan as unknown as {
      dh_or_technical: { prior_task_reference?: { technical_outcome: string } };
    };
    expect(persistedPlanB.dh_or_technical.prior_task_reference?.technical_outcome).toBe("partial");

    // A NEW decision (Decision C) generated afterward, with the exact same
    // current-day inputs, must reflect the corrected live source.
    const resultC = await runDailyFor(client, athlete.athleteId, today);
    expect(resultC.persistence.decision_id).not.toBe(resultB.persistence.decision_id);
    expect(resultC.dailyPlan.dh_or_technical.prior_task_reference?.technical_outcome).toBe("yes");
    expect(resultC.dailyPlan.dh_or_technical.prior_task_reference?.source_decision_id).toBe(historicalDecisionId);

    // Current-day arbitration/task is identical between B and C — only the
    // historical snapshot differs (display-only, no arbitration effect).
    expect(resultC.dailyPlan.decision).toBe(resultB.dailyPlan.decision);
    expect(resultC.dailyPlan.final_session).toEqual(resultB.dailyPlan.final_session);
    expect(resultC.dailyPlan.dh_or_technical.execution_task).toEqual(resultB.dailyPlan.dh_or_technical.execution_task);

    // The live source row, by contrast, now genuinely reflects the correction.
    const { data: liveRow } = await client
      .from("completed_sessions")
      .select("technical_outcome")
      .eq("athlete_id", athlete.athleteId)
      .eq("session_date", historicalDate)
      .single();
    expect(liveRow?.technical_outcome).toBe("yes");
  });

  it("a decision generated with no DH-family final session persists no prior_task_reference even when a valid historical fact exists — legacy-shaped, no crash on reread", async () => {
    const today = "2026-09-14";
    const historicalDate = "2026-09-12";
    const historicalDecisionId = await insertDecision(client, athlete.athleteId, historicalDate, {
      final_session: "DH_TECHNICAL",
      daily_plan: { dh_or_technical: { active: true, execution_task: "Tâche historique." } },
    });
    await insertCompletedSession(
      client,
      athlete.athleteId,
      historicalDate,
      "DH_TECHNICAL",
      { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      { completionStatus: "partial", decisionId: historicalDecisionId, technicalOutcome: "yes" }
    );

    await insertCheckin(client, athlete.athleteId, today);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    // No planned session -> inference fallback, not guaranteed DH-family;
    // REST is the simplest deterministic non-DH case.
    await insertPlannedSession(client, athlete.athleteId, today, { session_type: "REST" });

    const result = await runDailyFor(client, athlete.athleteId, today);
    expect(result.dailyPlan.dh_or_technical.active).toBe(false);
    expect(result.dailyPlan.dh_or_technical).not.toHaveProperty("prior_task_reference");

    const { data: decisions } = await client
      .from("decisions")
      .select("daily_plan")
      .eq("id", result.persistence.decision_id)
      .single();
    const persistedPlan = decisions!.daily_plan as unknown as { dh_or_technical: Record<string, unknown> };
    expect(persistedPlan.dh_or_technical).not.toHaveProperty("prior_task_reference");
  });
});
