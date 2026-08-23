/**
 * calculateAndPersistOutcomes integration suite — runs against a real local
 * Supabase stack (`npx supabase start` + `npx supabase db reset`). See
 * testDb.ts for the required SUPABASE_SECRET_KEY env var.
 *
 * This suite deliberately does not re-derive persist_decision_outcome's own
 * RLS/GRANT contract (see supabase/preflight/decision_outcomes_append_only_
 * security_check.sql, and M5_001B's own migration — both already prove
 * that contract). It proves the M5_004 orchestration layer built on top of
 * it: maturity pre-filtering, the timeline-driven existing-outcome
 * short-circuit, and correct RPC payload keys — plus one direct,
 * non-duplicative proof that the frozen RPC still rejects a cross-athlete
 * decision_id when called with M5_004's exact payload shape.
 *
 * Every test gets its own scratch athlete (afterEach cleanup) rather than
 * sharing one across the file: calculateAndPersistOutcomes's returned
 * counters aggregate over the *entire* supplied timeline, so a shared
 * athlete accumulating decisions across `it()` blocks would silently
 * pollute every later test's aggregate assertions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseLongitudinalSourceAdapter } from "../../src/supabase/adapter.js";
import { buildTimeline } from "../../src/timeline/buildTimeline.js";
import type { AthleteTimeline } from "../../src/timeline/types.js";
import type { DateRange } from "../../src/types/index.js";
import { calculateAndPersistOutcomes } from "../../src/supabase/outcomeOrchestrator.js";
import { CALCULATOR_ID, CALCULATOR_VERSION } from "../../src/calculators/index.js";
import {
  countRowsForAthlete,
  createTestAthlete,
  createTestClient,
  deleteTestAthlete,
  insertDecision,
  insertDecisionOutcome,
  type TestAthlete,
} from "./testDb.js";

const RANGE: DateRange = { fromDate: "2026-08-01", toDate: "2026-08-20" };
const DECISION_DATE = "2026-08-10";
const J1 = "2026-08-11";
const J3 = "2026-08-13";
const J7 = "2026-08-17";

describe("calculateAndPersistOutcomes — integration", () => {
  let client: SupabaseClient;
  let adapter: SupabaseLongitudinalSourceAdapter;
  let athleteA: TestAthlete;
  let athleteB: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    adapter = new SupabaseLongitudinalSourceAdapter(client);
    athleteA = await createTestAthlete(client, "Outcome Orchestrator Test Athlete A");
    athleteB = await createTestAthlete(client, "Outcome Orchestrator Test Athlete B");
  }, 30_000);

  afterEach(async () => {
    await deleteTestAthlete(client, athleteA);
    await deleteTestAthlete(client, athleteB);
  }, 30_000);

  async function loadTimeline(athleteId: string): Promise<AthleteTimeline> {
    const [checkins, decisions, completedSessions, outcomes, healthFlags] = await Promise.all([
      adapter.getDailyCheckins(athleteId, RANGE),
      adapter.getDecisions(athleteId, RANGE),
      adapter.getCompletedSessions(athleteId, RANGE),
      adapter.getDecisionOutcomes(athleteId, RANGE),
      adapter.getHealthFlags(athleteId, RANGE),
    ]);
    return buildTimeline({ athleteId, range: RANGE, sources: { checkins, decisions, completedSessions, outcomes, healthFlags } });
  }

  it("no mature horizon -> zero RPC writes", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, DECISION_DATE);
    const timeline = await loadTimeline(athleteA.athleteId);

    const result = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline, observedThroughDate: DECISION_DATE });

    expect(result.skippedImmature).toBe(3);
    expect(result.attempted).toBe(0);
    expect(result.writeSucceeded).toBe(0);

    const { data, error } = await client.from("decision_outcomes").select("id").eq("decision_id", decisionId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("J+1 mature -> exactly one outcome persisted with the correct key columns", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, DECISION_DATE);
    const timeline = await loadTimeline(athleteA.athleteId);

    const result = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline, observedThroughDate: J1 });

    expect(result.attempted).toBe(1);
    expect(result.writeSucceeded).toBe(1);
    expect(result.skippedImmature).toBe(2);
    expect(result.errors).toEqual([]);

    const { data, error } = await client
      .from("decision_outcomes")
      .select("horizon, calculator_id, calculator_version")
      .eq("decision_id", decisionId);
    expect(error).toBeNull();
    expect(data).toEqual([{ horizon: "J_PLUS_1", calculator_id: CALCULATOR_ID, calculator_version: CALCULATOR_VERSION }]);
  });

  it("J+1 and J+3 mature -> two outcomes with the correct horizons", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, DECISION_DATE);
    const timeline = await loadTimeline(athleteA.athleteId);

    const result = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline, observedThroughDate: J3 });

    expect(result.attempted).toBe(2);
    expect(result.writeSucceeded).toBe(2);
    expect(result.skippedImmature).toBe(1);

    const { data } = await client.from("decision_outcomes").select("horizon").eq("decision_id", decisionId);
    expect((data ?? []).map((r) => r.horizon).sort()).toEqual(["J_PLUS_1", "J_PLUS_3"]);
  });

  it("J+1/J+3/J+7 mature -> three outcomes", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, DECISION_DATE);
    const timeline = await loadTimeline(athleteA.athleteId);

    const result = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline, observedThroughDate: J7 });

    expect(result.attempted).toBe(3);
    expect(result.writeSucceeded).toBe(3);
    expect(result.skippedImmature).toBe(0);

    const { data } = await client.from("decision_outcomes").select("horizon").eq("decision_id", decisionId);
    expect((data ?? []).map((r) => r.horizon).sort()).toEqual(["J_PLUS_1", "J_PLUS_3", "J_PLUS_7"]);
  });

  it("a matching outcome already present in the loaded timeline is short-circuited — no redundant RPC write", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, DECISION_DATE);
    // Seed the outcome directly, as if a prior orchestration run already persisted it.
    await insertDecisionOutcome(client, athleteA.athleteId, decisionId, { seeded: true }, { seeded: true }, {
      horizon: "J_PLUS_1",
      calculator_id: CALCULATOR_ID,
      calculator_version: CALCULATOR_VERSION,
    });
    const timeline = await loadTimeline(athleteA.athleteId);

    const result = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline, observedThroughDate: J7 });

    expect(result.alreadyExisted).toBe(1); // J+1 only — J+3/J+7 are genuinely new for this decision
    expect(result.attempted).toBe(2);
    expect(result.writeSucceeded).toBe(2);

    const { data } = await client
      .from("decision_outcomes")
      .select("horizon, input_snapshot")
      .eq("decision_id", decisionId)
      .eq("horizon", "J_PLUS_1");
    expect(data).toHaveLength(1);
    expect(data?.[0]?.input_snapshot).toEqual({ seeded: true }); // untouched by this run — proves no overwrite/recompute
  });

  it("re-running the orchestrator a second time is idempotent at the orchestration level — no duplicate rows", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, DECISION_DATE);

    const firstTimeline = await loadTimeline(athleteA.athleteId);
    const first = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline: firstTimeline, observedThroughDate: J1 });
    expect(first.writeSucceeded).toBe(1);

    const secondTimeline = await loadTimeline(athleteA.athleteId);
    const second = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline: secondTimeline, observedThroughDate: J1 });
    expect(second.writeSucceeded).toBe(0);
    expect(second.alreadyExisted).toBe(1);

    const { data } = await client.from("decision_outcomes").select("id").eq("decision_id", decisionId);
    expect(data).toHaveLength(1);
  });

  it("duplicate matching outcomes in a synthetic timeline fail loud, with no RPC attempted for that key", async () => {
    // Structurally impossible via real inserts (the DB's own UNIQUE(athlete_id, decision_id, horizon,
    // calculator_id, calculator_version) constraint forbids it) — hand-built to exercise the
    // orchestrator's own defensive check against a malformed caller-supplied timeline.
    const decisionId = await insertDecision(client, athleteA.athleteId, DECISION_DATE);
    const timeline = await loadTimeline(athleteA.athleteId);
    const thread = timeline.decisionThreads.find((t) => t.decision.id === decisionId)!;
    const duplicateOutcome = {
      id: "dup-1",
      athleteId: athleteA.athleteId,
      decisionId,
      horizon: "J_PLUS_1" as const,
      calculatorId: CALCULATOR_ID,
      calculatorVersion: CALCULATOR_VERSION,
      inputSnapshot: {},
      outcomeSignals: {},
      calculatedAt: "2026-08-11T00:00:00.000Z",
      createdAt: "2026-08-11T00:00:00.000Z",
    };
    const malformed: AthleteTimeline = {
      ...timeline,
      decisionThreads: timeline.decisionThreads.map((t) =>
        t.decision.id === decisionId
          ? {
              ...t,
              outcomesByHorizon: {
                ...thread.outcomesByHorizon,
                J_PLUS_1: [duplicateOutcome, { ...duplicateOutcome, id: "dup-2" }],
              },
            }
          : t
      ),
    };

    const result = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline: malformed, observedThroughDate: J7 });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.horizon).toBe("J_PLUS_1");
    expect(result.errors[0]?.error).toMatch(/DuplicatePersistedOutcomeError/);
    // J+3/J+7 for the same decision still proceed normally — one bad key does not abort the batch.
    expect(result.writeSucceeded).toBe(2);

    const { data } = await client.from("decision_outcomes").select("horizon").eq("decision_id", decisionId).eq("horizon", "J_PLUS_1");
    expect(data).toEqual([]); // no write was attempted for the duplicate key
  });

  it("frozen RPC still rejects a cross-athlete decision_id, even with M5_004's exact payload shape", async () => {
    const decisionIdOfA = await insertDecision(client, athleteA.athleteId, DECISION_DATE);

    const { error } = await client.rpc("persist_decision_outcome", {
      p_athlete_id: athleteB.athleteId, // wrong athlete for this decision
      p_row: {
        decision_id: decisionIdOfA,
        horizon: "J_PLUS_1",
        calculator_id: CALCULATOR_ID,
        calculator_version: CALCULATOR_VERSION,
        input_snapshot: { probe: true },
        outcome_signals: { probe: true },
      },
    });

    expect(error).not.toBeNull();
    const { data } = await client
      .from("decision_outcomes")
      .select("id")
      .eq("decision_id", decisionIdOfA)
      .eq("athlete_id", athleteB.athleteId);
    expect(data).toEqual([]);
  });

  it("athlete isolation: orchestrating athlete B's timeline never writes against athlete A's decisions", async () => {
    const decisionIdA = await insertDecision(client, athleteA.athleteId, DECISION_DATE);
    await insertDecision(client, athleteB.athleteId, DECISION_DATE);
    const timelineB = await loadTimeline(athleteB.athleteId);

    expect(timelineB.decisionThreads.some((t) => t.decision.id === decisionIdA)).toBe(false);

    const result = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline: timelineB, observedThroughDate: J1 });
    expect(result.writeSucceeded).toBe(1);

    const countsA = await countRowsForAthlete(client, athleteA.athleteId);
    expect(countsA.decision_outcomes).toBe(0);
    const countsB = await countRowsForAthlete(client, athleteB.athleteId);
    expect(countsB.decision_outcomes).toBe(1);
  });
});
