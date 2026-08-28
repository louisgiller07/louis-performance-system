/**
 * M5_007 — deterministic insight projection over M5_006D aggregates, plus
 * the human-review candidate/state shapes layered on top. Pure types only:
 * no Supabase, no clock, no randomness anywhere in this module.
 *
 * Architectural boundary (see buildPatternInsightCandidates.ts's own doc for
 * the full account): an insight is a deterministic, human-readable
 * PROJECTION of an M5_006D aggregate — never a confidence score, never a
 * significance test, never a causal claim, never a coaching activation.
 * `PatternInsightReviewDecision.accepted_as_insight` records ONLY that a
 * human accepted the insight's wording/framing; it never flows into
 * `daily-run`, never activates anything, and carries no confidence.
 */
import type { PatternEvidenceAggregateSourceRef, PatternEvidenceBalance } from "../aggregation/types.js";

/** Exactly the three supported detector/version → insight projections (M5_007 lock). */
export type PatternInsightKind =
  | "recommendation_execution_alignment"
  | "sleep_energy_same_day_association"
  | "pain_persistence_between_recent_checkins";

/** Derived purely from `PatternEvidenceBalance` — see DIRECTION_MAP in buildPatternInsightCandidates.ts. No thresholds, no other math. */
export type PatternInsightDirection = "supporting" | "contradicting" | "mixed" | "neutral";

/**
 * Exactly 23 fields (M5_007 lock) — no confidence/score/significance,
 * no activation/acceptance state (that lives in the review ledger, never
 * here). `sourceEvidenceRefs` is passed through verbatim from the
 * originating `PatternEvidenceAggregate` (already deterministically sorted).
 */
export interface PatternInsightSnapshot {
  readonly insightProjectorVersion: string;
  readonly athleteId: string;
  readonly insightKind: PatternInsightKind;
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly rangeFromDate: string;
  readonly rangeToDate: string;
  readonly direction: PatternInsightDirection;
  readonly title: string;
  readonly statement: string;
  readonly caveats: readonly string[];
  readonly evidenceCount: number;
  readonly supportingCount: number;
  readonly contradictingCount: number;
  readonly neutralCount: number;
  readonly directionalEvidenceCount: number;
  readonly supportingRatio: number | null;
  readonly contradictingRatio: number | null;
  readonly neutralRatio: number;
  readonly evidenceBalance: PatternEvidenceBalance;
  readonly firstEventDate: string;
  readonly lastEventDate: string;
  readonly sourceEvidenceRefs: readonly PatternEvidenceAggregateSourceRef[];
}

/**
 * Human review decision — EXACTLY these three values. There is no
 * `active`/`activated`/`applied_to_coaching`/`confidence` value: a decision
 * records a human's read of the insight's wording, never a coaching action.
 */
export type PatternInsightReviewDecision = "accepted_as_insight" | "dismissed" | "needs_more_evidence";

/** Derived candidate review state — never persisted itself, always recomputed from the current review row (if any) against the freshly-built snapshot's fingerprint. */
export type PatternInsightCandidateReviewState = "unreviewed" | "reviewed_current" | "reviewed_stale";

/**
 * The exact 7 locked, browser-facing freshness dimensions (see
 * docs/06_ARCHITECTURE.md "Jeton de fraîcheur de revue complet") —
 * deliberately does NOT include `athleteId`. `athleteId` is always
 * server-resolved (never browser-supplied); a type that included it here
 * would misleadingly suggest a browser could influence it. A structural
 * subset of `PatternInsightSnapshot` (any `PatternInsightSnapshot` already
 * satisfies this type — a pure narrowing, never a behavior change).
 */
export type PatternInsightReviewFreshnessDimensions = Pick<
  PatternInsightSnapshot,
  "detectorRuleId" | "detectorRuleVersion" | "insightKind" | "insightProjectorVersion" | "rangeFromDate" | "rangeToDate" | "sourceEvidenceRefs"
>;

/**
 * What `fingerprintMatches` actually compares at runtime: the 7 freshness
 * dimensions above PLUS `athleteId` — `athleteId` here is a SERVER-SCOPE /
 * athlete-isolation guard, never an eighth browser-supplied freshness
 * dimension. Every real caller (both `buildPatternInsightCandidates`'s own
 * `reviewed_current`/`reviewed_stale` derivation and
 * `resolveCandidateForReview.ts` for `submit-review`) always injects the
 * server-resolved `athleteId` into this shape; a browser-facing request
 * type (see `resolveCandidateForReview.ts`'s `ReviewFreshnessRequest`)
 * never carries this field at all.
 */
export type PatternInsightReviewComparisonKey = PatternInsightReviewFreshnessDimensions & { readonly athleteId: string };

/**
 * One current review-ledger row for one insight identity
 * (athleteId, detectorRuleId, detectorRuleVersion, insightKind) — the exact
 * shape `SupabasePatternInsightReviewAdapter.getCurrentPatternInsightReviews`
 * reads from `pattern_insight_review_current`. `candidateSnapshot` is the
 * EXACT `PatternInsightSnapshot` that was reviewed (persisted verbatim by
 * the write adapter) — never re-derived, never partially reconstructed.
 */
export interface PatternInsightReviewRecord {
  readonly athleteId: string;
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly insightKind: PatternInsightKind;
  readonly decision: PatternInsightReviewDecision;
  readonly reviewNumber: number;
  readonly reviewerNote: string | null;
  readonly candidateSnapshot: PatternInsightSnapshot;
}

/**
 * One aggregate, projected into exactly one insight candidate.
 * `currentReview` is the matching `PatternInsightReviewRecord` (by identity
 * key) when one exists, regardless of whether its fingerprint is still
 * current — `reviewState` is what tells a caller whether to trust it as
 * current. `currentReview` is `null` only when `reviewState` is
 * `unreviewed`.
 */
export interface PatternInsightCandidate {
  readonly snapshot: PatternInsightSnapshot;
  readonly reviewState: PatternInsightCandidateReviewState;
  readonly currentReview: PatternInsightReviewRecord | null;
}
