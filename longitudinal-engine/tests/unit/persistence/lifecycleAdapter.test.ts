/**
 * transitionPatternEvidenceLifecycle / persistActivePatternEvidence adapter
 * — pure unit tests. No Docker/Supabase connection: a stub client
 * captures/controls the single `rpc()` call each adapter is allowed to
 * make. Mirrors recommendationVsActualAdapter.test.ts's own conventions.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistActivePatternEvidence, transitionPatternEvidenceLifecycle } from "../../../src/persistence/index.js";

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

describe("transitionPatternEvidenceLifecycle", () => {
  it("maps params to the exact transition_pattern_evidence_lifecycle RPC payload", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: "i1", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "transitioned" },
      error: null,
    }));

    await transitionPatternEvidenceLifecycle(client, {
      athleteId: "athlete-1",
      detectorRuleId: "some_detector",
      detectorRuleVersion: "1.0.0",
      evidenceKey: "checkin:c1:sleep-energy",
      targetState: "withdrawn",
      reasonCode: "insufficient_baseline_data",
      context: { evaluation_checkin_id: "c1", evaluation_date: "2026-08-10" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("transition_pattern_evidence_lifecycle");
    expect(calls[0]!.args).toEqual({
      p_athlete_id: "athlete-1",
      p_detector_rule_id: "some_detector",
      p_detector_rule_version: "1.0.0",
      p_evidence_key: "checkin:c1:sleep-energy",
      p_target_state: "withdrawn",
      p_reason_code: "insufficient_baseline_data",
      p_context: { evaluation_checkin_id: "c1", evaluation_date: "2026-08-10" },
    });
  });

  it("maps a successful response exactly, including all-null skipped_no_prior fields", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
      error: null,
    }));

    const result = await transitionPatternEvidenceLifecycle(client, {
      athleteId: "athlete-1",
      detectorRuleId: "d",
      detectorRuleVersion: "1.0.0",
      evidenceKey: "k",
      targetState: "withdrawn",
      reasonCode: "r",
      context: {},
    });

    expect(result).toEqual({
      identityId: null,
      transitionId: null,
      transitionNumber: null,
      state: null,
      action: "skipped_no_prior",
    });
  });

  it("propagates the exact RPC error object unwrapped", async () => {
    const rpcError = { code: "P0001", message: "pattern_evidence_lifecycle_no_identity: ...", details: null, hint: null };
    const { client, calls } = stubClient(async () => ({ data: null, error: rpcError }));

    await expect(
      transitionPatternEvidenceLifecycle(client, {
        athleteId: "athlete-1",
        detectorRuleId: "d",
        detectorRuleVersion: "1.0.0",
        evidenceKey: "k",
        targetState: "active",
        reasonCode: null,
        context: {},
      })
    ).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1);
  });
});

describe("persistActivePatternEvidence", () => {
  it("maps params to the exact persist_active_pattern_evidence RPC payload", async () => {
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

    await persistActivePatternEvidence(client, {
      athleteId: "athlete-1",
      detectorRuleId: "sleep_quality_to_same_day_energy_correlation",
      detectorRuleVersion: "1.0.0",
      evaluationKey: "checkin:c1:sleep-energy",
      evidenceKey: "checkin:c1:sleep-energy",
      eventType: "supporting",
      eventDate: "2026-08-10",
      observedValue: { v: 1 },
      provenance: [{ role: "evaluation_checkin", source_kind: "daily_checkin", source_id: "c1" }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("persist_active_pattern_evidence");
    expect(calls[0]!.args).toEqual({
      p_athlete_id: "athlete-1",
      p_detector_rule_id: "sleep_quality_to_same_day_energy_correlation",
      p_detector_rule_version: "1.0.0",
      p_evaluation_key: "checkin:c1:sleep-energy",
      p_evidence_key: "checkin:c1:sleep-energy",
      p_event_type: "supporting",
      p_event_date: "2026-08-10",
      p_observed_value: { v: 1 },
      p_provenance: [{ role: "evaluation_checkin", source_kind: "daily_checkin", source_id: "c1" }],
    });
  });

  it("maps a successful response exactly", async () => {
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

    const result = await persistActivePatternEvidence(client, {
      athleteId: "athlete-1",
      detectorRuleId: "d",
      detectorRuleVersion: "1.0.0",
      evaluationKey: "e",
      evidenceKey: "k",
      eventType: "contradicting",
      eventDate: "2026-08-10",
      observedValue: {},
      provenance: [],
    });

    expect(result).toEqual({
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

    await expect(
      persistActivePatternEvidence(client, {
        athleteId: "athlete-1",
        detectorRuleId: "d",
        detectorRuleVersion: "1.0.0",
        evaluationKey: "e",
        evidenceKey: "k",
        eventType: "supporting",
        eventDate: "2026-08-10",
        observedValue: {},
        provenance: [],
      })
    ).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1);
  });
});
