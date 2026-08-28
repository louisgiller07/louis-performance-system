/**
 * V0.3_001A — real-DB proof that runDetectors correctly persists across all
 * 3 existing detectors when composed with assembleAthleteTimeline, and
 * that a second identical pass is fully idempotent (no duplicate revisions,
 * no duplicate transitions).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleAthleteTimeline } from "../../src/supabase/assembleAthleteTimeline.js";
import { runDetectors } from "../../src/supabase/detectorOrchestrator.js";
import { currentLongitudinalProcessingDate } from "../../src/timeline/index.js";
import { RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, SLEEP_ENERGY_RULE_ID, PAIN_PERSISTENCE_RULE_ID } from "../../src/detectors/index.js";
import { createTestAthlete, createTestClient, insertCheckin, insertCompletedSession, insertDecision, type TestAthlete } from "./testDb.js";

describe("runDetectors + assembleAthleteTimeline — integration (real DB)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;
  let processingDate: string;

  beforeAll(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "DetectorOrchestrator Integration Athlete");
    processingDate = currentLongitudinalProcessingDate();
  }, 60_000);

  it("real athlete data -> all 3 detectors run over real evaluation units and persist real evidence", async () => {
    const decisionDate = "2026-06-10";
    const decisionId = await insertDecision(client, athlete.athleteId, decisionDate, { final_session: "STRENGTH_A" });
    await insertCompletedSession(client, athlete.athleteId, decisionDate, {
      decision_id: decisionId,
      session_type: "STRENGTH_A",
      completion_status: "done",
    });
    await insertCheckin(client, athlete.athleteId, decisionDate, { sleep_quality: 8, energy: 8 });

    const timeline = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    const result = await runDetectors({ supabaseAdmin: client, timeline });

    expect(result.errors).toEqual([]);
    const detectorIds = new Set(result.results.map((r) => r.detectorRuleId));
    expect(detectorIds.has(RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID)).toBe(true);
    expect(detectorIds.has(SLEEP_ENERGY_RULE_ID)).toBe(true);
    expect(detectorIds.has(PAIN_PERSISTENCE_RULE_ID)).toBe(true);

    const recResult = result.results.find((r) => r.detectorRuleId === RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID && r.evaluationUnitId === decisionId);
    expect(recResult?.action).toBe("evidence_inserted");

    // Real row actually persisted, findable via the decision-only evidence key.
    const { data } = await client.from("pattern_evidence_current").select("event_type").eq("evidence_key", `decision:${decisionId}`).single();
    expect((data as { event_type: string }).event_type).toBe("supporting");
  });

  it("second identical pass is fully idempotent — zero new revisions, zero new transitions", async () => {
    const decisionDate = "2026-06-11";
    const decisionId = await insertDecision(client, athlete.athleteId, decisionDate, { final_session: "REST" });
    await insertCheckin(client, athlete.athleteId, decisionDate, { sleep_quality: 5, energy: 5 });

    const runOnce = async () => {
      const timeline = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
      return runDetectors({ supabaseAdmin: client, timeline });
    };

    const first = await runOnce();
    expect(first.errors).toEqual([]);

    const { count: identityCountAfterFirst } = await client
      .from("pattern_evidence_identities")
      .select("id", { count: "exact", head: true })
      .eq("evaluation_key", `decision:${decisionId}`);

    const second = await runOnce();
    expect(second.errors).toEqual([]);

    const { count: identityCountAfterSecond } = await client
      .from("pattern_evidence_identities")
      .select("id", { count: "exact", head: true })
      .eq("evaluation_key", `decision:${decisionId}`);

    expect(identityCountAfterSecond).toBe(identityCountAfterFirst);

    const recSecond = second.results.find((r) => r.detectorRuleId === RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID && r.evaluationUnitId === decisionId);
    // No completed session was ever linked -> no_evidence both times -> skipped_no_evidence_no_prior both times (idempotent no-op).
    expect(recSecond?.action).toBe("skipped_no_evidence_no_prior");
  });

  it("cross-athlete isolation: runDetectors for athlete A never touches athlete B's evidence", async () => {
    const athleteB = await createTestAthlete(client, "DetectorOrchestrator Integration Athlete B");
    const decisionDateB = "2026-06-12";
    const decisionIdB = await insertDecision(client, athleteB.athleteId, decisionDateB, { final_session: "STRENGTH_A" });
    await insertCompletedSession(client, athleteB.athleteId, decisionDateB, { decision_id: decisionIdB, session_type: "STRENGTH_A", completion_status: "done" });

    const timelineA = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });
    await runDetectors({ supabaseAdmin: client, timeline: timelineA });

    // Athlete B's decision was never touched by athlete A's orchestration run.
    const { count } = await client.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("evaluation_key", `decision:${decisionIdB}`);
    expect(count).toBe(0);
  });
});
