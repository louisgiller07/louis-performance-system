import { describe, expect, it } from "vitest";
import { createRecordingRpcClient, UnexpectedRecordingRpcCallError } from "../../../tools/recordingRpcClient.js";

describe("createRecordingRpcClient — persist_decision_outcome", () => {
  it("records horizon only, returns {data: null, error: null}, performs no network I/O", async () => {
    const { client, outcomeCalls } = createRecordingRpcClient();
    const result = await client.rpc("persist_decision_outcome", { p_athlete_id: "a1", p_row: { decision_id: "d1", horizon: "J_PLUS_1" } });
    expect(result).toEqual({ data: null, error: null });
    expect(outcomeCalls).toEqual([{ horizon: "J_PLUS_1" }]);
  });

  it("never records decisionId/athleteId anywhere in the accumulator", async () => {
    const { client, outcomeCalls } = createRecordingRpcClient();
    await client.rpc("persist_decision_outcome", { p_athlete_id: "SECRET_ATHLETE", p_row: { decision_id: "SECRET_DECISION", horizon: "J_PLUS_3" } });
    expect(JSON.stringify(outcomeCalls)).not.toContain("SECRET_ATHLETE");
    expect(JSON.stringify(outcomeCalls)).not.toContain("SECRET_DECISION");
  });
});

describe("createRecordingRpcClient — persist_active_pattern_evidence (Evidence)", () => {
  it("records only detectorRuleId/detectorRuleVersion/eventType/provenanceCount", async () => {
    const { client, evidenceCalls } = createRecordingRpcClient();
    await client.rpc("persist_active_pattern_evidence", {
      p_athlete_id: "a1",
      p_detector_rule_id: "sleep_quality_to_same_day_energy_correlation",
      p_detector_rule_version: "1.0.0",
      p_evaluation_key: "checkin:c1",
      p_evidence_key: "checkin:c1",
      p_event_type: "supporting",
      p_event_date: "2026-08-18",
      p_observed_value: { sleep_quality: 8, energy: 8 },
      p_provenance: [{ role: "evaluation_checkin", source_kind: "daily_checkin", source_id: "c1" }],
    });
    expect(evidenceCalls).toEqual([
      { detectorRuleId: "sleep_quality_to_same_day_energy_correlation", detectorRuleVersion: "1.0.0", eventType: "supporting", provenanceCount: 1 },
    ]);
  });

  it("never leaks observed_value or source ids into the accumulator", async () => {
    const { client, evidenceCalls } = createRecordingRpcClient();
    await client.rpc("persist_active_pattern_evidence", {
      p_detector_rule_id: "pain_persistence_across_recent_checkins",
      p_detector_rule_version: "1.0.0",
      p_event_type: "contradicting",
      p_observed_value: { pain_location: "SECRET_KNEE", note: "SECRET_NOTE" },
      p_provenance: [{ role: "x", source_kind: "daily_checkin", source_id: "SECRET_SOURCE_ID" }],
    });
    const serialized = JSON.stringify(evidenceCalls);
    expect(serialized).not.toContain("SECRET_KNEE");
    expect(serialized).not.toContain("SECRET_NOTE");
    expect(serialized).not.toContain("SECRET_SOURCE_ID");
  });

  it("returns a synthetic response with obviously-fake, monotonically-unique ids — never a plausible UUID — and evidence_action always inserted / lifecycle_action always unchanged", async () => {
    const { client } = createRecordingRpcClient();
    const r1 = await client.rpc("persist_active_pattern_evidence", { p_detector_rule_id: "x", p_detector_rule_version: "1.0.0", p_event_type: "supporting", p_provenance: [] });
    const r2 = await client.rpc("persist_active_pattern_evidence", { p_detector_rule_id: "x", p_detector_rule_version: "1.0.0", p_event_type: "supporting", p_provenance: [] });
    expect(r1.error).toBeNull();
    expect((r1.data as any).identity_id).toMatch(/^preview-synthetic-identity-\d+$/);
    expect((r1.data as any).revision_id).toMatch(/^preview-synthetic-revision-\d+$/);
    expect((r1.data as any).evidence_action).toBe("inserted");
    expect((r1.data as any).lifecycle_action).toBe("unchanged");
    expect((r1.data as any).lifecycle_transition_id).toBeNull();
    // Distinct calls get distinct synthetic ids — never accidentally collide/reuse.
    expect((r1.data as any).identity_id).not.toBe((r2.data as any).identity_id);
  });

  it("provenanceCount defaults to 0 when p_provenance is missing/not an array", async () => {
    const { client, evidenceCalls } = createRecordingRpcClient();
    await client.rpc("persist_active_pattern_evidence", { p_detector_rule_id: "x", p_detector_rule_version: "1.0.0", p_event_type: "neutral" });
    expect(evidenceCalls[0]!.provenanceCount).toBe(0);
  });
});

describe("createRecordingRpcClient — transition_pattern_evidence_lifecycle (NoEvidence)", () => {
  it("records only detectorRuleId/detectorRuleVersion/reasonCode, returns skipped_no_prior with all ids null", async () => {
    const { client, lifecycleCalls } = createRecordingRpcClient();
    const result = await client.rpc("transition_pattern_evidence_lifecycle", {
      p_athlete_id: "a1",
      p_detector_rule_id: "recommendation_vs_actual_execution",
      p_detector_rule_version: "1.0.0",
      p_evidence_key: "decision:d1",
      p_target_state: "withdrawn",
      p_reason_code: "no_completed_session",
      p_context: {},
    });
    expect(lifecycleCalls).toEqual([{ detectorRuleId: "recommendation_vs_actual_execution", detectorRuleVersion: "1.0.0", reasonCode: "no_completed_session" }]);
    expect(result).toEqual({ data: { identity_id: null, transition_id: null, transition_number: null, state: null, action: "skipped_no_prior" }, error: null });
  });

  it("never leaks evidenceKey into the accumulator", async () => {
    const { client, lifecycleCalls } = createRecordingRpcClient();
    await client.rpc("transition_pattern_evidence_lifecycle", { p_detector_rule_id: "x", p_detector_rule_version: "1.0.0", p_evidence_key: "decision:SECRET_DECISION_ID", p_reason_code: null, p_target_state: "withdrawn", p_context: {} });
    expect(JSON.stringify(lifecycleCalls)).not.toContain("SECRET_DECISION_ID");
  });

  it("records a null reasonCode as null, not the string \"null\"", async () => {
    const { client, lifecycleCalls } = createRecordingRpcClient();
    await client.rpc("transition_pattern_evidence_lifecycle", { p_detector_rule_id: "x", p_detector_rule_version: "1.0.0", p_reason_code: null, p_target_state: "withdrawn", p_context: {} });
    expect(lifecycleCalls[0]!.reasonCode).toBeNull();
  });
});

describe("createRecordingRpcClient — unexpected RPC calls", () => {
  it("throws UnexpectedRecordingRpcCallError for any RPC outside the 3 expected names — never silently no-ops", async () => {
    const { client } = createRecordingRpcClient();
    await expect(client.rpc("persist_pattern_insight_review", {})).rejects.toThrow(UnexpectedRecordingRpcCallError);
  });

  it("throws for a plausible-but-wrong RPC name too (defense against typos silently passing)", async () => {
    const { client } = createRecordingRpcClient();
    await expect(client.rpc("persist_decision_outcomes", {})).rejects.toThrow(UnexpectedRecordingRpcCallError);
  });
});

describe("createRecordingRpcClient — zero network surface", () => {
  it("the returned client object exposes nothing but .rpc — any other method access is undefined, never a real Supabase call path", () => {
    const { client } = createRecordingRpcClient();
    expect((client as any).from).toBeUndefined();
    expect((client as any).auth).toBeUndefined();
    expect(typeof client.rpc).toBe("function");
  });
});
