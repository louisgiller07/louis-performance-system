/**
 * Frozen pain_persistence_across_recent_checkins detector identity. Same
 * discipline as sleepEnergyConstants.ts/constants.ts — never derived from
 * package.json, a git hash, the current date, a source-row revision, or
 * the environment. Bump the version constant only when the classification
 * semantics themselves change.
 */
export const PAIN_PERSISTENCE_RULE_ID = "pain_persistence_across_recent_checkins";
export const PAIN_PERSISTENCE_RULE_VERSION = "1.0.0";

/** Maximum calendar days back from the evaluation checkin (C) that the previous-checkin search (C-1, C-2, C-3, in that order) may look — no checkin older than this is ever consumed. */
export const PAIN_PERSISTENCE_LOOKBACK_DAYS = 3;
