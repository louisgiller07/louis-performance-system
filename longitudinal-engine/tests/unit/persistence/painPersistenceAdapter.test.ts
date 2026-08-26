/**
 * persistPainPersistenceEvidence adapter — pure unit tests. No
 * Docker/Supabase connection: a stub client captures/controls the single
 * `rpc()` call the adapter is allowed to make per detection.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistPainPersistenceEvidence } from "../../../src/persistence/index.js";
import type { PainPersistenceEvidence, PainPersistenceNoEvidence } from "../../../src/detectors/index.js";

const EVIDENCE: PainPersistenceEvidence = {
  kind: "evidence",
  detectorRuleId: "pain_persistence_across_recent_checkins",
  detectorRuleVersion: "1.0.0",
  evaluationKey: "checkin:c1:pain-persistence",
  evidenceKey: "checkin:c1:pain-persistence",
  eventType: "supporting",
  eventDate: "2026-08-10",
  observedValue: {
    evaluationCheckinId: "c1",
    evaluationCheckinDate: "2026-08-10",
    previousCheckinId: "p1",
    previousCheckinDate: "2026-08-09",
    gapDays: 1,
    previousPain: true,
    evaluationPain: true,
    previousPainLocationCode: "knee_L",
    evaluationPainLocationCode: "knee_L",
    previousPainIntensity: 5,
    evaluationPainIntensity: 6,
    intensityDelta: 1,
    evaluationPainNew: false,
    transitionKind: "same_location_continuation",
    ambiguityReasons: [],
  },
  sourceRefs: {
    evaluationCheckinId: "c1",
    previousCheckinId: "p1",
  },
};

const NO_EVIDENCE: PainPersistenceNoEvidence = {
  kind: "no_evidence",
  detectorRuleId: "pain_persistence_across_recent_checkins",
  detectorRuleVersion: "1.0.0",
  evaluationKey: "checkin:c2:pain-persistence",
  evidenceKey: "checkin:c2:pain-persistence",
  eventDate: "2026-08-11",
  evaluationCheckinId: "c2",
  previousCheckinId: "p2",
  previousCheckinDate: "2026-08-10",
  reason: "prior_checkin_has_no_pain",
};

const NO_EVIDENCE_NO_PRIOR: PainPersistenceNoEvidence = {
  kind: "no_evidence",
  detectorRuleId: "pain_persistence_across_recent_checkins",
  detectorRuleVersion: "1.0.0",
  evaluationKey: "checkin:c3:pain-persistence",
  evidenceKey: "checkin:c3:pain-persistence",
  eventDate: "2026-08-12",
  evaluationCheckinId: "c3",
  previousCheckinId: null,
  previousCheckinDate: null,
  reason: "no_recent_prior_checkin",
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

describe("persistPainPersistenceEvidence — evidence path", () => {
  it("calls persist_active_pattern_evidence with exact provenance: evaluation_checkin then previous_checkin, both daily_checkin", async () => {
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

    await persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("persist_active_pattern_evidence");
    const args = calls[0]!.args as { p_provenance: Array<Record<string, unknown>> };
    expect(args.p_provenance).toEqual([
      { role: "evaluation_checkin", source_kind: "daily_checkin", source_id: "c1" },
      { role: "previous_checkin", source_kind: "daily_checkin", source_id: "p1" },
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

    const result = await persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE });

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

    await expect(persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: EVIDENCE })).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1);
  });
});

describe("persistPainPersistenceEvidence — no_evidence path", () => {
  it("calls transition_pattern_evidence_lifecycle with target=withdrawn, reason_code=detection.reason, and the exact 4-field context shape", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "transitioned" },
      error: null,
    }));

    await persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("transition_pattern_evidence_lifecycle");
    expect(calls[0]!.args).toEqual({
      p_athlete_id: "athlete-1",
      p_detector_rule_id: "pain_persistence_across_recent_checkins",
      p_detector_rule_version: "1.0.0",
      p_evidence_key: "checkin:c2:pain-persistence",
      p_target_state: "withdrawn",
      p_reason_code: "prior_checkin_has_no_pain",
      p_context: {
        evaluation_checkin_id: "c2",
        evaluation_date: "2026-08-11",
        previous_checkin_id: "p2",
        previous_checkin_date: "2026-08-10",
      },
    });
  });

  it("no_recent_prior_checkin -> context carries null previous_checkin_id/previous_checkin_date", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
      error: null,
    }));

    await persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE_NO_PRIOR });

    const args = calls[0]!.args as { p_context: Record<string, unknown> };
    expect(args.p_context).toEqual({
      evaluation_checkin_id: "c3",
      evaluation_date: "2026-08-12",
      previous_checkin_id: null,
      previous_checkin_date: null,
    });
  });

  it("never calls persist_active_pattern_evidence for a no_evidence detection", async () => {
    const { client, calls } = stubClient(async () => ({
      data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
      error: null,
    }));
    await persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(calls.every((c) => c.fn === "transition_pattern_evidence_lifecycle")).toBe(true);
  });

  it("maps action=transitioned -> withdrawn", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "transitioned" },
      error: null,
    }));
    const result = await persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(result).toEqual({ kind: "no_evidence", action: "withdrawn", identityId: "i2", transitionId: "t1", transitionNumber: 1 });
  });

  it("maps action=unchanged -> unchanged_withdrawal", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: "i2", transition_id: "t1", transition_number: 1, state: "withdrawn", action: "unchanged" },
      error: null,
    }));
    const result = await persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE });
    expect(result.kind).toBe("no_evidence");
    expect((result as { action: string }).action).toBe("unchanged_withdrawal");
  });

  it("maps action=skipped_no_prior -> skipped_no_evidence_no_prior, all-null fields preserved", async () => {
    const { client } = stubClient(async () => ({
      data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" },
      error: null,
    }));
    const result = await persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE_NO_PRIOR });
    expect(result).toEqual({ kind: "no_evidence", action: "skipped_no_evidence_no_prior", identityId: null, transitionId: null, transitionNumber: null });
  });

  it("propagates the exact RPC error object unwrapped", async () => {
    const rpcError = { code: "P0001", message: "some structural error", details: null, hint: null };
    const { client, calls } = stubClient(async () => ({ data: null, error: rpcError }));

    await expect(persistPainPersistenceEvidence(client, { athleteId: "athlete-1", detection: NO_EVIDENCE })).rejects.toBe(rpcError);
    expect(calls).toHaveLength(1);
  });
});
