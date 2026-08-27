/**
 * SupabasePatternInsightReviewAdapter — pure unit tests. No Docker/Supabase
 * connection: a stub client captures/controls the exact `.from().select().eq()`
 * chain the adapter is allowed to make. Mirrors persistDailyRun.test.ts's
 * fakeClient convention (head-coach-engine) adapted for a `.from()` read
 * chain instead of `.rpc()`.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePatternInsightReviewAdapter } from "../../../src/supabase/index.js";

function fakeReadClient(result: { data: unknown; error: unknown }) {
  const eqSpy = vi.fn(() => Promise.resolve(result));
  const selectSpy = vi.fn(() => ({ eq: eqSpy }));
  const fromSpy = vi.fn(() => ({ select: selectSpy }));
  const client = { from: fromSpy } as unknown as SupabaseClient;
  return { client, fromSpy, selectSpy, eqSpy };
}

const VALID_ROW = {
  athlete_id: "athlete-1",
  detector_rule_id: "sleep_quality_to_same_day_energy_correlation",
  detector_rule_version: "1.0.0",
  insight_kind: "sleep_energy_same_day_association",
  decision: "accepted_as_insight",
  review_number: 1,
  reviewer_note: null,
  candidate_snapshot: { insightProjectorVersion: "1.0.0" },
};

describe("SupabasePatternInsightReviewAdapter.getCurrentPatternInsightReviews", () => {
  it("queries EXCLUSIVELY pattern_insight_review_current — exactly one .from() call, that table only", async () => {
    const { client, fromSpy } = fakeReadClient({ data: [VALID_ROW], error: null });
    const adapter = new SupabasePatternInsightReviewAdapter(client);

    await adapter.getCurrentPatternInsightReviews("athlete-1");

    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(fromSpy).toHaveBeenCalledWith("pattern_insight_review_current");
    // No fallback anywhere in this call to pattern_insight_review_history,
    // pattern_insight_reviews, pattern_insight_identities, or any
    // pattern_evidence_* view — the single .from() call above is the
    // adapter's ENTIRE database interaction for this method.
  });

  it("applies athlete_id = the requested athlete via .eq()", async () => {
    const { client, eqSpy } = fakeReadClient({ data: [VALID_ROW], error: null });
    const adapter = new SupabasePatternInsightReviewAdapter(client);

    await adapter.getCurrentPatternInsightReviews("athlete-42");

    expect(eqSpy).toHaveBeenCalledTimes(1);
    expect(eqSpy).toHaveBeenCalledWith("athlete_id", "athlete-42");
  });

  it("maps a returned row to the camelCase PatternInsightReviewRecord shape", async () => {
    const { client } = fakeReadClient({ data: [VALID_ROW], error: null });
    const adapter = new SupabasePatternInsightReviewAdapter(client);

    const result = await adapter.getCurrentPatternInsightReviews("athlete-1");

    expect(result).toEqual([
      {
        athleteId: "athlete-1",
        detectorRuleId: "sleep_quality_to_same_day_energy_correlation",
        detectorRuleVersion: "1.0.0",
        insightKind: "sleep_energy_same_day_association",
        decision: "accepted_as_insight",
        reviewNumber: 1,
        reviewerNote: null,
        candidateSnapshot: { insightProjectorVersion: "1.0.0" },
      },
    ]);
  });

  it("empty result set -> []", async () => {
    const { client } = fakeReadClient({ data: [], error: null });
    const adapter = new SupabasePatternInsightReviewAdapter(client);

    const result = await adapter.getCurrentPatternInsightReviews("athlete-1");

    expect(result).toEqual([]);
  });

  it("null data (no rows) -> [] (never null/undefined)", async () => {
    const { client } = fakeReadClient({ data: null, error: null });
    const adapter = new SupabasePatternInsightReviewAdapter(client);

    const result = await adapter.getCurrentPatternInsightReviews("athlete-1");

    expect(result).toEqual([]);
  });

  it("a query error is thrown, never silently converted to []", async () => {
    const { client } = fakeReadClient({ data: null, error: { code: "PGRST301", message: "JWT expired" } });
    const adapter = new SupabasePatternInsightReviewAdapter(client);

    await expect(adapter.getCurrentPatternInsightReviews("athlete-1")).rejects.toThrow(/PGRST301/);
  });

  it("multiple rows for the same athlete are all mapped, in the order returned", async () => {
    const secondRow = { ...VALID_ROW, insight_kind: "pain_persistence_between_recent_checkins" };
    const { client } = fakeReadClient({ data: [VALID_ROW, secondRow], error: null });
    const adapter = new SupabasePatternInsightReviewAdapter(client);

    const result = await adapter.getCurrentPatternInsightReviews("athlete-1");

    expect(result).toHaveLength(2);
    expect(result[0]!.insightKind).toBe("sleep_energy_same_day_association");
    expect(result[1]!.insightKind).toBe("pain_persistence_between_recent_checkins");
  });
});
