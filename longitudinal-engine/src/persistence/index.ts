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
