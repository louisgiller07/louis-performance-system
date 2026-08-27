/**
 * M5_006D integration suite — real local Supabase stack. Proves the
 * adapter (`SupabasePatternEvidenceAggregationAdapter`) reads exclusively
 * `pattern_evidence_current_effective`, and that composing it with the
 * pure `aggregateEffectivePatternEvidence` reproduces the exact lifecycle
 * withdrawal/reactivation and current-head-only behavior the M5_006B
 * views themselves already guarantee — M5_006D adds zero lifecycle logic
 * of its own; this suite is the proof of that composition, not a
 * reimplementation of the lifecycle semantics (already proven exhaustively
 * in patternEvidenceLifecycle.integration.test.ts).
 *
 * No afterAll athlete cleanup (see patternEvidenceSchema.integration.test.ts's
 * own comment — ON DELETE RESTRICT makes it structurally impossible once
 * evidence exists).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertDecision, type TestAthlete } from "./testDb.js";
import { SupabasePatternEvidenceAggregationAdapter } from "../../src/supabase/index.js";
import { aggregateEffectivePatternEvidence } from "../../src/aggregation/index.js";
import type { PatternEvidenceAggregate } from "../../src/aggregation/index.js";

interface ActiveResult {
  identity_id: string;
  revision_id: string;
  revision_number: number;
  evidence_action: "inserted" | "superseded" | "unchanged";
  lifecycle_action: "transitioned" | "unchanged";
}

describe("M5_006D aggregation — integration (real DB)", () => {
  let client: SupabaseClient;
  let adapter: SupabasePatternEvidenceAggregationAdapter;
  let athleteA: TestAthlete;
  let decisionId: string;

  const DETECTOR_ID = "aggregation_test_detector";
  const DETECTOR_VERSION = "1.0.0";
  const RANGE = { fromDate: "2026-03-01", toDate: "2026-03-31" };

  beforeAll(async () => {
    client = createTestClient();
    adapter = new SupabasePatternEvidenceAggregationAdapter(client);
    athleteA = await createTestAthlete(client, "M5_006D Aggregation Test Athlete A");
    decisionId = await insertDecision(client, athleteA.athleteId, "2026-03-10", { final_session: "STRENGTH_A" });
  }, 60_000);

  function provenance() {
    return [{ role: "evaluation_decision", source_kind: "decision", source_id: decisionId }];
  }

  async function persistActive(evidenceKey: string, eventType: string, eventDate = "2026-03-10") {
    const { data, error } = await client.rpc("persist_active_pattern_evidence", {
      p_athlete_id: athleteA.athleteId,
      p_detector_rule_id: DETECTOR_ID,
      p_detector_rule_version: DETECTOR_VERSION,
      p_evaluation_key: `eval:${evidenceKey}`,
      p_evidence_key: evidenceKey,
      p_event_type: eventType,
      p_event_date: eventDate,
      p_observed_value: { synthetic: true },
      p_provenance: provenance(),
    });
    if (error) throw error;
    return data as ActiveResult;
  }

  async function withdraw(evidenceKey: string) {
    const { error } = await client.rpc("transition_pattern_evidence_lifecycle", {
      p_athlete_id: athleteA.athleteId,
      p_detector_rule_id: DETECTOR_ID,
      p_detector_rule_version: DETECTOR_VERSION,
      p_evidence_key: evidenceKey,
      p_target_state: "withdrawn",
      p_reason_code: "test_withdrawal",
      p_context: {},
    });
    if (error) throw error;
  }

  async function reactivate(evidenceKey: string) {
    const { error } = await client.rpc("transition_pattern_evidence_lifecycle", {
      p_athlete_id: athleteA.athleteId,
      p_detector_rule_id: DETECTOR_ID,
      p_detector_rule_version: DETECTOR_VERSION,
      p_evidence_key: evidenceKey,
      p_target_state: "active",
      p_reason_code: null,
      p_context: {},
    });
    if (error) throw error;
  }

  async function aggregateNow() {
    const rows = await adapter.getCurrentEffectivePatternEvidence(athleteA.athleteId, RANGE);
    return aggregateEffectivePatternEvidence({ athleteId: athleteA.athleteId, range: RANGE, evidence: rows });
  }

  function findAggregate(aggregates: readonly PatternEvidenceAggregate[]) {
    return aggregates.find((a) => a.detectorRuleId === DETECTOR_ID && a.detectorRuleVersion === DETECTOR_VERSION);
  }

  it("T1 -> T2 (withdraw) -> T3 (reactivate): aggregate reflects the lifecycle exactly, zero lifecycle logic in M5_006D itself", async () => {
    const keyA = `a-${Date.now()}`;
    const keyB = `b-${Date.now()}`;

    // T1: effective A = supporting, effective B = contradicting -> balanced.
    await persistActive(keyA, "supporting");
    await persistActive(keyB, "contradicting");

    const t1 = findAggregate(await aggregateNow())!;
    expect(t1.supportingCount).toBe(1);
    expect(t1.contradictingCount).toBe(1);
    expect(t1.evidenceBalance).toBe("balanced");

    // T2: withdraw A -> current_effective excludes A -> contradicting_only.
    await withdraw(keyA);
    const t2 = findAggregate(await aggregateNow())!;
    expect(t2.supportingCount).toBe(0);
    expect(t2.contradictingCount).toBe(1);
    expect(t2.evidenceBalance).toBe("contradicting_only");
    expect(t2.sourceEvidenceRefs.some((r) => r.evidenceKey === keyA)).toBe(false);

    // T3: reactivate A -> current_effective contains A again -> balanced.
    await reactivate(keyA);
    const t3 = findAggregate(await aggregateNow())!;
    expect(t3.supportingCount).toBe(1);
    expect(t3.contradictingCount).toBe(1);
    expect(t3.evidenceBalance).toBe("balanced");
    expect(t3.sourceEvidenceRefs.some((r) => r.evidenceKey === keyA)).toBe(true);
  });

  it("current-head-only: identity X rev1 supporting -> rev2 contradicting -> aggregation counts ONLY rev2, no historical double counting", async () => {
    const key = `revhead-${Date.now()}`;

    const rev1 = await persistActive(key, "supporting");
    expect(rev1.revision_number).toBe(1);
    const rev2 = await persistActive(key, "contradicting");
    expect(rev2.revision_number).toBe(2);
    expect(rev2.evidence_action).toBe("superseded");

    const rows = await adapter.getCurrentEffectivePatternEvidence(athleteA.athleteId, RANGE);
    const matching = rows.filter((r) => r.evidenceKey === key);
    expect(matching).toHaveLength(1); // exactly rev2, never both
    expect(matching[0]!.revisionNumber).toBe(2);
    expect(matching[0]!.eventType).toBe("contradicting");

    const aggregates = await aggregateNow();
    const a = findAggregate(aggregates)!;
    const refsForKey = a.sourceEvidenceRefs.filter((r) => r.evidenceKey === key);
    expect(refsForKey).toHaveLength(1);
    expect(refsForKey[0]!.revisionNumber).toBe(2);
    expect(refsForKey[0]!.eventType).toBe("contradicting");
  });

  it("adapter reads exclusively pattern_evidence_current_effective — a withdrawn identity is absent from the adapter's rows even though it still exists in pattern_evidence_current", async () => {
    const key = `adapter-scope-${Date.now()}`;
    await persistActive(key, "supporting");
    await withdraw(key);

    const effectiveRows = await adapter.getCurrentEffectivePatternEvidence(athleteA.athleteId, RANGE);
    expect(effectiveRows.some((r) => r.evidenceKey === key)).toBe(false);

    const { data: currentRow, error } = await client.from("pattern_evidence_current").select("evidence_key").eq("evidence_key", key).maybeSingle();
    expect(error).toBeNull();
    expect(currentRow).not.toBeNull(); // still present in pattern_evidence_current — proves the adapter is NOT silently falling back to it
  });
});
