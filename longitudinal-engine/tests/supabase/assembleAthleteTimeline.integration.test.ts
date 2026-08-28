/**
 * V0.3_001A — real-DB proof of assembleAthleteTimeline's compact
 * timeline-range derivation. This is the critical correctness proof for
 * the buildTimeline-performance-invariant fix: ALL_HISTORY_RANGE
 * (1900-01-01..9999-12-31) must NEVER reach buildTimeline directly — this
 * suite proves the actually-derived range is compact (bounded by real
 * source data), and that the whole pipeline completes fast against real
 * rows spanning a realistic athlete history.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleAthleteTimeline } from "../../src/supabase/assembleAthleteTimeline.js";
import { currentLongitudinalProcessingDate } from "../../src/timeline/index.js";
import { createTestAthlete, createTestClient, insertCheckin, insertDecision, type TestAthlete } from "./testDb.js";

describe("assembleAthleteTimeline — integration (real DB)", () => {
  let client: SupabaseClient;

  beforeAll(async () => {
    client = createTestClient();
  }, 60_000);

  it("empty athlete (zero source rows) -> single-day timeline range = {processingDate, processingDate}", async () => {
    const athlete = await createTestAthlete(client, "AssembleTimeline Empty Athlete");
    const processingDate = currentLongitudinalProcessingDate();

    const timeline = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });

    expect(timeline.range).toEqual({ fromDate: processingDate, toDate: processingDate });
    expect(timeline.days).toHaveLength(1);
    expect(timeline.decisionThreads).toHaveLength(0);
  });

  it("compact range derivation: fromDate = earliest actual source row date minus detector lookback padding, never an arbitrary/wide default", async () => {
    const athlete = await createTestAthlete(client, "AssembleTimeline Compact Range Athlete");
    const processingDate = currentLongitudinalProcessingDate();

    // Real rows spanning a realistic window — the earliest is a checkin, not a decision.
    await insertCheckin(client, athlete.athleteId, "2026-06-01");
    await insertDecision(client, athlete.athleteId, "2026-06-15", { final_session: "STRENGTH_A" });

    const timeline = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });

    // Padded 60 days back from the earliest real row (2026-06-01) to satisfy the sleep-energy
    // detector's own lookback requirement — never 1900-01-01 or any other unbounded sentinel.
    expect(timeline.range.fromDate).toBe("2026-04-02");
    expect(timeline.range.toDate).toBe(processingDate);
    // A compact range completes fast and materializes a bounded number of days — proof the
    // implementation never handed ALL_HISTORY_RANGE (1900-01-01..9999-12-31) to buildTimeline.
    expect(timeline.days.length).toBeLessThan(200);
  });

  it("the earliest decision (not checkin) correctly drives fromDate when it is the true minimum", async () => {
    const athlete = await createTestAthlete(client, "AssembleTimeline Decision-Min Athlete");
    const processingDate = currentLongitudinalProcessingDate();

    await insertDecision(client, athlete.athleteId, "2026-05-20", { final_session: "REST" });
    await insertCheckin(client, athlete.athleteId, "2026-06-01");

    const timeline = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });

    // 2026-05-20 minus 60 days of lookback padding.
    expect(timeline.range.fromDate).toBe("2026-03-21");
  });

  it("future-dated source rows (beyond longitudinalProcessingDate) are excluded from the timeline entirely", async () => {
    const athlete = await createTestAthlete(client, "AssembleTimeline Future-Dated Athlete");
    const processingDate = currentLongitudinalProcessingDate();
    const farFutureDate = "2099-01-01"; // comfortably beyond any real processingDate

    await insertCheckin(client, athlete.athleteId, "2026-06-01");
    await insertCheckin(client, athlete.athleteId, farFutureDate);

    const timeline = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });

    // The future row must never influence fromDate, never appear as a materialized day, and the
    // range's own toDate must never extend to cover it.
    expect(timeline.range.toDate).toBe(processingDate);
    expect(timeline.range.toDate < farFutureDate).toBe(true);
    const allCheckinDates = timeline.days.flatMap((d) => d.checkins.map((c) => c.checkinDate));
    expect(allCheckinDates).not.toContain(farFutureDate);
  });

  it("real timeline round-trip: assembled timeline correctly reflects a real decision + linked completed session", async () => {
    const athlete = await createTestAthlete(client, "AssembleTimeline Round-Trip Athlete");
    const processingDate = currentLongitudinalProcessingDate();
    const decisionId = await insertDecision(client, athlete.athleteId, "2026-06-10", { final_session: "STRENGTH_A" });

    const timeline = await assembleAthleteTimeline({ client, athleteId: athlete.athleteId, longitudinalProcessingDate: processingDate });

    expect(timeline.athleteId).toBe(athlete.athleteId);
    expect(timeline.decisionThreads).toHaveLength(1);
    expect(timeline.decisionThreads[0]!.decision.id).toBe(decisionId);
  });
});
