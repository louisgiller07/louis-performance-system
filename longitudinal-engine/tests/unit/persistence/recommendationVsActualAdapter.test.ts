/**
 * persistRecommendationVsActualEvidence adapter — pure unit tests. No
 * Docker/Supabase connection: a stub client captures/controls the single
 * `rpc()` call the adapter is allowed to make.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistRecommendationVsActualEvidence } from "../../../src/persistence/index.js";
import type { RecommendationVsActualEvidence, RecommendationVsActualNoEvidence } from "../../../src/detectors/index.js";

const EVIDENCE: RecommendationVsActualEvidence = {
  kind: "evidence",
  detectorRuleId: "recommendation_vs_actual_execution",
  detectorRuleVersion: "1.0.0",
  evaluationKey: "decision:d1",
  evidenceKey: "decision:d1:completion:s1",
  eventType: "supporting",
  eventDate: "2026-08-10",
  observedValue: {
    decisionId: "d1",
    decisionDate: "2026-08-10",
    recommendedSessionType: "STRENGTH_A",
    executionState: "explicit",
    completedSessionId: "s1",
    completionStatus: "done",
    actualSessionType: "STRENGTH_A",
    typeMatchesRecommendation: true,
  },
  sourceRefs: { decisionId: "d1", completedSessionId: "s1" },
};

const NO_EVIDENCE: RecommendationVsActualNoEvidence = {
  kind: "no_evidence",
  detectorRuleId: "recommendation_vs_actual_execution",
  detectorRuleVersion: "1.0.0",
  evaluationKey: "decision:d1",
  eventDate: "2026-08-10",
  reason: "no_completed_session",
};

function stubClient(rpcImpl: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>): { client: SupabaseClient; calls: Array<{ fn: string; args: unknown }> } {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return rpcImpl(fn, args);
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("persistRecommendationVsActualEvidence", () => {
  it("maps evidence to the exact persist_pattern_evidence RPC payload", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: "i1", revision_id: "r1", revision_number: 1, action: "inserted" },
      error: null,
    }));

    await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("persist_pattern_evidence");
    expect(calls[0]!.args).toEqual({
      p_athlete_id: "athlete-1",
      p_detector_rule_id: "recommendation_vs_actual_execution",
      p_detector_rule_version: "1.0.0",
      p_evaluation_key: "decision:d1",
      p_evidence_key: "decision:d1:completion:s1",
      p_event_type: "supporting",
      p_event_date: "2026-08-10",
      p_observed_value: EVIDENCE.observedValue,
      p_provenance: [
        { role: "evaluation_decision", source_kind: "decision", source_id: "d1" },
        { role: "linked_completed_session", source_kind: "completed_session", source_id: "s1" },
      ],
    });
  });

  it("provenance is exactly two entries, no extra fields on each entry", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: "i1", revision_id: "r1", revision_number: 1, action: "inserted" },
      error: null,
    }));

    await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

    const args = calls[0]!.args as { p_provenance: Array<Record<string, unknown>> };
    expect(args.p_provenance).toHaveLength(2);
    for (const entry of args.p_provenance) {
      expect(Object.keys(entry).sort()).toEqual(["role", "source_id", "source_kind"]);
    }
  });

  it("no_evidence -> skipped_no_evidence, zero RPC calls", async () => {
    const { client, calls } = stubClient(async () => {
      throw new Error("rpc must never be called for no_evidence");
    });

    const result = await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });

    expect(result).toEqual({ action: "skipped_no_evidence" });
    expect(calls).toHaveLength(0);
  });

  it("maps a successful RPC response exactly (inserted/superseded/unchanged, ids, revision_number)", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: "identity-abc", revision_id: "revision-xyz", revision_number: 3, action: "superseded" },
      error: null,
    }));

    const result = await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

    expect(result).toEqual({
      action: "superseded",
      identityId: "identity-abc",
      revisionId: "revision-xyz",
      revisionNumber: 3,
    });
  });

  it("propagates the exact RPC error object unwrapped — identity, not just message equality", async () => {
    // A genuinely distinct object identity (not merely "an object with the same shape") — asserting
    // .toBe() below proves the adapter rethrows this EXACT reference, never a copy/rewrap/new Error.
    const rpcError = { code: "42501", message: "permission denied", details: null, hint: null };
    const { client, calls } = stubClient(async () => ({ data: null, error: rpcError }));

    await expect(persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE })).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1); // called exactly once for evidence, even though it failed
  });
});
