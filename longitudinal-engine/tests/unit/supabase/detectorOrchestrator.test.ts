/**
 * Docker-independent proof of runDetectors' own orchestration mechanics
 * (evaluation-unit derivation, ordering, per-item failure isolation) — a
 * stub Supabase admin client (never a real connection) whose `rpc` is
 * fully controlled is enough; no Docker/local Supabase stack is needed.
 * Exact detector classification semantics are already covered by each
 * detector's own unit test suite — this file focuses on ORCHESTRATION,
 * mirroring outcomeOrchestrator.validation.test.ts's own Docker-free style.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import { runDetectors } from "../../../src/supabase/detectorOrchestrator.js";
import { RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, SLEEP_ENERGY_RULE_ID, PAIN_PERSISTENCE_RULE_ID } from "../../../src/detectors/index.js";
import { ATHLETE_A, checkin, decision, emptySources, resetIdSequence } from "../timeline/fixtures.js";

beforeEach(() => resetIdSequence());

function stubAdmin(rpcImpl: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }): { client: SupabaseClient; calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return rpcImpl(fn, args);
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

/** Generic "no prior identity" response — valid for both transition_pattern_evidence_lifecycle (no_evidence path) and would never be hit for persist_active_pattern_evidence (evidence path) in these no-evidence-only fixtures. */
const SKIPPED_NO_PRIOR_RESPONSE = { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" };

describe("runDetectors — orchestration mechanics", () => {
  it("attempts exactly 1 recommendation unit per decision thread + 2 units (sleep-energy, pain-persistence) per single-checkin day", () => {
    const d = decision({ decisionDate: "2026-08-10" }); // no linked completed session -> no_evidence
    const c = checkin({ checkinDate: "2026-08-10" });
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-05-01", toDate: "2026-08-10" },
      sources: { ...emptySources(), decisions: [d], checkins: [c] },
    });

    const { client } = stubAdmin(() => ({ data: SKIPPED_NO_PRIOR_RESPONSE, error: null }));

    return runDetectors({ supabaseAdmin: client, timeline }).then((result) => {
      // 1 decision thread (recommendation) + 1 day with exactly 1 checkin (sleep-energy + pain-persistence) = 3.
      expect(result.attempted).toBe(3);
      expect(result.results).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
    });
  });

  it("evaluation units and detectorRuleId are exactly what the timeline shape implies", async () => {
    const d = decision({ id: "d1", decisionDate: "2026-08-10" });
    const c = checkin({ id: "c1", checkinDate: "2026-08-10" });
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-05-01", toDate: "2026-08-10" },
      sources: { ...emptySources(), decisions: [d], checkins: [c] },
    });

    const { client } = stubAdmin(() => ({ data: SKIPPED_NO_PRIOR_RESPONSE, error: null }));
    const result = await runDetectors({ supabaseAdmin: client, timeline });

    const byDetector = Object.fromEntries(result.results.map((r) => [r.detectorRuleId, r.evaluationUnitId]));
    expect(byDetector[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]).toBe("d1");
    expect(byDetector[SLEEP_ENERGY_RULE_ID]).toBe("c1");
    expect(byDetector[PAIN_PERSISTENCE_RULE_ID]).toBe("c1");
  });

  it("days with zero checkins are skipped entirely — no evaluation unit attempted for them", async () => {
    const d = decision({ decisionDate: "2026-08-10" });
    // No checkins at all in the sources.
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-05-01", toDate: "2026-08-12" },
      sources: { ...emptySources(), decisions: [d] },
    });

    const { client } = stubAdmin(() => ({ data: SKIPPED_NO_PRIOR_RESPONSE, error: null }));
    const result = await runDetectors({ supabaseAdmin: client, timeline });

    // Only the 1 decision thread — zero checkin-based units across all 3 days in range.
    expect(result.attempted).toBe(1);
    expect(result.results.every((r) => r.detectorRuleId === RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID)).toBe(true);
  });

  it("deterministic ordering: decision-thread units first (in timeline order), then per-day units (sleep-energy before pain-persistence, in day order)", async () => {
    const d1 = decision({ id: "d1", decisionDate: "2026-08-10" });
    const d2 = decision({ id: "d2", decisionDate: "2026-08-11" });
    const c1 = checkin({ id: "c1", checkinDate: "2026-08-10" });
    const c2 = checkin({ id: "c2", checkinDate: "2026-08-11" });
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-05-01", toDate: "2026-08-11" },
      sources: { ...emptySources(), decisions: [d1, d2], checkins: [c1, c2] },
    });

    const { client } = stubAdmin(() => ({ data: SKIPPED_NO_PRIOR_RESPONSE, error: null }));
    const result = await runDetectors({ supabaseAdmin: client, timeline });

    expect(result.results.map((r) => `${r.detectorRuleId}:${r.evaluationUnitId}`)).toEqual([
      `${RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID}:d1`,
      `${RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID}:d2`,
      `${SLEEP_ENERGY_RULE_ID}:c1`,
      `${PAIN_PERSISTENCE_RULE_ID}:c1`,
      `${SLEEP_ENERGY_RULE_ID}:c2`,
      `${PAIN_PERSISTENCE_RULE_ID}:c2`,
    ]);
  });

  it("a persistence failure for ONE evaluation unit does not abort unrelated units — errors captured, never silently swallowed", async () => {
    const d1 = decision({ id: "d1", decisionDate: "2026-08-10" });
    const d2 = decision({ id: "d2", decisionDate: "2026-08-11" });
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-05-01", toDate: "2026-08-11" },
      sources: { ...emptySources(), decisions: [d1, d2] },
    });

    const { client } = stubAdmin((_fn, args) => {
      if (args.p_athlete_id !== undefined && args.p_evidence_key === "decision:d1") {
        throw new Error("sentinel structural failure for d1 only");
      }
      return { data: SKIPPED_NO_PRIOR_RESPONSE, error: null };
    });

    const result = await runDetectors({ supabaseAdmin: client, timeline });

    expect(result.attempted).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.evaluationUnitId).toBe("d1");
    expect(result.errors[0]!.error).toMatch(/sentinel structural failure/);
    // The OTHER decision's unit still succeeded despite d1's failure.
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.evaluationUnitId).toBe("d2");
  });

  it("empty timeline (zero decision threads, zero days with checkins) -> zero attempts, zero results, zero errors", async () => {
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-05-01", toDate: "2026-08-10" },
      sources: emptySources(),
    });

    const { client, calls } = stubAdmin(() => {
      throw new Error("rpc must never be called for an empty timeline");
    });

    const result = await runDetectors({ supabaseAdmin: client, timeline });

    expect(result).toEqual({ attempted: 0, results: [], errors: [] });
    expect(calls).toHaveLength(0);
  });
});
