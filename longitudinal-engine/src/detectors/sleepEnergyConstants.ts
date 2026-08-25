/**
 * Frozen sleep_quality_to_same_day_energy_correlation detector identity.
 * Same discipline as constants.ts's RECOMMENDATION_VS_ACTUAL_EXECUTION_*
 * pair — never derived from package.json, a git hash, the current date, a
 * source-row revision, or the environment. Bump the version constant only
 * when the classification/ranking semantics themselves change.
 */
export const SLEEP_ENERGY_RULE_ID = "sleep_quality_to_same_day_energy_correlation";
export const SLEEP_ENERGY_RULE_VERSION = "1.0.0";

/** Locked ranking method identity — see sleepQualityToSameDayEnergyCorrelation.ts's empirical-midrank implementation. */
export const SLEEP_ENERGY_RANKING_METHOD = "empirical_midrank_v1";

/** Baseline window length in days (C-60 .. C-1, C itself excluded). */
export const SLEEP_ENERGY_BASELINE_WINDOW_DAYS = 60;

/** Minimum independent observations required in EACH distribution (sleep, energy) before ranking is attempted. */
export const SLEEP_ENERGY_MIN_BASELINE_OBSERVATIONS = 21;

/** Minimum distinct values required in EACH distribution — a baseline with zero variance cannot support a meaningful percentile. */
export const SLEEP_ENERGY_MIN_BASELINE_DISTINCT_VALUES = 2;
