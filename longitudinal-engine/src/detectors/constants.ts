/**
 * Frozen recommendation_vs_actual_execution detector identity. Never
 * derived from package.json, a git hash, the current date, a source row
 * revision, or the environment — a source-row edit is never a reason to
 * bump this (same discipline as calculators/constants.ts's
 * CALCULATOR_ID/CALCULATOR_VERSION). Bump the version constant only when
 * the classification semantics themselves change.
 *
 * Detector-specific public names (not generic `DETECTOR_RULE_ID`/
 * `DETECTOR_RULE_VERSION`): `detectors/**` is expected to host multiple
 * detector modules over time, each with its own frozen identity — a
 * package-root-level generic name would collide the moment a second
 * detector is added. Local code inside this module may still alias these
 * to a short generic name for readability, since that alias never crosses
 * the module boundary.
 */
export const RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID = "recommendation_vs_actual_execution";
export const RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION = "1.0.0";
