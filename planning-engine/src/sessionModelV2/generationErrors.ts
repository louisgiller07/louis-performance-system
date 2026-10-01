/**
 * UX-11A.5b.2 — stable codes that block a whole V2 plan generation before
 * any write (ADR UX-11A.5b.0.1). Defined here only: no rule triggers them
 * yet (generationEngine is not wired, 5b.3+). No partial V2 plan, no
 * fallback, no clamping.
 */
export const SESSION_MODEL_V2_GENERATION_BLOCK_CODES = [
  "missing_dh_technical_tier",
  "missing_dh_priority_areas",
  "too_many_dh_priority_areas",
  "duplicate_dh_priority_areas",
  "unavailable_dh_drill_terrain",
  "unsupported_protocol_duration",
  "dh_passes_out_of_range",
] as const;

export type SessionModelV2GenerationBlockCode = (typeof SESSION_MODEL_V2_GENERATION_BLOCK_CODES)[number];
