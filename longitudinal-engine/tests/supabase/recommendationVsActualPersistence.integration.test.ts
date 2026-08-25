/**
 * End-to-end integration: real M5_005 detector output (built from a real
 * AthleteTimeline over real Supabase source rows) persisted through
 * persistRecommendationVsActualEvidence into the real local pattern_evidence
 * ledger. This is the actual production call chain M5_006A exists to
 * support — every other suite in this package tests one layer in
 * isolation; this one proves they compose correctly together.
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

describe("M5_005 detector -> M5_006A persistence — end-to-end integration", () => {
  let client: SupabaseClient;
  let adapter: SupabaseLongitudinalSourceAdapter;
  let athleteA: TestAthlete;

  beforeAll(async () => {
    client = createTestClient();
    adapter = new SupabaseLongitudinalSourceAdapter(client);
    athleteA = await createTestAthlete(client, "M5_005->M5_006A E2E Test Athlete A");
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

  it("real supporting detection persists as inserted evidence with eventType supporting", async () => {
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

    const result = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    expect(result.action).toBe("inserted");
    if (result.action === "skipped_no_evidence") throw new Error("expected a real write");
    expect(result.revisionNumber).toBe(1);

    const { data } = await client.from("pattern_evidence_current").select("event_type, evidence_key").eq("revision_id", result.revisionId).single();
    expect((data as { event_type: string }).event_type).toBe("supporting");
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

    const result = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    if (result.action === "skipped_no_evidence") throw new Error("expected a real write");
    expect(result.action).toBe("inserted");
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

    const result = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    if (result.action === "skipped_no_evidence") throw new Error("expected a real write");
    expect(result.action).toBe("inserted");
  });

  it("real no_evidence detection -> zero DB writes", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-13", { final_session: "STRENGTH_A" });
    // No completed_sessions row at all for this date.

    const detection = await loadTimelineAndDetect(decisionId);
    expect(detection.kind).toBe("no_evidence");

    const result = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    expect(result).toEqual({ action: "skipped_no_evidence" });

    const { count } = await client
      .from("pattern_evidence_identities")
      .select("id", { count: "exact", head: true })
      .eq("evaluation_key", `decision:${decisionId}`);
    expect(count).toBe(0);
  });

  it("skipped -> done -> done (identical replay) -> skipped produces revisions 1,2,2,3 exactly", async () => {
    const decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-14", { final_session: "STRENGTH_A" });
    const sessionId = await insertCompletedSession(client, athleteA.athleteId, "2026-08-14", {
      decision_id: decisionId,
      session_type: "STRENGTH_A",
      completion_status: "skipped",
    });

    // T1: skipped -> contradicting -> revision 1
    let detection = await loadTimelineAndDetect(decisionId);
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    const t1 = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    if (t1.action === "skipped_no_evidence") throw new Error("expected a real write");
    expect(t1.action).toBe("inserted");
    expect(t1.revisionNumber).toBe(1);

    // Correct to done -> supporting -> revision 2
    await client.from("completed_sessions").update({ completion_status: "done", actual_duration_min: 40, rpe: 6 } as never).eq("id", sessionId);
    detection = await loadTimelineAndDetect(decisionId);
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    const t2 = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    if (t2.action === "skipped_no_evidence") throw new Error("expected a real write");
    expect(t2.action).toBe("superseded");
    expect(t2.revisionNumber).toBe(2);

    // T3: identical replay (still done) -> unchanged -> still revision 2
    detection = await loadTimelineAndDetect(decisionId);
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    const t3 = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    if (t3.action === "skipped_no_evidence") throw new Error("expected a real write");
    expect(t3.action).toBe("unchanged");
    expect(t3.revisionNumber).toBe(2);
    expect(t3.revisionId).toBe(t2.revisionId);

    // T4: reverted to skipped -> contradicting -> revision 3
    await client.from("completed_sessions").update({ completion_status: "skipped", actual_duration_min: null, rpe: null } as never).eq("id", sessionId);
    detection = await loadTimelineAndDetect(decisionId);
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    const t4 = await persistRecommendationVsActualEvidence(client, { athleteId: athleteA.athleteId, detection });
    if (t4.action === "skipped_no_evidence") throw new Error("expected a real write");
    expect(t4.action).toBe("superseded");
    expect(t4.revisionNumber).toBe(3);

    const { data: history } = await client
      .from("pattern_evidence_history")
      .select("revision_number, event_type")
      .eq("evidence_key", `decision:${decisionId}:completion:${sessionId}`)
      .order("revision_number", { ascending: true });
    const rows = history as { revision_number: number; event_type: string }[];
    expect(rows.map((r) => r.revision_number)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.event_type)).toEqual(["contradicting", "supporting", "contradicting"]);
  });
});
