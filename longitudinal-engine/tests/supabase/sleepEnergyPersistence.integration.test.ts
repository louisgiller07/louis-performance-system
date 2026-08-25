/**
 * End-to-end integration: real M5_006B sleep-energy detector output (built
 * from a real AthleteTimeline over real Supabase checkin rows) persisted
 * through persistSleepEnergyEvidence into the real local pattern_evidence +
 * pattern_evidence_lifecycle_transitions ledger. Every other suite in this
 * package tests one layer in isolation; this one proves they compose.
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
import { detectSleepQualityToSameDayEnergyCorrelation } from "../../src/detectors/index.js";
import { persistSleepEnergyEvidence } from "../../src/persistence/index.js";
import { createTestAthlete, createTestClient, insertCheckin, type TestAthlete } from "./testDb.js";
import type { DateRange } from "../../src/types/index.js";

function offsetDate(base: string, days: number): string {
  return formatUtcMs(parseCanonicalDateUtc(base, "base") + days * MS_PER_DAY);
}

describe("M5_006B sleep-energy detector -> persistence — end-to-end integration", () => {
  let client: SupabaseClient;
  let adapter: SupabaseLongitudinalSourceAdapter;
  let athleteA: TestAthlete;

  beforeAll(async () => {
    client = createTestClient();
    adapter = new SupabaseLongitudinalSourceAdapter(client);
    athleteA = await createTestAthlete(client, "M5_006B Sleep-Energy E2E Test Athlete A");
  }, 60_000);

  /** 25 baseline rows (2 distinct values, well above the 21 minimum) over [C-60, C-36], leaving the rest of the window empty (absent days are fine). */
  async function seedBaseline(candidateDate: string): Promise<void> {
    for (let i = 0; i < 25; i++) {
      const value = i % 5 === 0 ? 8 : 5;
      await insertCheckin(client, athleteA.athleteId, offsetDate(candidateDate, -60 + i), { sleep_quality: value, energy: value });
    }
  }

  async function loadTimelineAndDetect(candidateCheckinId: string, candidateDate: string) {
    const range: DateRange = { fromDate: offsetDate(candidateDate, -60), toDate: candidateDate };
    const checkins = await adapter.getDailyCheckins(athleteA.athleteId, range);
    const timeline = buildTimeline({
      athleteId: athleteA.athleteId,
      range,
      sources: { checkins, decisions: [], completedSessions: [], outcomes: [], healthFlags: [] },
    });
    return detectSleepQualityToSameDayEnergyCorrelation({ timeline, evaluationCheckinId: candidateCheckinId });
  }

  it("real evidence detection persists via persist_active_pattern_evidence — inserted, lifecycle unchanged (implicit active)", async () => {
    const candidateDate = "2026-01-10";
    await seedBaseline(candidateDate);
    const candidateId = await insertCheckin(client, athleteA.athleteId, candidateDate, { sleep_quality: 5, energy: 5 });

    const detection = await loadTimelineAndDetect(candidateId, candidateDate);
    expect(detection.kind).toBe("evidence");

    const result = await persistSleepEnergyEvidence(client, { athleteId: athleteA.athleteId, detection });
    expect(result.kind).toBe("evidence");
    if (result.kind !== "evidence") throw new Error("expected evidence");
    expect(result.evidenceAction).toBe("inserted");
    expect(result.lifecycleAction).toBe("unchanged");
    expect(result.lifecycleTransitionId).toBeNull();

    const { data: identityRow } = await client
      .from("pattern_evidence_identities")
      .select("id")
      .eq("evidence_key", `checkin:${candidateId}:sleep-energy`)
      .single();
    const { count: lifecycleCount } = await client
      .from("pattern_evidence_lifecycle_transitions")
      .select("id", { count: "exact", head: true })
      .eq("evidence_identity_id", (identityRow as { id: string }).id);
    expect(lifecycleCount).toBe(0); // "no prior identity -> zero lifecycle row"
  });

  it("real no_evidence detection persists via a withdrawal — skipped_no_evidence_no_prior when there is no prior identity", async () => {
    const candidateDate = "2026-01-20";
    // No baseline seeded at all -> insufficient_baseline_data.
    const candidateId = await insertCheckin(client, athleteA.athleteId, candidateDate, { sleep_quality: 5, energy: 5 });

    const detection = await loadTimelineAndDetect(candidateId, candidateDate);
    expect(detection.kind).toBe("no_evidence");
    if (detection.kind !== "no_evidence") throw new Error("expected no_evidence");
    expect(detection.reason).toBe("insufficient_baseline_data");

    const result = await persistSleepEnergyEvidence(client, { athleteId: athleteA.athleteId, detection });
    expect(result).toEqual({ kind: "no_evidence", action: "skipped_no_evidence_no_prior", identityId: null, transitionId: null, transitionNumber: null });
  });

  it("full T1-T6 lifecycle end-to-end with the REAL detector across a corrected baseline, including identical-content T5 reactivation", async () => {
    // Far enough from the other tests' dates in this file (all share athleteA, UNIQUE(athlete_id, checkin_date)) that neither the candidate nor its 60-day baseline window can collide.
    const candidateDate = "2026-04-01";

    // T1: baseline present, candidate lands bottom+bottom -> supporting evidence.
    await seedBaseline(candidateDate);
    const candidateId = await insertCheckin(client, athleteA.athleteId, candidateDate, { sleep_quality: 5, energy: 5 });
    const evidenceKey = `checkin:${candidateId}:sleep-energy`;

    const d1 = await loadTimelineAndDetect(candidateId, candidateDate);
    expect(d1.kind).toBe("evidence");
    const t1 = await persistSleepEnergyEvidence(client, { athleteId: athleteA.athleteId, detection: d1 });
    if (t1.kind !== "evidence") throw new Error("expected evidence");
    expect(t1.evidenceAction).toBe("inserted");
    const rev1Id = t1.revisionId;

    // T2: identical re-detection -> evidence unchanged.
    const d2 = await loadTimelineAndDetect(candidateId, candidateDate);
    const t2 = await persistSleepEnergyEvidence(client, { athleteId: athleteA.athleteId, detection: d2 });
    if (t2.kind !== "evidence") throw new Error("expected evidence");
    expect(t2.evidenceAction).toBe("unchanged");
    expect(t2.revisionId).toBe(rev1Id);

    // T3: now simulate a NoEvidence outcome (e.g. baseline later disqualified) via a direct withdrawal call —
    // the detector itself always evaluates from real data, so to exercise T3/T4 deterministically we call the
    // adapter's no_evidence path directly with a synthetic NoEvidence carrying the SAME evidenceKey.
    const t3 = await persistSleepEnergyEvidence(client, {
      athleteId: athleteA.athleteId,
      detection: {
        kind: "no_evidence",
        detectorRuleId: "sleep_quality_to_same_day_energy_correlation",
        detectorRuleVersion: "1.0.0",
        evaluationKey: evidenceKey,
        evidenceKey,
        eventDate: candidateDate,
        evaluationCheckinId: candidateId,
        reason: "baseline_variance_insufficient",
      },
    });
    expect(t3).toMatchObject({ kind: "no_evidence", action: "withdrawn" });

    // T4: identical no_evidence -> unchanged_withdrawal.
    const t4 = await persistSleepEnergyEvidence(client, {
      athleteId: athleteA.athleteId,
      detection: {
        kind: "no_evidence",
        detectorRuleId: "sleep_quality_to_same_day_energy_correlation",
        detectorRuleVersion: "1.0.0",
        evaluationKey: evidenceKey,
        evidenceKey,
        eventDate: candidateDate,
        evaluationCheckinId: candidateId,
        reason: "baseline_variance_insufficient",
      },
    });
    expect(t4).toMatchObject({ kind: "no_evidence", action: "unchanged_withdrawal" });

    // T5 (MANDATORY): re-detect with the REAL detector against the UNCHANGED source data ->
    // identical evidence content -> evidence RPC unchanged, but lifecycle reactivates (transition #2).
    const d5 = await loadTimelineAndDetect(candidateId, candidateDate);
    const t5 = await persistSleepEnergyEvidence(client, { athleteId: athleteA.athleteId, detection: d5 });
    if (t5.kind !== "evidence") throw new Error("expected evidence");
    expect(t5.evidenceAction).toBe("unchanged");
    expect(t5.revisionId).toBe(rev1Id);
    expect(t5.lifecycleAction).toBe("transitioned");
    expect(t5.lifecycleTransitionNumber).toBe(2);

    // T6: candidate edited to a genuinely different value -> new revision, lifecycle already active -> unchanged.
    await client.from("daily_checkins").update({ sleep_quality: 9, energy: 9 }).eq("id", candidateId);
    const d6 = await loadTimelineAndDetect(candidateId, candidateDate);
    const t6 = await persistSleepEnergyEvidence(client, { athleteId: athleteA.athleteId, detection: d6 });
    if (t6.kind !== "evidence") throw new Error("expected evidence");
    expect(t6.evidenceAction).toBe("superseded");
    expect(t6.lifecycleAction).toBe("unchanged");

    const { data: effective } = await client.from("pattern_evidence_current_effective").select("revision_id").eq("evidence_key", evidenceKey).single();
    expect((effective as { revision_id: string }).revision_id).toBe(t6.revisionId);
  });
});
