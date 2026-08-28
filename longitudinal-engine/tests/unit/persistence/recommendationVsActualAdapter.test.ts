/**
 * persistRecommendationVsActualEvidence adapter — pure unit tests. No
 * Docker/Supabase connection: a stub client captures/controls the single
 * `rpc()` call the adapter is allowed to make per detection. V0.3_001A:
 * this adapter is now lifecycle-aware (evidence -> persist_active_pattern_evidence,
 * no_evidence -> transition_pattern_evidence_lifecycle) — mirrors
 * painPersistenceAdapter.test.ts's own structure exactly.
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
  evidenceKey: "decision:d1",
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
  evidenceKey: "decision:d1",
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

describe("persistRecommendationVsActualEvidence — evidence path", () => {
  it("calls persist_active_pattern_evidence with the exact provenance: evaluation_decision then linked_completed_session", async () => {
    const { client, calls } = stubClient(async () => ({
      data: {
        identity_id: "i1",
        revision_id: "r1",
        revision_number: 1,
        evidence_action: "inserted",
        lifecycle_action: "unchanged",
        lifecycle_transition_id: null,
        lifecycle_transition_number: null,
      },
      error: null,
    }));

    await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("persist_active_pattern_evidence");
    const args = calls[0]!.args as { p_evaluation_key: string; p_evidence_key: string; p_provenance: Array<Record<string, unknown>> };
    expect(args.p_evaluation_key).toBe("decision:d1");
    expect(args.p_evidence_key).toBe("decision:d1");
    expect(args.p_provenance).toEqual([
      { role: "evaluation_decision", source_kind: "decision", source_id: "d1" },
      { role: "linked_completed_session", source_kind: "completed_session", source_id: "s1" },
    ]);
    expect(args.p_provenance).toHaveLength(2);
  });

  it("maps the composite RPC response exactly", async () => {
    const { client } = stubClient(async () => ({
      data: {
        identity_id: "i1",
        revision_id: "r1",
        revision_number: 2,
        evidence_action: "superseded",
        lifecycle_action: "transitioned",
        lifecycle_transition_id: "t2",
        lifecycle_transition_number: 2,
      },
      error: null,
    }));

    const result = await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

    expect(result).toEqual({
      kind: "evidence",
      identityId: "i1",
      revisionId: "r1",
      revisionNumber: 2,
      evidenceAction: "superseded",
      lifecycleAction: "transitioned",
      lifecycleTransitionId: "t2",
      lifecycleTransitionNumber: 2,
    });
  });

  it("propagates the exact RPC error object unwrapped", async () => {
    const rpcError = { code: "42501", message: "permission denied", details: null, hint: null };
    const { client, calls } = stubClient(async () => ({ data: null, error: rpcError }));

    await expect(persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE })).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1);
  });
});

describe("persistRecommendationVsActualEvidence — no_evidence path", () => {
  it("calls transition_pattern_evidence_lifecycle with target=withdrawn, reason_code=detection.reason, and context={}", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "transitioned" },
      error: null,
    }));

    await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("transition_pattern_evidence_lifecycle");
    expect(calls[0]!.args).toEqual({
      p_athlete_id: "athlete-1",
      p_detector_rule_id: "recommendation_vs_actual_execution",
      p_detector_rule_version: "1.0.0",
      p_evidence_key: "decision:d1",
      p_target_state: "withdrawn",
      p_reason_code: "no_completed_session",
      p_context: {},
    });
  });

  it("never calls persist_active_pattern_evidence for a no_evidence detection", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
      error: null,
    }));
    await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(calls.every((c) => c.fn === "transition_pattern_evidence_lifecycle")).toBe(true);
  });

  it("maps action=transitioned -> withdrawn", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "transitioned" },
      error: null,
    }));
    const result = await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(result).toEqual({ kind: "no_evidence", action: "withdrawn", identityId: "i2", transitionId: "t1", transitionNumber: 1 });
  });

  it("maps action=unchanged -> unchanged_withdrawal", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "unchanged" },
      error: null,
    }));
    const result = await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(result.kind).toBe("no_evidence");
    expect((result as { action: string }).action).toBe("unchanged_withdrawal");
  });

  it("maps action=skipped_no_prior -> skipped_no_evidence_no_prior, all-null fields preserved", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
      error: null,
    }));
    const result = await persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(result).toEqual({ kind: "no_evidence", action: "skipped_no_evidence_no_prior", identityId: null, transitionId: null, transitionNumber: null });
  });

  it("propagates the exact RPC error object unwrapped", async () => {
    const rpcError = { code: "P0001", message: "some structural error", details: null, hint: null };
    const { client, calls } = stubClient(async () => ({ data: null, error: rpcError }));

    await expect(persistRecommendationVsActualEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE })).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1);
  });
});
