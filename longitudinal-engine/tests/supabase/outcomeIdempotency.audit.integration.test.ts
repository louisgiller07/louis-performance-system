/**
 * V0.3_001B — idempotency contract audit (local-only, NOT committed).
 * Directly proves, against the real local DB, the exact mechanism traced
 * from `outcomeOrchestrator.ts` + `persist_decision_outcome`'s own
 * migration: a second `calculateAndPersistOutcomes` pass over an
 * already-persisted set of outcomes short-circuits via
 * `thread.outcomesByHorizon[horizon]` (data already loaded into the fresh
 * timeline) BEFORE ever calling the RPC — so the second pass produces
 * `alreadyExisted = N`, `writeSucceeded = 0`, `attempted = 0`, and the RPC's
 * own "identical snapshot -> return existing id, no write" branch is never
 * even reached. This is not proven by any existing test in this package.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleAthleteTimeline } from "../../src/supabase/assembleAthleteTimeline.js";
import { calculateAndPersistOutcomes } from "../../src/supabase/outcomeOrchestrator.js";
import { currentLongitudinalProcessingDate } from "../../src/timeline/index.js";
import { createTestAthlete, createTestClient, insertDecision, type TestAthlete } from "./testDb.js";

async function countOutcomes(client: SupabaseClient, athleteId: string): Promise<number> {
  const { count, error } = await client.from("decision_outcomes").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId);
  if (error) throw new Error(`countOutcomes failed: ${error.message}`);
  return count ?? 0;
}

async function readOutcomeSnapshot(client: SupabaseClient, athleteId: string): Promise<Array<{ id: string; decision_id: string; horizon: string; calculated_at: string }>> {
  const { data, error } = await client
    .from("decision_outcomes")
    .select("id, decision_id, horizon, calculated_at")
    .eq("athlete_id", athleteId)
    .order("decision_id", { ascending: true })
    .order("horizon", { ascending: true });
  if (error) throw new Error(`readOutcomeSnapshot failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string; decision_id: string; horizon: string; calculated_at: string }>;
}

async function countDuplicateGroups(client: SupabaseClient, athleteId: string): Promise<number> {
  const rows = await readOutcomeSnapshot(client, athleteId);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const r of rows) {
    const key = `${r.decision_id}:${r.horizon}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return duplicates;
}

describe("V0.3_001B — outcome persistence idempotency (real local DB, direct proof)", () => {
  let client: SupabaseClient;

  beforeAll(async () => {
    client = createTestClient();
  }, 60_000);

  it("second calculateAndPersistOutcomes pass over an already-persisted set: attempted=0, writeSucceeded=0, alreadyExisted=N, zero row delta, zero duplicate groups, existing rows byte-identical", async () => {
    const athlete: TestAthlete = await createTestAthlete(client, "V0.3_001B Outcome Idempotency Audit");
    const processingDate = currentLongitudinalProcessingDate();

    // 2 decisions, well before processingDate so all 3 horizons are mature -> 6 expected outcome rows.
    const decisionDates = ["2026-01-05", "2026-01-06"];
    for (const d of decisionDates) {
      await insertDecision(client, athlete.athleteId, d, { final_session: "STRENGTH_A" });
    }
    const expectedRowCount = decisionDates.length * 3; // 3 horizons each

    // --- FIRST run: real writes ---
    const timelineFirst = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    const firstResult = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline: timelineFirst, observedThroughDate: processingDate });

    expect(firstResult.attempted).toBe(expectedRowCount);
    expect(firstResult.writeSucceeded).toBe(expectedRowCount);
    expect(firstResult.alreadyExisted).toBe(0);
    expect(firstResult.skippedImmature).toBe(0);
    expect(firstResult.errors).toEqual([]);

    const rowCountAfterFirst = await countOutcomes(client, athlete.athleteId);
    expect(rowCountAfterFirst).toBe(expectedRowCount);
    const snapshotAfterFirst = await readOutcomeSnapshot(client, athlete.athleteId);
    expect(snapshotAfterFirst).toHaveLength(expectedRowCount);

    // --- SECOND run: fresh timeline (re-fetched from real DB), same processingDate ---
    const timelineSecond = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    const secondResult = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline: timelineSecond, observedThroughDate: processingDate });

    // The grounded prediction: the orchestrator's own pre-check
    // (thread.outcomesByHorizon[horizon], already loaded from the fresh
    // timeline) short-circuits BEFORE any RPC call — attempted/writeSucceeded
    // are 0, not "writeSucceeded again via RPC idempotence".
    expect(secondResult.attempted).toBe(0);
    expect(secondResult.writeSucceeded).toBe(0);
    expect(secondResult.alreadyExisted).toBe(expectedRowCount);
    expect(secondResult.skippedImmature).toBe(0);
    expect(secondResult.errors).toEqual([]);

    const rowCountAfterSecond = await countOutcomes(client, athlete.athleteId);
    expect(rowCountAfterSecond).toBe(rowCountAfterFirst); // zero delta

    const duplicateGroups = await countDuplicateGroups(client, athlete.athleteId);
    expect(duplicateGroups).toBe(0);

    // Existing rows byte-identical (same id, same calculated_at) — proves no UPDATE occurred anywhere.
    const snapshotAfterSecond = await readOutcomeSnapshot(client, athlete.athleteId);
    expect(snapshotAfterSecond).toEqual(snapshotAfterFirst);
  }, 60_000);

  it("conflicting-snapshot direct RPC call: same identity key, different input_snapshot -> exception, existing row untouched (real DB, direct RPC invocation)", async () => {
    const athlete: TestAthlete = await createTestAthlete(client, "V0.3_001B Outcome Conflict Audit");
    const decisionId = await insertDecision(client, athlete.athleteId, "2026-01-05", { final_session: "STRENGTH_A" });

    const basePayload = {
      decision_id: decisionId,
      horizon: "J_PLUS_1",
      calculator_id: "audit_test_calculator",
      calculator_version: "1.0.0",
      input_snapshot: { marker: "original" },
      outcome_signals: { marker: "original" },
    };

    const { data: first, error: firstError } = await client.rpc("persist_decision_outcome", { p_athlete_id: athlete.athleteId, p_row: basePayload });
    expect(firstError).toBeNull();
    const originalId = (first as { decision_outcome_id: string }).decision_outcome_id;

    // Same identity key (decision_id, horizon, calculator_id, calculator_version), DIFFERENT input_snapshot.
    const conflictingPayload = { ...basePayload, input_snapshot: { marker: "CONFLICTING_DIFFERENT_VALUE" } };
    const { data: conflictData, error: conflictError } = await client.rpc("persist_decision_outcome", { p_athlete_id: athlete.athleteId, p_row: conflictingPayload });

    expect(conflictData).toBeNull();
    expect(conflictError).not.toBeNull();
    expect(conflictError!.message).toMatch(/immutable/i);

    // The original row is untouched — same id, same content — never overwritten.
    const { data: rowAfterConflict, error: readError } = await client
      .from("decision_outcomes")
      .select("id, input_snapshot, outcome_signals")
      .eq("id", originalId)
      .single();
    expect(readError).toBeNull();
    expect(rowAfterConflict!.id).toBe(originalId);
    expect(rowAfterConflict!.input_snapshot).toEqual({ marker: "original" });

    // Exact identical replay (same snapshot content) DOES succeed idempotently, returning the same id, no new row.
    const { data: replay, error: replayError } = await client.rpc("persist_decision_outcome", { p_athlete_id: athlete.athleteId, p_row: basePayload });
    expect(replayError).toBeNull();
    expect((replay as { decision_outcome_id: string }).decision_outcome_id).toBe(originalId);

    const { count } = await client.from("decision_outcomes").select("id", { count: "exact", head: true }).eq("athlete_id", athlete.athleteId);
    expect(count).toBe(1); // still exactly one row — neither the conflict nor the identical replay created a second row
  }, 60_000);
});
