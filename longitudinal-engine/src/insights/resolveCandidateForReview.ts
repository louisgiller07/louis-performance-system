/**
 * V0.3_001C — pure candidate resolution for `submit-review`. No Supabase, no
 * clock, no randomness, no persistence — same purity boundary as every
 * other module in this package.
 *
 * Two conceptually separate steps, composed into one result:
 *
 * 1. SELECTOR — locates the current logical candidate the browser's token
 *    refers to, by `detectorRuleId` alone (never `detectorRuleVersion`/
 *    `insightKind` — their divergence must still resolve to "stale", never
 *    "not found"; see docs/06_ARCHITECTURE.md's "Sélecteur de candidat et
 *    cardinalité"). 0 matches -> not_found; exactly 1 -> proceed to
 *    freshness; more than 1 -> invariant_violation (the canonical
 *    projection is supposed to expose at most one current candidate per
 *    athlete+detectorRuleId — never resolved by picking array[0]/first/
 *    sort order).
 * 2. FRESHNESS — once exactly one candidate is selected, compares it
 *    against the browser's 7-dimension token via the SAME `fingerprintMatches`
 *    comparator `buildPatternInsightCandidates` itself uses for
 *    `reviewed_current`/`reviewed_stale` — never a second, duplicated
 *    comparator.
 */
import { fingerprintMatches } from "./buildPatternInsightCandidates.js";
import type { PatternInsightCandidate, PatternInsightReviewFreshnessDimensions } from "./types.js";

/**
 * Exactly the 7 locked freshness dimensions the browser may supply — never
 * `athleteId` (server scope, injected below, not part of this type at all —
 * see `PatternInsightReviewFreshnessDimensions`'s own doc).
 */
export type ReviewFreshnessRequest = PatternInsightReviewFreshnessDimensions;

export type CandidateResolutionResult =
  | { readonly status: "not_found" }
  | { readonly status: "matched"; readonly candidate: PatternInsightCandidate }
  | { readonly status: "stale"; readonly candidate: PatternInsightCandidate }
  | { readonly status: "invariant_violation"; readonly matchCount: number };

/** Selector only — every current candidate whose `detectorRuleId` matches. Never filters on `detectorRuleVersion`/`insightKind`. */
export function selectCurrentCandidatesByDetectorRuleId(candidates: readonly PatternInsightCandidate[], detectorRuleId: string): readonly PatternInsightCandidate[] {
  return candidates.filter((candidate) => candidate.snapshot.detectorRuleId === detectorRuleId);
}

/**
 * Selector + freshness, combined. `athleteId` is the server-resolved
 * athlete (never browser-supplied) — required only to satisfy
 * `fingerprintMatches`' shared comparator signature; it is not part of the
 * request the browser sends.
 */
export function resolveCandidateForReview(candidates: readonly PatternInsightCandidate[], athleteId: string, request: ReviewFreshnessRequest): CandidateResolutionResult {
  const matches = selectCurrentCandidatesByDetectorRuleId(candidates, request.detectorRuleId);

  if (matches.length === 0) {
    return { status: "not_found" };
  }
  if (matches.length > 1) {
    return { status: "invariant_violation", matchCount: matches.length };
  }

  const candidate = matches[0]!;
  const fresh = fingerprintMatches(candidate.snapshot, { ...request, athleteId });
  return fresh ? { status: "matched", candidate } : { status: "stale", candidate };
}
