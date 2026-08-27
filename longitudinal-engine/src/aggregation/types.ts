/**
 * M5_006D — deterministic effective-evidence aggregation result shapes.
 * Consumes ONLY `pattern_evidence_current_effective` rows (see
 * aggregateEffectivePatternEvidence.ts's own doc for the full boundary).
 *
 * This milestone produces DESCRIPTIVE ARITHMETIC only — counts, ratios, and
 * a balance label derived purely from `eventType` tallies. It never
 * decides that a pattern is "confirmed", never computes a confidence
 * score or statistical significance, never infers causation, and never
 * activates a coaching rule. `observedValue` is opaque here: no field of
 * this module's output is derived from it, and `PatternEvidenceCurrentEffectiveRow.observedValue`
 * is typed `unknown` specifically so this package cannot accidentally read
 * a detector-specific field without an explicit (and out-of-scope) cast.
 * Those interpretations belong to a future milestone / human review
 * (M5_007), never here.
 */
import type { DateRange } from "../types/adapter.js";

export type PatternEvidenceEventType = "supporting" | "contradicting" | "neutral";

/** One `pattern_evidence_current_effective` row, mapped to camelCase — the ONLY shape this package ever reads. */
export interface PatternEvidenceCurrentEffectiveRow {
  readonly identityId: string;
  readonly athleteId: string;
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly supersedesId: string | null;
  readonly eventType: PatternEvidenceEventType;
  readonly eventDate: string;
  /** Opaque — never read by aggregation. Typed `unknown`, not `Record<string, unknown>`, so no property access compiles without an explicit cast. */
  readonly observedValue: unknown;
  readonly revisionCreatedAt: string;
}

/** Exactly 7 fields (M5_006D lock) — never more, never fewer. */
export interface PatternEvidenceAggregateSourceRef {
  readonly identityId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventType: PatternEvidenceEventType;
  readonly eventDate: string;
}

/**
 * Descriptive arithmetic label only — NEVER pattern validation, NEVER a
 * claim that the pattern is real/confirmed/actionable. See B6/B8 lock in
 * aggregateEffectivePatternEvidence.ts for the exact derivation.
 */
export type PatternEvidenceBalance =
  | "neutral_only"
  | "supporting_only"
  | "contradicting_only"
  | "supporting_majority"
  | "contradicting_majority"
  | "balanced";

/** Exactly 17 fields (M5_006D lock) — no confidence/score/significance/recommendation/activation/accepted-rejected state. Those belong to later milestones. */
export interface PatternEvidenceAggregate {
  readonly athleteId: string;

  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;

  readonly rangeFromDate: string;
  readonly rangeToDate: string;

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

export interface AggregateEffectivePatternEvidenceInput {
  readonly athleteId: string;
  readonly range: DateRange;
  readonly evidence: readonly PatternEvidenceCurrentEffectiveRow[];
}
