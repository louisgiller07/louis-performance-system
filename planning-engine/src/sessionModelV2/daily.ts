/**
 * UX-11A.5c.3.1 — minimal Session Model V2 entry for the DAILY runtime
 * (package subpath `./session-model-v2/daily`). Exposes only what the daily
 * reconciliation needs: the KEEP final prescription module, its validator,
 * the sport fingerprint and the aggregate version. No plan generation
 * (builders, orchestration, dose policy, pipeline) is reachable from here,
 * so a bundle of the daily path stays small. Same source as the full
 * Session Model V2 entry: nothing is duplicated.
 */
export * from "./final/finalPrescriptionV2.js";
export * from "./final/validateKeepFinalPrescriptionV2.js";
export * from "./final/buildKeepFinalPrescriptionV2.js";
export { sportFingerprint } from "./sportFingerprint.js";
export { SESSION_MODEL_V2_AGGREGATE_VERSION } from "./catalogManifest.js";
export type { PrescriptionV2 } from "./prescriptionV2.js";
