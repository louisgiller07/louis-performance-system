/**
 * End-to-end integration: real M5_005 detector output (built from a real
 * AthleteTimeline over real Supabase source rows) persisted through
 * persistRecommendationVsActualEvidence into the real local pattern_evidence
 * ledger. This is the actual production call chain M5_006A exists to
 * support — every other suite in this package tests one layer in
 * isolation; this one proves they compose correctly together.
 *
 * V0.3_001A: this detector's persistence adapter is now lifecycle-aware
 * (evidence -> persist_active_pattern_evidence, no_evidence -> a real
 * lifecycle withdrawal via transition_pattern_evidence_lifecycle) and its
 * evidenceKey is decision-only (`decision:<decisionId>`), no longer
 * embedding completedSessionId — see recommendationVsActualExecution.ts's
 * own doc for the full identity-correction rationale.
 *
 * No afterAll athlete cleanup (see patternEvidenceSchema.integration.test.ts's
 * own comment — ON DELETE RESTRICT makes it structurally impossible once
 * evidence exists).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTimeline } from "../../src/timeline/buildTimeline.js";
import { SupabaseLongitudinalSourceAdapter } from "../../src/supabase/adapter.js";
import { detectRecommendationVsActualExecution } from "../../src/detectors/index.js";
import { persistRecommendationVsActualEvidence } from "../../src/persistence/index.js";
import { createTestAthlete, createTestClient, insertCompletedSession, insertDecision, type TestAthlete } from "./testDb.js";
import type { DateRange } from "../../src/types/index.js";

const RANGE: DateRange = { fromDate: "2026-08-01", toDate: "2026-08-20" };
const DECISION_DATE = "2026-08-10";

interface EvidenceOutcome {
  kind: "evidence";
  identityId: string;
  revisionId: string;
  revisionNumber: number;
  evidenceAction: "inserted" | "superseded" | "unchanged";
  lifecycleAction: "transitioned" | "unchanged";
  lifecycleTransitionId: string | null;
  lifecycleTransitionNumber: number | null;
}

describe("M5_005 detector -> M5_006A/B persistence — end-to-end integration", () => {
  let client: SupabaseClient;
  let adapter: SupabaseLongitudinalSourceAdapter;
  let athleteA: TestAthlete;

  beforeAll(async () => {
    client = createTestClient();
    adapter = new SupabaseLongitudinalSourceAdapter(client);
    athleteA = await createTestAthlete(client, "M5_005->M5_006A/B E2E Test Athlete A");
  }, 60_000);

  async function loadTimelineAndDetect(decisionId: string) {
    const [checkins, decisions, completedSessions, outcomes, healthFlags] = await Promise.all([
      adapter.getDailyCheckins(athleteA.athleteId, RANGE),
      adapter.getDecisions(athleteA.athleteId, RANGE),
      adapter.getCompletedSessions(athleteA.athleteId, RANGE),
      adapter.getDecisionOutcomes(athleteA.athleteId, RANGE),
      adapter.getHealthFlags(athleteA.athleteId, RANGE),
    ]);
    const timeline = buildTimeline({ athleteId: athleteA.athleteId, range: RANGE, sources: { checkins, decisions, completedSessions, outcomes, healthFlags } });
    return detectRecommendationVsActualExecution({ timeline, decisionId });
  }

  it("real supporting detection persists as inserted evidence with eventType supporting, evidenceKey = decision:<id>", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, DECISION_DATE, { final_session: "STRENGTH_A" });
    await insertCompletedSession(client, athleteA.athleteId, DECISION_DATE, {
      decision_id: decisionId,
      session_type: "STRENGTH_A",
      completion_status: "done",
    });

    const detection = await loadTimelineAndDetect(decisionId);
    expect(detection.kind).toBe("evidence");
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    expect(detection.eventType).toBe("supporting");
    expect(detection.evidenceKey).toBe(`decision:${decisionId}`);

    const result = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
    expect(result.kind).toBe("evidence");
    expect(result.evidenceAction).toBe("inserted");
    expect(result.revisionNumber).toBe(1);

    const { data } = await client.from("pattern_evidence_current").select("event_type, evidence_key").eq("revision_id", result.revisionId).single();
    expect((data as { event_type: string; evidence_key: string }).event_type).toBe("supporting");
    expect((data as { event_type: string; evidence_key: string }).evidence_key).toBe(`decision:${decisionId}`);
  });

  it("real neutral detection (partial + type match) persists with eventType neutral", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-11", { final_session: "STRENGTH_B" });
    await insertCompletedSession(client, athleteA.athleteId, "2026-08-11", {
      decision_id: decisionId,
      session_type: "STRENGTH_B",
      completion_status: "partial",
    });

    const detection = await loadTimelineAndDetect(decisionId);
    expect(detection.kind).toBe("evidence");
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    expect(detection.eventType).toBe("neutral");

    const result = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
    expect(result.kind).toBe("evidence");
    expect(result.evidenceAction).toBe("inserted");
  });

  it("real contradicting detection (replaced) persists with eventType contradicting", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-12", { final_session: "AEROBIC_BASE" });
    await insertCompletedSession(client, athleteA.athleteId, "2026-08-12", {
      decision_id: decisionId,
      session_type: "RECOVERY",
      completion_status: "replaced",
    });

    const detection = await loadTimelineAndDetect(decisionId);
    expect(detection.kind).toBe("evidence");
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    expect(detection.eventType).toBe("contradicting");

    const result = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
    expect(result.kind).toBe("evidence");
    expect(result.evidenceAction).toBe("inserted");
  });

  it("real no_evidence detection with no prior identity -> skipped_no_evidence_no_prior, zero DB writes", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-13", { final_session: "STRENGTH_A" });
    // No completed_sessions row at all for this date.

    const detection = await loadTimelineAndDetect(decisionId);
    expect(detection.kind).toBe("no_evidence");
    if (detection.kind !== "no_evidence") throw new Error("expected no_evidence");
    expect(detection.evidenceKey).toBe(`decision:${decisionId}`);

    const result = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    expect(result).toEqual({ kind: "no_evidence", action: "skipped_no_evidence_no_prior", identityId: null, transitionId: null, transitionNumber: null });

    const { count } = await client
      .from("pattern_evidence_identities")
      .select("id", { count: "exact", head: true })
      .eq("evaluation_key", `decision:${decisionId}`);
    expect(count).toBe(0);
  });

  it("skipped -> done -> done (identical replay) -> skipped produces revisions 1,2,2,3 exactly, evidence_key stays decision:<id> throughout", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-14", { final_session: "STRENGTH_A" });
    const sessionId = await insertCompletedSession(client, athleteA.athleteId, "2026-08-14", {
      decision_id: decisionId,
      session_type: "STRENGTH_A",
      completion_status: "skipped",
    });

    // T1: skipped -> contradicting -> revision 1
    let detection = await loadTimelineAndDetect(decisionId);
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    const t1 = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
    expect(t1.evidenceAction).toBe("inserted");
    expect(t1.revisionNumber).toBe(1);

    // Correct to done -> supporting -> revision 2
    await client.from("completed_sessions").update({ completion_status: "done", actual_duration_min: 40, rpe: 6 } as never).eq("id", sessionId);
    detection = await loadTimelineAndDetect(decisionId);
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    const t2 = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
    expect(t2.evidenceAction).toBe("superseded");
    expect(t2.revisionNumber).toBe(2);

    // T3: identical replay (still done) -> unchanged -> still revision 2
    detection = await loadTimelineAndDetect(decisionId);
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    const t3 = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
    expect(t3.evidenceAction).toBe("unchanged");
    expect(t3.revisionNumber).toBe(2);
    expect(t3.revisionId).toBe(t2.revisionId);

    // T4: reverted to skipped -> contradicting -> revision 3
    await client.from("completed_sessions").update({ completion_status: "skipped", actual_duration_min: null, rpe: null } as never).eq("id", sessionId);
    detection = await loadTimelineAndDetect(decisionId);
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    const t4 = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
    expect(t4.evidenceAction).toBe("superseded");
    expect(t4.revisionNumber).toBe(3);

    const { data: history } = await client
      .from("pattern_evidence_history")
      .select("revision_number, event_type")
      .eq("evidence_key", `decision:${decisionId}`)
      .order("revision_number", { ascending: true });
    const rows = history as { revision_number: number; event_type: string }[];
    expect(rows.map((r) => r.revision_number)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.event_type)).toEqual(["contradicting", "supporting", "contradicting"]);
  });

  describe("V0.3_001A — lifecycle correction: withdrawal, reactivation, and single-identity-per-decision", () => {
    it("active evidence -> no_evidence -> withdrawn; same no_evidence again -> unchanged_withdrawal; evidence returns -> active again (same identity)", async () => {
      const decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-15", { final_session: "STRENGTH_A" });
      const sessionId = await insertCompletedSession(client, athleteA.athleteId, "2026-08-15", {
        decision_id: decisionId,
        session_type: "STRENGTH_A",
        completion_status: "done",
      });

      // T1: real evidence, active.
      let detection = await loadTimelineAndDetect(decisionId);
      if (detection.kind !== "evidence") throw new Error("expected evidence");
      const t1 = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
      expect(t1.evidenceAction).toBe("inserted");
      const identityId = t1.identityId;

      const { data: activeAfterT1 } = await client.from("pattern_evidence_current_effective").select("identity_id").eq("identity_id", identityId);
      expect(activeAfterT1).toHaveLength(1);

      // T2: unlink the completed_session -> no_evidence -> real withdrawal of the SAME identity.
      await client.from("completed_sessions").update({ decision_id: null } as never).eq("id", sessionId);
      detection = await loadTimelineAndDetect(decisionId);
      expect(detection.kind).toBe("no_evidence");
      if (detection.kind !== "no_evidence") throw new Error("expected no_evidence");
      expect(detection.evidenceKey).toBe(`decision:${decisionId}`);
      const t2 = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
      expect(t2).toMatchObject({ kind: "no_evidence", action: "withdrawn", identityId });

      const { data: activeAfterT2 } = await client.from("pattern_evidence_current_effective").select("identity_id").eq("identity_id", identityId);
      expect(activeAfterT2).toEqual([]); // withdrawn -> no longer effective

      // T3: identical no_evidence again -> unchanged_withdrawal (no new transition).
      const t3 = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
      expect(t3).toMatchObject({ kind: "no_evidence", action: "unchanged_withdrawal", identityId });

      // T4: relink the SAME completed_session -> evidence returns -> the SAME identity reactivates.
      // A genuinely DIFFERENT completedSessionId on the same day is not reachable through the real
      // schema: unique_completed_per_day is (athlete_id, session_date), the detector itself enforces
      // sessionDate === decisionDate (InconsistentExecutionDateError), and once evidence has referenced
      // a completed_session it cannot be deleted (pattern_evidence_source_refs holds a real FK to
      // completed_sessions, by design, to protect the evidence trail) — so relinking the original row is
      // the only real-world path back to "evidence" for this decision. The evidenceKey-excludes-
      // completedSessionId correction itself (the actual point of this fix) is proven directly at the
      // detector-unit level in recommendationVsActualExecution.test.ts ("evidenceKey does NOT embed
      // completedSessionId — two different completed_session ids ... produce the SAME evidenceKey").
      await client.from("completed_sessions").update({ decision_id: decisionId } as never).eq("id", sessionId);
      detection = await loadTimelineAndDetect(decisionId);
      expect(detection.kind).toBe("evidence");
      if (detection.kind !== "evidence") throw new Error("expected evidence");
      expect(detection.evidenceKey).toBe(`decision:${decisionId}`);
      expect(detection.sourceRefs.completedSessionId).toBe(sessionId);
      const t4 = (await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection })) as EvidenceOutcome;
      expect(t4.identityId).toBe(identityId); // SAME identity, never a second one
      expect(t4.lifecycleAction).toBe("transitioned"); // reactivated

      const { data: activeAfterT4 } = await client.from("pattern_evidence_current_effective").select("identity_id").eq("identity_id", identityId);
      expect(activeAfterT4).toHaveLength(1);

      // Exactly ONE pattern_evidence_identity ever existed for this decision — never one per completedSessionId.
      const { count: identityCount } = await client
        .from("pattern_evidence_identities")
        .select("id", { count: "exact", head: true })
        .eq("evaluation_key", `decision:${decisionId}`);
      expect(identityCount).toBe(1);
    });
  });
});
