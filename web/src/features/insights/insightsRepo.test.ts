import { describe, expect, it, vi, beforeEach } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { FunctionsHttpError } from "@supabase/supabase-js";
import { buildSubmitReviewBody, getInsights, submitReview } from "./insightsRepo";
import type { PatternInsightCandidate, PatternInsightSnapshot } from "./insightsTypes";

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
}

function snapshot(overrides: Partial<PatternInsightSnapshot> = {}): PatternInsightSnapshot {
  return {
    insightProjectorVersion: "1.0.0",
    athleteId: "athlete-1",
    insightKind: "recommendation_execution_alignment",
    detectorRuleId: "recommendation_vs_actual_execution",
    detectorRuleVersion: "1.0.0",
    rangeFromDate: "1900-01-01",
    rangeToDate: "9999-12-31",
    direction: "supporting",
    title: "Exécution des recommandations",
    statement: "Les séances recommandées sont réalisées comme prévu.",
    caveats: ["Décrit l'exécution observée."],
    evidenceCount: 1,
    supportingCount: 1,
    contradictingCount: 0,
    neutralCount: 0,
    directionalEvidenceCount: 1,
    supportingRatio: 1,
    contradictingRatio: 0,
    neutralRatio: 0,
    evidenceBalance: "supporting_only",
    firstEventDate: "2026-06-20",
    lastEventDate: "2026-06-20",
    sourceEvidenceRefs: [
      {
        identityId: "id-1",
        revisionId: "rev-1",
        revisionNumber: 1,
        evaluationKey: "decision:abc",
        evidenceKey: "decision:abc",
        eventType: "supporting",
        eventDate: "2026-06-20",
      },
    ],
    ...overrides,
  };
}

function candidate(overrides: Partial<PatternInsightCandidate> = {}): PatternInsightCandidate {
  return {
    snapshot: snapshot(),
    reviewState: "unreviewed",
    currentReview: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("buildSubmitReviewBody — the exact allowed request body", () => {
  it("contains exactly the 7 freshness dimensions + decision + reviewerNote, never anything else", () => {
    const body = buildSubmitReviewBody(snapshot(), "accepted_as_insight", "a note");
    expect(Object.keys(body).sort()).toEqual(
      ["decision", "detectorRuleId", "detectorRuleVersion", "insightKind", "insightProjectorVersion", "rangeFromDate", "rangeToDate", "reviewerNote", "sourceEvidenceRefs"].sort()
    );
  });

  it("never includes athleteId", () => {
    const body = buildSubmitReviewBody(snapshot(), "dismissed", null);
    expect("athleteId" in body).toBe(false);
  });

  it("never includes candidateSnapshot/candidate/candidate_snapshot", () => {
    const body = buildSubmitReviewBody(snapshot(), "dismissed", null);
    expect("candidateSnapshot" in body).toBe(false);
    expect("candidate" in body).toBe(false);
    expect("candidate_snapshot" in body).toBe(false);
  });

  it("never includes title/statement/counts/ratios/caveats", () => {
    const body = buildSubmitReviewBody(snapshot(), "dismissed", null) as unknown as Record<string, unknown>;
    for (const forbidden of ["title", "statement", "caveats", "evidenceCount", "supportingCount", "contradictingCount", "neutralCount", "supportingRatio", "contradictingRatio", "neutralRatio", "evidenceBalance", "direction"]) {
      expect(forbidden in body).toBe(false);
    }
  });

  it("passes reviewerNote through exactly (null stays null, string stays the string)", () => {
    expect(buildSubmitReviewBody(snapshot(), "accepted_as_insight", null).reviewerNote).toBeNull();
    expect(buildSubmitReviewBody(snapshot(), "accepted_as_insight", "hello").reviewerNote).toBe("hello");
  });
});

describe("getInsights", () => {
  it("parses a successful response with candidates", async () => {
    invoke.mockResolvedValue({ data: { range: { fromDate: "1900-01-01", toDate: "9999-12-31" }, candidates: [candidate()] }, error: null });
    const result = await getInsights();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.candidates).toHaveLength(1);
  });

  it("parses an empty candidates array as a valid, successful response (not an error)", async () => {
    invoke.mockResolvedValue({ data: { range: { fromDate: "1900-01-01", toDate: "9999-12-31" }, candidates: [] }, error: null });
    const result = await getInsights();
    expect(result).toEqual({ ok: true, data: { range: { fromDate: "1900-01-01", toDate: "9999-12-31" }, candidates: [] } });
  });

  it("fails safely (invalid_response) on a malformed/unexpected response shape", async () => {
    invoke.mockResolvedValue({ data: { unexpected: true }, error: null });
    const result = await getInsights();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_response");
  });

  it("fails safely on a candidate with an invalid reviewState", async () => {
    invoke.mockResolvedValue({
      data: { range: { fromDate: "1900-01-01", toDate: "9999-12-31" }, candidates: [{ ...candidate(), reviewState: "bogus_state" }] },
      error: null,
    });
    const result = await getInsights();
    expect(result.ok).toBe(false);
  });

  it("maps a real HTTP error through mapInsightsError", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(403, { error: { code: "no_athlete_for_user" } }) });
    const result = await getInsights();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("no_athlete_for_user");
  });

  it("calls get-insights with GET and no body/params", async () => {
    invoke.mockResolvedValue({ data: { range: { fromDate: "1900-01-01", toDate: "9999-12-31" }, candidates: [] }, error: null });
    await getInsights();
    expect(invoke).toHaveBeenCalledWith("get-insights", { method: "GET" });
  });
});

describe("submitReview", () => {
  const body = buildSubmitReviewBody(snapshot(), "accepted_as_insight", null);

  it("parses a successful {action, reviewNumber} response", async () => {
    invoke.mockResolvedValue({ data: { review: { action: "inserted", reviewNumber: 1 } }, error: null });
    const result = await submitReview(body);
    expect(result).toEqual({ ok: true, data: { action: "inserted", reviewNumber: 1 } });
  });

  it("fails safely on a malformed success body", async () => {
    invoke.mockResolvedValue({ data: { review: { action: "bogus", reviewNumber: 1 } }, error: null });
    const result = await submitReview(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("other");
  });

  it("stale_candidate: returns the fresh candidate to the UI layer, distinguishable by kind", async () => {
    const fresh = candidate({ snapshot: snapshot({ evidenceCount: 2 }) });
    invoke.mockResolvedValue({ data: null, error: httpError(409, { error: { code: "stale_candidate", message: "..." }, candidate: fresh }) });
    const result = await submitReview(body);
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "stale_candidate") {
      expect(result.candidate.snapshot.evidenceCount).toBe(2);
    } else {
      throw new Error(`expected stale_candidate, got ${JSON.stringify(result)}`);
    }
  });

  it("stale_candidate with a malformed candidate payload never trusted as real — falls back to invalid_response", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(409, { error: { code: "stale_candidate" }, candidate: { not: "a real candidate" } }) });
    const result = await submitReview(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("other");
      expect(result.error.code).toBe("invalid_response");
    }
  });

  it("candidate_not_found is distinguishable from stale_candidate and other errors", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(404, { error: { code: "candidate_not_found", message: "..." } }) });
    const result = await submitReview(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("candidate_not_found");
  });

  it("internal_error is sanitized, kind=other", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(500, { error: { code: "internal_error", message: "raw postgres detail" } }) });
    const result = await submitReview(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("other");
      expect(result.error.message).not.toMatch(/postgres/i);
    }
  });

  it("network failure is sanitized, kind=other, retryable", async () => {
    const { FunctionsFetchError } = await import("@supabase/supabase-js");
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError("Failed to fetch")) });
    const result = await submitReview(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("other");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("calls submit-review with exactly the built body, no method override needed (defaults to POST)", async () => {
    invoke.mockResolvedValue({ data: { review: { action: "unchanged", reviewNumber: 1 } }, error: null });
    await submitReview(body);
    expect(invoke).toHaveBeenCalledWith("submit-review", { body });
  });
});
