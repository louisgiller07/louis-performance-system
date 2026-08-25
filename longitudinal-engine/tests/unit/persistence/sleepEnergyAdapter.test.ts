/**
 * persistSleepEnergyEvidence adapter — pure unit tests. No Docker/Supabase
 * connection: a stub client captures/controls the single `rpc()` call the
 * adapter is allowed to make per detection.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistSleepEnergyEvidence } from "../../../src/persistence/index.js";
import type { SleepEnergyEvidence, SleepEnergyNoEvidence } from "../../../src/detectors/index.js";

const EVIDENCE: SleepEnergyEvidence = {
  kind: "evidence",
  detectorRuleId: "sleep_quality_to_same_day_energy_correlation",
  detectorRuleVersion: "1.0.0",
  evaluationKey: "checkin:c1:sleep-energy",
  evidenceKey: "checkin:c1:sleep-energy",
  eventType: "supporting",
  eventDate: "2026-08-10",
  observedValue: {
    evaluationCheckinId: "c1",
    evaluationCheckinDate: "2026-08-10",
    sleepQuality: 7,
    energy: 7,
    sleepPercentile: 0.5,
    energyPercentile: 0.5,
    sleepBucket: "Q3",
    energyBucket: "Q3",
    baselineWindowStartDate: "2026-06-11",
    baselineWindowEndDate: "2026-08-09",
    sleepBaselineObservationCount: 21,
    energyBaselineObservationCount: 21,
    sleepBaselineDistinctValueCount: 2,
    energyBaselineDistinctValueCount: 2,
    sleepBaselineHistogram: [0, 0, 0, 0, 0, 0, 0, 15, 6, 0, 0],
    energyBaselineHistogram: [0, 0, 0, 0, 0, 0, 0, 15, 6, 0, 0],
    rankingMethod: "empirical_midrank_v1",
    confounderReasons: [],
  },
  sourceRefs: {
    evaluationCheckinId: "c1",
    baselineCheckinIds: ["b1", "b2", "b3"],
  },
};

const NO_EVIDENCE: SleepEnergyNoEvidence = {
  kind: "no_evidence",
  detectorRuleId: "sleep_quality_to_same_day_energy_correlation",
  detectorRuleVersion: "1.0.0",
  evaluationKey: "checkin:c2:sleep-energy",
  evidenceKey: "checkin:c2:sleep-energy",
  eventDate: "2026-08-11",
  evaluationCheckinId: "c2",
  reason: "insufficient_baseline_data",
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

describe("persistSleepEnergyEvidence — evidence path", () => {
  it("calls persist_active_pattern_evidence with exact provenance: evaluation_checkin first, then baseline_checkin per baseline id, all daily_checkin", async () => {
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

    await persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("persist_active_pattern_evidence");
    const args = calls[0]!.args as { p_provenance: Array<Record<string, unknown>> };
    expect(args.p_provenance).toEqual([
      { role: "evaluation_checkin", source_kind: "daily_checkin", source_id: "c1" },
      { role: "baseline_checkin", source_kind: "daily_checkin", source_id: "b1" },
      { role: "baseline_checkin", source_kind: "daily_checkin", source_id: "b2" },
      { role: "baseline_checkin", source_kind: "daily_checkin", source_id: "b3" },
    ]);
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

    const result = await persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

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

    await expect(persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE })).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1);
  });
});

describe("persistSleepEnergyEvidence — no_evidence path", () => {
  it("calls transition_pattern_evidence_lifecycle with target=withdrawn, reason_code=detection.reason, and the exact context shape", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "transitioned" },
      error: null,
    }));

    await persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("transition_pattern_evidence_lifecycle");
    expect(calls[0]!.args).toEqual({
      p_athlete_id: "athlete-1",
      p_detector_rule_id: "sleep_quality_to_same_day_energy_correlation",
      p_detector_rule_version: "1.0.0",
      p_evidence_key: "checkin:c2:sleep-energy",
      p_target_state: "withdrawn",
      p_reason_code: "insufficient_baseline_data",
      p_context: { evaluation_checkin_id: "c2", evaluation_date: "2026-08-11" },
    });
  });

  it("never calls persist_active_pattern_evidence for a no_evidence detection", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
      error: null,
    }));
    await persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(calls.every((c) => c.fn === "transition_pattern_evidence_lifecycle")).toBe(true);
  });

  it("maps action=transitioned -> withdrawn", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "transitioned" },
      error: null,
    }));
    const result = await persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(result).toEqual({ kind: "no_evidence", action: "withdrawn", identityId: "i2", transitionId: "t1", transitionNumber: 1 });
  });

  it("maps action=unchanged -> unchanged_withdrawal", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "unchanged" },
      error: null,
    }));
    const result = await persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(result.kind).toBe("no_evidence");
    expect((result as { action: string }).action).toBe("unchanged_withdrawal");
  });

  it("maps action=skipped_no_prior -> skipped_no_evidence_no_prior, all-null fields preserved", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
      error: null,
    }));
    const result = await persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(result).toEqual({ kind: "no_evidence", action: "skipped_no_evidence_no_prior", identityId: null, transitionId: null, transitionNumber: null });
  });

  it("propagates the exact RPC error object unwrapped", async () => {
    const rpcError = { code: "P0001", message: "some structural error", details: null, hint: null };
    const { client, calls } = stubClient(async () => ({ data: null, error: rpcError }));

    await expect(persistSleepEnergyEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE })).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1);
  });
});
