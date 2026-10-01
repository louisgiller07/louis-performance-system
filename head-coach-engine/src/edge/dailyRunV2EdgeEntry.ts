// UX-11A.5c.3.1 — bundle entry for the V2 path of the daily-run Edge Function
// (built by `npm run build:edge` into dist/edge/dailyRunV2.bundle.js). Deno has
// no import map for `planning-engine/session-model-v2/daily`: esbuild inlines
// it (same source, nothing copied). daily-run loads this bundle lazily, only
// when the current plan version is v2; the V1 path never loads it.
// sportFingerprint is exported for the Node / bundle parity test only.
export { reconcileFinalPrescriptionV2 } from "../supabase/dailyV2/reconcileFinalPrescriptionV2.js";
export { sportFingerprint } from "planning-engine/session-model-v2/daily";
