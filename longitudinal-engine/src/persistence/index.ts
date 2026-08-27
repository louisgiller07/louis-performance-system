/**
 * M5_006A public surface: the M5_005 evidence persistence adapter and its
 * result shapes. DB interaction is confined to this directory — no
 * detector or relation module imports Supabase.
 *
 * No package-owned error class here: a failed persist_pattern_evidence RPC
 * call propagates the exact error object the Supabase client itself
 * returned, unwrapped (see recommendationVsActualAdapter.ts) — never
 * parsed, never reduced to code/message, never rewrapped.
 */
export { persistRecommendationVsActualEvidence } from "./recommendationVsActualAdapter.js";
export type { PersistRecommendationVsActualEvidenceParams } from "./recommendationVsActualAdapter.js";
export type { PersistPatternEvidenceAdapterResult, PersistPatternEvidenceAction } from "./types.js";

// M5_006B — generic lifecycle RPC adapters (detector-agnostic) + result shapes.
export { transitionPatternEvidenceLifecycle, persistActivePatternEvidence } from "./lifecycleAdapter.js";
export type { TransitionPatternEvidenceLifecycleParams, PersistActivePatternEvidenceParams } from "./lifecycleAdapter.js";
export type {
  PatternEvidenceLifecycleState,
  TransitionPatternEvidenceLifecycleAction,
  TransitionPatternEvidenceLifecycleResult,
  PersistActivePatternEvidenceEvidenceAction,
  PersistActivePatternEvidenceLifecycleAction,
  PersistActivePatternEvidenceResult,
} from "./lifecycleTypes.js";

// M5_006B — sleep-energy detector's own persistence adapter.
export { persistSleepEnergyEvidence } from "./sleepEnergyAdapter.js";
export type { PersistSleepEnergyEvidenceParams, PersistSleepEnergyEvidenceResult, SleepEnergyNoEvidenceAction } from "./sleepEnergyAdapter.js";

// M5_006C — pain-persistence detector's own persistence adapter.
export { persistPainPersistenceEvidence } from "./painPersistenceAdapter.js";
export type { PersistPainPersistenceEvidenceParams, PersistPainPersistenceEvidenceResult, PainPersistenceNoEvidenceAction } from "./painPersistenceAdapter.js";

// M5_007 — human-review ledger write adapter.
export { persistPatternInsightReview } from "./insightReviewAdapter.js";
export type { PersistPatternInsightReviewParams, PersistPatternInsightReviewAction, PersistPatternInsightReviewResult } from "./insightReviewAdapter.js";
