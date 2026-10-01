/**
 * UX-11A.5b.2 — stable codes that block a whole V2 plan generation before
 * any write (ADR UX-11A.5b.0.1). Raised by the pure builders (UX-11A.5b.3:
 * DH and AEROBIC_BASE); generationEngine is not wired yet. No partial V2
 * plan, no fallback, no clamping.
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

/**
 * UX-11A.5b.3 — a locked V2 block: the input is legitimate but the V2
 * content cannot be built for it (missing declared data, unsupported
 * duration, unavailable terrain…). Never corrected automatically.
 */
export class SessionModelV2GenerationBlockedError extends Error {
  constructor(
    public readonly code: SessionModelV2GenerationBlockCode,
    public readonly detail: Readonly<Record<string, unknown>> = {}
  ) {
    super(`Session Model V2 generation blocked: ${code}`);
    this.name = "SessionModelV2GenerationBlockedError";
  }
}

/**
 * UX-11A.5b.3 — a programming / contract error (wrong session kind for a
 * builder, invalid ordinal, unknown skill, ambiguous catalogue…): never a
 * sport rule, never something to fall back from.
 */
export class SessionModelV2ContractError extends Error {
  constructor(message: string) {
    super(`Session Model V2 contract error: ${message}`);
    this.name = "SessionModelV2ContractError";
  }
}
