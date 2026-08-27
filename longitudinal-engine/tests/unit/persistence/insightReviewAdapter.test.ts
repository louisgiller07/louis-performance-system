/**
 * persistPatternInsightReview adapter — pure unit tests. No Docker/Supabase
 * connection: a stub client captures/controls the single `rpc()` call the
 * adapter is allowed to make. Mirrors painPersistenceAdapter.test.ts's
 * stubClient convention exactly.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistPatternInsightReview } from "../../../src/persistence/index.js";
import type { PatternInsightCandidate, PatternInsightSnapshot } from "../../../src/insights/index.js";

function stubClient(rpcImpl: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>): { client: SupabaseClient; calls: Array<{ fn: string; args: unknown }> } {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return rpcImpl(fn, args);
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const SNAPSHOT: PatternInsightSnapshot = {
  insightProjectorVersion: "1.0.0",
  athleteId: "athlete-1",
  insightKind: "sleep_energy_same_day_association",
  detectorRuleId: "sleep_quality_to_same_day_energy_correlation",
  detectorRuleVersion: "1.0.0",
  rangeFromDate: "2026-06-01",
  rangeToDate: "2026-06-30",
  direction: "supporting",
  title: "Sommeil et énergie",
  statement: "test statement",
  caveats: ["test caveat"],
  evidenceCount: 1,
  supportingCount: 1,
  contradictingCount: 0,
  neutralCount: 0,
  directionalEvidenceCount: 1,
  supportingRatio: 1,
  contradictingRatio: 0,
  neutralRatio: 0,
  evidenceBalance: "supporting_only",
  firstEventDate: "2026-06-10",
  lastEventDate: "2026-06-10",
  sourceEvidenceRefs: [],
};

const CANDIDATE: PatternInsightCandidate = {
  snapshot: SNAPSHOT,
  reviewState: "unreviewed",
  currentReview: null,
};

const SUCCESS_RESPONSE = { identity_id: "i1", review_id: "r1", review_number: 1, action: "inserted" as const };

describe("persistPatternInsightReview", () => {
  it("calls persist_pattern_insight_review with the exact RPC payload derived from candidate.snapshot", async () => {
    const { client, calls } = stubClient(async () => ({ data: SUCCESS_RESPONSE, error: null }));

    await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision: "accepted_as_insight", reviewerNote: null });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("persist_pattern_insight_review");
    expect(calls[0]!.args).toEqual({
      p_athlete_id: "athlete-1",
      p_detector_rule_id: "sleep_quality_to_same_day_energy_correlation",
      p_detector_rule_version: "1.0.0",
      p_insight_kind: "sleep_energy_same_day_association",
      p_decision: "accepted_as_insight",
      p_candidate_snapshot: SNAPSHOT,
      p_reviewer_note: null,
    });
  });

  it("p_candidate_snapshot IS candidate.snapshot itself — no arbitrary caller-provided snapshot is ever substituted", async () => {
    const { client, calls } = stubClient(async () => ({ data: SUCCESS_RESPONSE, error: null }));

    await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision: "dismissed", reviewerNote: null });

    const args = calls[0]!.args as { p_candidate_snapshot: unknown };
    expect(args.p_candidate_snapshot).toBe(SNAPSHOT);
  });

  it("the natural key (detector_rule_id/detector_rule_version/insight_kind) is read from candidate.snapshot, never a separate parameter", async () => {
    const { client, calls } = stubClient(async () => ({ data: SUCCESS_RESPONSE, error: null }));
    const differentCandidate: PatternInsightCandidate = {
      ...CANDIDATE,
      snapshot: { ...SNAPSHOT, detectorRuleId: "pain_persistence_across_recent_checkins", detectorRuleVersion: "2.0.0", insightKind: "pain_persistence_between_recent_checkins" },
    };

    await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: differentCandidate, decision: "needs_more_evidence", reviewerNote: null });

    const args = calls[0]!.args as { p_detector_rule_id: string; p_detector_rule_version: string; p_insight_kind: string };
    expect(args.p_detector_rule_id).toBe("pain_persistence_across_recent_checkins");
    expect(args.p_detector_rule_version).toBe("2.0.0");
    expect(args.p_insight_kind).toBe("pain_persistence_between_recent_checkins");
  });

  describe("all three decisions", () => {
    for (const decision of ["accepted_as_insight", "dismissed", "needs_more_evidence"] as const) {
      it(`decision=${decision} is passed through verbatim as p_decision`, async () => {
        const { client, calls } = stubClient(async () => ({ data: SUCCESS_RESPONSE, error: null }));
        await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision, reviewerNote: null });
        expect((calls[0]!.args as { p_decision: string }).p_decision).toBe(decision);
      });
    }
  });

  it("null reviewerNote -> p_reviewer_note: null", async () => {
    const { client, calls } = stubClient(async () => ({ data: SUCCESS_RESPONSE, error: null }));
    await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision: "accepted_as_insight", reviewerNote: null });
    expect((calls[0]!.args as { p_reviewer_note: string | null }).p_reviewer_note).toBeNull();
  });

  it("non-null reviewerNote -> p_reviewer_note: the exact string, unmodified", async () => {
    const { client, calls } = stubClient(async () => ({ data: SUCCESS_RESPONSE, error: null }));
    await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision: "accepted_as_insight", reviewerNote: "Looks solid over the last month." });
    expect((calls[0]!.args as { p_reviewer_note: string | null }).p_reviewer_note).toBe("Looks solid over the last month.");
  });

  it("maps the RPC response exactly (inserted)", async () => {
    const { client } = stubClient(async () => ({ data: SUCCESS_RESPONSE, error: null }));
    const result = await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision: "accepted_as_insight", reviewerNote: null });
    expect(result).toEqual({ identityId: "i1", reviewId: "r1", reviewNumber: 1, action: "inserted" });
  });

  it("maps the RPC response exactly (superseded)", async () => {
    const { client } = stubClient(async () => ({ data: { identity_id: "i1", review_id: "r2", review_number: 2, action: "superseded" }, error: null }));
    const result = await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision: "dismissed", reviewerNote: null });
    expect(result).toEqual({ identityId: "i1", reviewId: "r2", reviewNumber: 2, action: "superseded" });
  });

  it("maps the RPC response exactly (unchanged)", async () => {
    const { client } = stubClient(async () => ({ data: { identity_id: "i1", review_id: "r1", review_number: 1, action: "unchanged" }, error: null }));
    const result = await persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision: "accepted_as_insight", reviewerNote: null });
    expect(result).toEqual({ identityId: "i1", reviewId: "r1", reviewNumber: 1, action: "unchanged" });
  });

  it("propagates the exact RPC error object unwrapped — a sentinel object surfaces byreference, never wrapped/replaced", async () => {
    const sentinelError = { code: "P0001", message: "sentinel structural error", details: null, hint: null };
    const { client, calls } = stubClient(async () => ({ data: null, error: sentinelError }));

    await expect(persistPatternInsightReview(client, { athleteId: "athlete-1", candidate: CANDIDATE, decision: "accepted_as_insight", reviewerNote: null })).rejects.toBe(sentinelError);
    expect(calls).toHaveLength(1);
  });
});
