/**
 * End-to-end integration: real M5_006C pain-persistence detector output
 * (built from a real AthleteTimeline over real Supabase checkin rows)
 * persisted through persistPainPersistenceEvidence into the real local
 * pattern_evidence + pattern_evidence_lifecycle_transitions ledger.
 * Mirrors sleepEnergyPersistence.integration.test.ts's conventions exactly.
 *
 * No afterAll athlete cleanup (see patternEvidenceSchema.integration.test.ts's
 * own comment — ON DELETE RESTRICT makes it structurally impossible once
 * evidence exists).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTimeline } from "../../src/timeline/buildTimeline.js";
import { formatUtcMs, MS_PER_DAY, parseCanonicalDateUtc } from "../../src/timeline/range.js";
import { SupabaseLongitudinalSourceAdapter } from "../../src/supabase/adapter.js";
import { detectPainPersistenceAcrossRecentCheckins } from "../../src/detectors/index.js";
import { persistPainPersistenceEvidence } from "../../src/persistence/index.js";
import { createTestAthlete, createTestClient, insertCheckin, type TestAthlete } from "./testDb.js";
import type { DateRange } from "../../src/types/index.js";

function offsetDate(base: string, days: number): string {
  return formatUtcMs(parseCanonicalDateUtc(base, "base") + days * MS_PER_DAY);
}

describe("M5_006C pain-persistence detector -> persistence — end-to-end integration", () => {
  let client: SupabaseClient;
  let adapter: SupabaseLongitudinalSourceAdapter;
  let athleteA: TestAthlete;

  beforeAll(async () => {
    client = createTestClient();
    adapter = new SupabaseLongitudinalSourceAdapter(client);
    athleteA = await createTestAthlete(client, "M5_006C Pain-Persistence E2E Test Athlete A");
  }, 60_000);

  async function loadTimelineAndDetect(candidateCheckinId: string, candidateDate: string) {
    const range: DateRange = { fromDate: offsetDate(candidateDate, -3), toDate: candidateDate };
    const checkins = await adapter.getDailyCheckins(athleteA.athleteId, range);
    const timeline = buildTimeline({
      athleteId: athleteA.athleteId,
      range,
      sources: { checkins, decisions: [], completedSessions: [], outcomes: [], healthFlags: [] },
    });
    return detectPainPersistenceAcrossRecentCheckins({ timeline, evaluationCheckinId: candidateCheckinId });
  }

  it("real supporting detection persists via persist_active_pattern_evidence — inserted, lifecycle unchanged (implicit active)", async () => {
    const candidateDate = "2026-01-10";
    const pDate = offsetDate(candidateDate, -1);
    await insertCheckin(client, athleteA.athleteId, pDate, { pain: true, pain_intensity: 5, pain_location_code: "knee_L" });
    const candidateId = await insertCheckin(client, athleteA.athleteId, candidateDate, { pain: true, pain_intensity: 6, pain_location_code: "knee_L", pain_new: false });

    const detection = await loadTimelineAndDetect(candidateId, candidateDate);
    expect(detection.kind).toBe("evidence");
    if (detection.kind !== "evidence") throw new Error("expected evidence");
    expect(detection.eventType).toBe("supporting");

    const result = await persistPainPersistenceEvidence(client, { athleteId: athleteA.athleteId, detection });
    expect(result.kind).toBe("evidence");
    if (result.kind !== "evidence") throw new Error("expected evidence");
    expect(result.evidenceAction).toBe("inserted");
    expect(result.lifecycleAction).toBe("unchanged");
    expect(result.lifecycleTransitionId).toBeNull();
  });

  it("real no_evidence (no prior) persists as skipped_no_evidence_no_prior", async () => {
    const candidateDate = "2026-01-20";
    const candidateId = await insertCheckin(client, athleteA.athleteId, candidateDate, { pain: true, pain_intensity: 4, pain_location_code: "hip_L", pain_new: true });

    const detection = await loadTimelineAndDetect(candidateId, candidateDate);
    expect(detection.kind).toBe("no_evidence");
    if (detection.kind !== "no_evidence") throw new Error("expected no_evidence");
    expect(detection.reason).toBe("no_recent_prior_checkin");

    const result = await persistPainPersistenceEvidence(client, { athleteId: athleteA.athleteId, detection });
    expect(result).toEqual({ kind: "no_evidence", action: "skipped_no_evidence_no_prior", identityId: null, transitionId: null, transitionNumber: null });
  });

  it("T1 -> T2 (backfill withdraws) -> T3 (backfill removed, byte-identical reactivation, SAME revision effective again)", async () => {
    const candidateDate = "2026-02-15";
    const c1Date = offsetDate(candidateDate, -1);
    const c3Date = offsetDate(candidateDate, -3);
    const evidenceKey = () => `checkin:${candidateId}:pain-persistence`;

    // T1: C-3 = same-location pain, C = same-location pain, painNew=false -> supporting, evidence active.
    await insertCheckin(client, athleteA.athleteId, c3Date, { pain: true, pain_intensity: 5, pain_location_code: "knee_L" });
    const candidateId = await insertCheckin(client, athleteA.athleteId, candidateDate, { pain: true, pain_intensity: 5, pain_location_code: "knee_L", pain_new: false });

    const d1 = await loadTimelineAndDetect(candidateId, candidateDate);
    expect(d1.kind).toBe("evidence");
    if (d1.kind !== "evidence") throw new Error("expected evidence");
    const t1 = await persistPainPersistenceEvidence(client, { athleteId: athleteA.athleteId, detection: d1 });
    if (t1.kind !== "evidence") throw new Error("expected evidence");
    expect(t1.evidenceAction).toBe("inserted");
    const rev1Id = t1.revisionId;

    // T2: backfill C-1 with pain=false -> P becomes C-1 (closer) -> NoEvidence prior_checkin_has_no_pain -> withdrawal.
    await insertCheckin(client, athleteA.athleteId, c1Date, { pain: false, pain_intensity: null, pain_location_code: null });
    const d2 = await loadTimelineAndDetect(candidateId, candidateDate);
    expect(d2.kind).toBe("no_evidence");
    if (d2.kind !== "no_evidence") throw new Error("expected no_evidence");
    expect(d2.reason).toBe("prior_checkin_has_no_pain");
    expect(d2.previousCheckinDate).toBe(c1Date);
    const t2 = await persistPainPersistenceEvidence(client, { athleteId: athleteA.athleteId, detection: d2 });
    expect(t2).toMatchObject({ kind: "no_evidence", action: "withdrawn" });

    const { data: stateAfterT2 } = await client.from("pattern_evidence_current_state").select("lifecycle_state").eq("evidence_key", evidenceKey()).single();
    expect((stateAfterT2 as { lifecycle_state: string }).lifecycle_state).toBe("withdrawn");

    // T3: remove the backfill (delete the C-1 row) -> P becomes C-3 again -> evidence content byte-identical to T1.
    const { error: deleteError } = await client.from("daily_checkins").delete().eq("athlete_id", athleteA.athleteId).eq("checkin_date", c1Date);
    expect(deleteError).toBeNull();

    const d3 = await loadTimelineAndDetect(candidateId, candidateDate);
    expect(d3.kind).toBe("evidence");
    if (d3.kind !== "evidence") throw new Error("expected evidence");
    expect(d3).toEqual(d1); // byte-identical detection content to T1

    const t3 = await persistPainPersistenceEvidence(client, { athleteId: athleteA.athleteId, detection: d3 });
    if (t3.kind !== "evidence") throw new Error("expected evidence");
    expect(t3.evidenceAction).toBe("unchanged"); // no new revision — semantic content/provenance identical to T1
    expect(t3.revisionId).toBe(rev1Id); // SAME revision
    expect(t3.lifecycleAction).toBe("transitioned"); // reactivated

    const { data: effective } = await client.from("pattern_evidence_current_effective").select("revision_id").eq("evidence_key", evidenceKey()).single();
    expect((effective as { revision_id: string }).revision_id).toBe(rev1Id);
  });
});
