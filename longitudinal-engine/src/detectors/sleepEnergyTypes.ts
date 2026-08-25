/**
 * M5_006B sleep_quality_to_same_day_energy_correlation detector result
 * shapes. Pure facts, same philosophy as detectors/types.ts (M5_005): this
 * answers "does this candidate day's same-day sleep/energy pairing sit at
 * matching or opposing extremes of this athlete's own 60-day baseline" —
 * a descriptive correlation only, never causal, never a coaching
 * recommendation, never "was this good/bad".
 */

/** The one and only rule identity this module ever produces — literal, not `string`. */
export type SleepEnergyRuleId = "sleep_quality_to_same_day_energy_correlation";

export type DetectorEventType = "supporting" | "contradicting" | "neutral";

/** Empirical-midrank quintile bucket — see sleepQualityToSameDayEnergyCorrelation.ts's ranking implementation (B7 lock). */
export type SleepEnergyBucket = "Q1" | "Q2" | "Q3" | "Q4" | "Q5";

/** Rating histogram over the 0-10 inclusive scale (daily_checkins.sleep_quality/.energy's own DB CHECK range) — index i = count of baseline observations with that exact rating. */
export type RatingHistogram = readonly [
  number, number, number, number, number, number,
  number, number, number, number, number,
];

export type SleepEnergyConfounderReason = "fever_or_illness" | "suspected_concussion";

/** Exactly 2 fields (B11 lock) — no other IDs. */
export interface SleepEnergySourceRefs {
  readonly evaluationCheckinId: string;
  /** DISTINCT union of checkins contributing sleepQuality OR energy to the baseline, sorted ascending by id. */
  readonly baselineCheckinIds: readonly string[];
}

/** Exactly 18 fields (B10 lock) — never more, never fewer. */
export interface SleepEnergyObservedValue {
  readonly evaluationCheckinId: string;
  readonly evaluationCheckinDate: string;
  readonly sleepQuality: number;
  readonly energy: number;
  readonly sleepPercentile: number;
  readonly energyPercentile: number;
  readonly sleepBucket: SleepEnergyBucket;
  readonly energyBucket: SleepEnergyBucket;
  readonly baselineWindowStartDate: string;
  readonly baselineWindowEndDate: string;
  readonly sleepBaselineObservationCount: number;
  readonly energyBaselineObservationCount: number;
  readonly sleepBaselineDistinctValueCount: number;
  readonly energyBaselineDistinctValueCount: number;
  readonly sleepBaselineHistogram: RatingHistogram;
  readonly energyBaselineHistogram: RatingHistogram;
  readonly rankingMethod: "empirical_midrank_v1";
  readonly confounderReasons: readonly SleepEnergyConfounderReason[];
}

export interface SleepEnergyEvidence {
  readonly kind: "evidence";
  readonly detectorRuleId: SleepEnergyRuleId;
  readonly detectorRuleVersion: string;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventType: DetectorEventType;
  readonly eventDate: string;
  readonly observedValue: SleepEnergyObservedValue;
  readonly sourceRefs: SleepEnergySourceRefs;
}

export type SleepEnergyNoEvidenceReason =
  | "evaluation_checkin_missing_sleep_quality"
  | "evaluation_checkin_missing_energy"
  | "insufficient_baseline_data"
  | "baseline_variance_insufficient";

/** Exactly 8 fields (B12 lock) — including evidenceKey, unlike M5_005's NoEvidence (both Evidence AND NoEvidence carry stable keys here — B3 lock). */
export interface SleepEnergyNoEvidence {
  readonly kind: "no_evidence";
  readonly detectorRuleId: SleepEnergyRuleId;
  readonly detectorRuleVersion: string;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventDate: string;
  readonly evaluationCheckinId: string;
  readonly reason: SleepEnergyNoEvidenceReason;
}

/** Canonical public result type — the one name every consumer imports. */
export type SleepEnergyDetection = SleepEnergyEvidence | SleepEnergyNoEvidence;
