/**
 * SPORT-PLAN-03 V2 contracts (HPM 2026-10-25) — non-prescriptive contracts. V2-CONTRACTS-INTEGRATION-01 (HPM
 * 2026-10-26): plan generation and the daily final prescription use the DH unit, duration and RPE contracts through
 * sessionContractChecksV2 only; the progression and race contracts stay dormant (boundary test). Wiring anything
 * else needs its own GO and the canon (docs/05, docs/07).
 */
export * from "./dhRepetitionUnitV2.js";
export * from "./progressionContractV2.js";
export * from "./sessionDurationContractV2.js";
export * from "./raceExposureV2.js";
export * from "./rpeSemanticsV2.js";
export * from "./sessionContractChecksV2.js";
