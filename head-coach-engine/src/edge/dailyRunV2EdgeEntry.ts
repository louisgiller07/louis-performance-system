// UX-11A.5c.3.1 — bundle entry for the V2 path of the daily-run Edge Function
// (built by `npm run build:edge` into dist/edge/dailyRunV2.bundle.js). Deno has
// no import map for `planning-engine/session-model-v2/daily`: esbuild inlines
// it (same source, nothing copied). daily-run loads this bundle lazily, only
// when the current plan version is v2; the V1 path never loads it.
// sportFingerprint is exported for the Node / bundle parity test only.
export { reconcileFinalPrescriptionV2 } from "../supabase/dailyV2/reconcileFinalPrescriptionV2.js";
export { sportFingerprint } from "planning-engine/session-model-v2/daily";
import { validatePrescriptionV2 } from "planning-engine/session-model-v2/daily";

const DH_VALIDATION_ISSUES: readonly string[] = ["dh_unit_not_attributed", "dh_content_not_signed"];

/**
 * V2-DH-SPORT-GATE-01C (HPM 2026-10-26) — whether a stored V2 document may still be executed. session-execution loads
 * this same bundle for its DH validation guard: the same engine code, the same sports validation as the daily run of
 * the same deploy. A DH drill stating a unit is executable only while its validation is current (dhSportGateV2, read
 * through the validator: otherwise dh_unit_not_attributed / dh_content_not_signed). Any other document — V1, another
 * family, a unit-less DH count, one the validator rejects for another reason (left to record_session_execution) — is
 * not this check's concern. Pure: reads nothing.
 */
export function dhSportValidationCurrentV2(structure: unknown): boolean {
  const validation = validatePrescriptionV2(structure, { stage: "final" });
  return validation.ok || !validation.issues.some((issue) => DH_VALIDATION_ISSUES.includes(issue.code));
}
