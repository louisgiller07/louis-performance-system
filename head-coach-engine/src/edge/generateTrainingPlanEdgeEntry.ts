// Bundle entry for the generate-training-plan Edge Function (built by `npm run build:edge`).
// GenerationBlockedError / NoCompatibleDrillError / NoCompatibleExerciseError are re-exported
// from the same bundle so errorMapping's `instanceof` sees the exact classes the bundled
// generation throws.
export { generateAndPersistTrainingPlan } from "../supabase/generateAndPersistTrainingPlan.js";
export { GenerationBlockedError, type GenerationBlockedReason } from "planning-engine";
export { NoCompatibleDrillError, NoCompatibleExerciseError } from "prescription-engine";
