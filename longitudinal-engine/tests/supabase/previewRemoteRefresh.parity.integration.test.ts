/**
 * V0.3_001B — mandatory local parity proof (Section 18 of the pre-rollout
 * review): the read-only preview (real orchestrators + RecordingRpcClient,
 * zero writes) must predict EXACTLY what a real local run produces and
 * persists. No remote writes anywhere in this file — local Supabase stack
 * only, same convention as every other tests/supabase/** file.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleAthleteTimeline } from "../../src/supabase/assembleAthleteTimeline.js";
import { calculateAndPersistOutcomes } from "../../src/supabase/outcomeOrchestrator.js";
import { runDetectors } from "../../src/supabase/detectorOrchestrator.js";
import { currentLongitudinalProcessingDate } from "../../src/timeline/index.js";
import { RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, PAIN_PERSISTENCE_RULE_ID } from "../../src/detectors/index.js";
import { createRecordingRpcClient } from "../../../longitudinal-engine/tools/recordingRpcClient.js";
import { buildPreviewReport } from "../../../longitudinal-engine/tools/buildPreviewReport.js";
import { createTestAthlete, createTestClient, insertCheckin, insertDecision, type TestAthlete } from "./testDb.js";

async function countPatternEvidenceIdentities(client: SupabaseClient, athleteId: string, detectorRuleId?: string): Promise<number> {
  let query = client.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId);
  if (detectorRuleId) query = query.eq("detector_rule_id", detectorRuleId);
  const { count, error } = await query;
  if (error) throw new Error(`countPatternEvidenceIdentities failed: ${error.message}`);
  return count ?? 0;
}

async function countPatternEvidenceRevisions(client: SupabaseClient, athleteId: string): Promise<number> {
  const { count, error } = await client
    .from("pattern_evidence_revisions")
    .select("id, pattern_evidence_identities!inner(athlete_id)", { count: "exact", head: true })
    .eq("pattern_evidence_identities.athlete_id", athleteId);
  if (error) throw new Error(`countPatternEvidenceRevisions failed: ${error.message}`);
  return count ?? 0;
}

async function countPatternEvidenceSourceRefs(client: SupabaseClient, athleteId: string): Promise<number> {
  const { count, error } = await client
    .from("pattern_evidence_source_refs")
    .select("id, pattern_evidence_revisions!inner(pattern_evidence_identities!inner(athlete_id))", { count: "exact", head: true })
    .eq("pattern_evidence_revisions.pattern_evidence_identities.athlete_id", athleteId);
  if (error) throw new Error(`countPatternEvidenceSourceRefs failed: ${error.message}`);
  return count ?? 0;
}

async function countPatternEvidenceLifecycleTransitions(client: SupabaseClient, athleteId: string): Promise<number> {
  const { count, error } = await client
    .from("pattern_evidence_lifecycle_transitions")
    .select("id, pattern_evidence_identities!inner(athlete_id)", { count: "exact", head: true })
    .eq("pattern_evidence_identities.athlete_id", athleteId);
  if (error) throw new Error(`countPatternEvidenceLifecycleTransitions failed: ${error.message}`);
  return count ?? 0;
}

describe("V0.3_001B — preview vs real local execution parity (real DB)", () => {
  let client: SupabaseClient;

  beforeAll(async () => {
    client = createTestClient();
  }, 60_000);

  it("recommendation-only fixture: N decisions, 0 completed sessions, empty ledger — preview matches a real run exactly, and a second real run stays idempotent", async () => {
    const athlete: TestAthlete = await createTestAthlete(client, "V0.3_001B Preview Parity — recommendation-only");
    const processingDate = currentLongitudinalProcessingDate();

    const decisionDates = ["2026-06-01", "2026-06-02", "2026-06-03"];
    for (const d of decisionDates) {
      await insertDecision(client, athlete.athleteId, d, { final_session: "STRENGTH_A" });
      // no completed_session ever inserted for this athlete
    }

    // --- PREVIEW: real orchestrators + RecordingRpcClient, zero writes ---
    const timelineForPreview = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    const recording = createRecordingRpcClient();
    const previewOutcomes = await calculateAndPersistOutcomes({ supabaseAdmin: recording.client, timeline: timelineForPreview, observedThroughDate: processingDate });
    const previewDetectors = await runDetectors({ supabaseAdmin: recording.client, timeline: timelineForPreview });
    const report = buildPreviewReport({
      canonicalHead: "test",
      processingDate,
      emptyLedgerPrecondition: true,
      timeline: timelineForPreview,
      outcomesResult: previewOutcomes,
      detectorsResult: previewDetectors,
      outcomeCalls: recording.outcomeCalls,
      evidenceCalls: recording.evidenceCalls,
      lifecycleCalls: recording.lifecycleCalls,
    });

    // Section 19: exact expected shape for a recommendation-only, zero-completed-session, empty-ledger fixture.
    expect(report.detectors[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]!.attempted).toBe(decisionDates.length);
    expect(report.detectors[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID]!.simulatedActions).toEqual({ skipped_no_evidence_no_prior: decisionDates.length });
    expect(report.expectedDbDeltas.patternEvidenceIdentities).toBe(0);
    expect(report.expectedDbDeltas.patternEvidenceRevisions).toBe(0);
    expect(report.expectedDbDeltas.patternEvidenceSourceRefs).toBe(0);
    expect(report.expectedDbDeltas.patternEvidenceLifecycleTransitions).toBe(0);

    // --- REAL LOCAL EXECUTION ---
    const identitiesBefore = await countPatternEvidenceIdentities(client, athlete.athleteId, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID);
    const timelineForReal = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    const realOutcomes = await calculateAndPersistOutcomes({ supabaseAdmin: client, timeline: timelineForReal, observedThroughDate: processingDate });
    const realDetectors = await runDetectors({ supabaseAdmin: client, timeline: timelineForReal });
    const identitiesAfter = await countPatternEvidenceIdentities(client, athlete.athleteId, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID);

    // --- COMPARE preview vs real ---
    expect(realOutcomes.attempted).toBe(previewOutcomes.attempted);
    expect(realOutcomes.writeSucceeded).toBe(previewOutcomes.writeSucceeded);
    expect(realOutcomes.alreadyExisted).toBe(previewOutcomes.alreadyExisted);
    expect(realOutcomes.skippedImmature).toBe(previewOutcomes.skippedImmature);

    const realRecActions = realDetectors.results.filter((r) => r.detectorRuleId === RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID).map((r) => r.action);
    expect(realRecActions).toEqual(decisionDates.map(() => "skipped_no_evidence_no_prior"));
    expect(identitiesAfter - identitiesBefore).toBe(0); // exactly matches the predicted delta of 0

    // --- SECOND real run: idempotent, matches the "skippedNoPrior again" expectation from Section 2 of the review ---
    const timelineForSecond = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    const secondDetectors = await runDetectors({ supabaseAdmin: client, timeline: timelineForSecond });
    const secondRecActions = secondDetectors.results.filter((r) => r.detectorRuleId === RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID).map((r) => r.action);
    expect(secondRecActions).toEqual(decisionDates.map(() => "skipped_no_evidence_no_prior"));
    const identitiesAfterSecond = await countPatternEvidenceIdentities(client, athlete.athleteId, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID);
    expect(identitiesAfterSecond).toBe(identitiesAfter);
  }, 60_000);

  it("evidence-producing fixture (pain-persistence): preview correctly predicts Evidence count/eventType/provenance and matches real DB deltas exactly", async () => {
    const athlete: TestAthlete = await createTestAthlete(client, "V0.3_001B Preview Parity — pain-persistence evidence");
    const processingDate = currentLongitudinalProcessingDate();

    // Day 1: previous checkin, pain=true, location "knee" — no prior checkin before it, so it is itself
    // a no_evidence unit (reason: no_recent_prior_checkin). Day 2 (1 day later, within the 3-day lookback):
    // pain=true, SAME location, painNew=false -> deterministically "supporting" Evidence (pain-persistence
    // is Evidence-always once previous.pain === true — see the detector's own doc).
    await insertCheckin(client, athlete.athleteId, "2026-07-01", { pain: true, pain_intensity: 5, pain_location_code: "neck", pain_new: true });
    await insertCheckin(client, athlete.athleteId, "2026-07-02", { pain: true, pain_intensity: 4, pain_location_code: "neck", pain_new: false });

    // --- PREVIEW ---
    const timelineForPreview = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    const recording = createRecordingRpcClient();
    await calculateAndPersistOutcomes({ supabaseAdmin: recording.client, timeline: timelineForPreview, observedThroughDate: processingDate });
    const previewDetectors = await runDetectors({ supabaseAdmin: recording.client, timeline: timelineForPreview });
    const report = buildPreviewReport({
      canonicalHead: "test",
      processingDate,
      emptyLedgerPrecondition: true,
      timeline: timelineForPreview,
      outcomesResult: { attempted: 0, writeSucceeded: 0, alreadyExisted: 0, skippedImmature: 0, errors: [] },
      detectorsResult: previewDetectors,
      outcomeCalls: [],
      evidenceCalls: recording.evidenceCalls,
      lifecycleCalls: recording.lifecycleCalls,
    });

    const painSummary = report.detectors[PAIN_PERSISTENCE_RULE_ID]!;
    expect(painSummary.attempted).toBe(2); // day1 (no_evidence) + day2 (evidence)
    expect(painSummary.evidence).toEqual({ total: 1, supporting: 1, neutral: 0, contradicting: 0 });
    expect(painSummary.noEvidence.total).toBe(1);
    expect(painSummary.noEvidence.reasonCodeCounts).toEqual({ no_recent_prior_checkin: 1 });

    const painEvidenceCalls = recording.evidenceCalls.filter((c) => c.detectorRuleId === PAIN_PERSISTENCE_RULE_ID);
    expect(painEvidenceCalls).toHaveLength(1);
    const predictedProvenanceCount = painEvidenceCalls[0]!.provenanceCount;
    expect(predictedProvenanceCount).toBeGreaterThan(0); // evaluation + previous checkin, at minimum

    expect(report.expectedDbDeltas.patternEvidenceIdentities).toBe(1);
    expect(report.expectedDbDeltas.patternEvidenceRevisions).toBe(1);
    expect(report.expectedDbDeltas.patternEvidenceSourceRefs).toBe(predictedProvenanceCount);
    expect(report.expectedDbDeltas.patternEvidenceLifecycleTransitions).toBe(0);
    expect(report.expectedCandidateKinds).toEqual(["pain_persistence_between_recent_checkins"]);

    // --- REAL LOCAL EXECUTION ---
    const identitiesBefore = await countPatternEvidenceIdentities(client, athlete.athleteId, PAIN_PERSISTENCE_RULE_ID);
    const revisionsBefore = await countPatternEvidenceRevisions(client, athlete.athleteId);
    const sourceRefsBefore = await countPatternEvidenceSourceRefs(client, athlete.athleteId);
    const transitionsBefore = await countPatternEvidenceLifecycleTransitions(client, athlete.athleteId);

    const timelineForReal = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    const realDetectors = await runDetectors({ supabaseAdmin: client, timeline: timelineForReal });

    const identitiesAfter = await countPatternEvidenceIdentities(client, athlete.athleteId, PAIN_PERSISTENCE_RULE_ID);
    const revisionsAfter = await countPatternEvidenceRevisions(client, athlete.athleteId);
    const sourceRefsAfter = await countPatternEvidenceSourceRefs(client, athlete.athleteId);
    const transitionsAfter = await countPatternEvidenceLifecycleTransitions(client, athlete.athleteId);

    // --- COMPARE preview vs real, exactly ---
    const realPainActions = realDetectors.results.filter((r) => r.detectorRuleId === PAIN_PERSISTENCE_RULE_ID).map((r) => r.action);
    expect(realPainActions.sort()).toEqual(["evidence_inserted", "skipped_no_evidence_no_prior"].sort());

    expect(identitiesAfter - identitiesBefore).toBe(report.expectedDbDeltas.patternEvidenceIdentities);
    expect(revisionsAfter - revisionsBefore).toBe(report.expectedDbDeltas.patternEvidenceRevisions);
    expect(sourceRefsAfter - sourceRefsBefore).toBe(report.expectedDbDeltas.patternEvidenceSourceRefs);
    expect(transitionsAfter - transitionsBefore).toBe(report.expectedDbDeltas.patternEvidenceLifecycleTransitions);
  }, 60_000);
});
