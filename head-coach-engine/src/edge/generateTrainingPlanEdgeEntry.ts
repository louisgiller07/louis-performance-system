// Bundle entry for the generate-training-plan Edge Function (built by `npm run build:edge`).
// GenerationBlockedError is re-exported from the same bundle so errorMapping's `instanceof`
// sees the exact class the bundled generation throws.
export { generateAndPersistTrainingPlan } from "../supabase/generateAndPersistTrainingPlan.js";
export { GenerationBlockedError, type GenerationBlockedReason } from "planning-engine";
