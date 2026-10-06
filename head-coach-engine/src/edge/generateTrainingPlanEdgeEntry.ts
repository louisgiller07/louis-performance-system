// Bundle entry for the generate-training-plan Edge Function (built by `npm run build:edge`).
// GenerationBlockedError / NoCompatibleDrillError / NoCompatibleExerciseError are re-exported
// from the same bundle so errorMapping's `instanceof` sees the exact classes the bundled
// generation throws.
export { generateAndPersistTrainingPlan } from "../supabase/generateAndPersistTrainingPlan.js";
export { GenerationBlockedError, type GenerationBlockedReason } from "planning-engine";
export { NoCompatibleDrillError, NoCompatibleExerciseError } from "prescription-engine";
// UX-11R.2 — server-side planning model choice (global switch + athlete assignment) and the single
// generation entry calling the validated V1 or V2 path; the V2 path is bundled here, no copy of any catalogue.
export { generateTrainingPlanForAthlete, planningResolutionOf, type GenerateTrainingPlanForAthleteResult } from "../generation/generateTrainingPlanForAthlete.js";
export { parseV2PlanGenerationFlag, PlanningModelAssignmentReadError, V2_PLAN_GENERATION_FLAG } from "../generation/planningModelRollout.js";
// BUG-V2-3 — the product calendar (Europe/Zurich "today"), never the UTC date.
export { productToday } from "../supabase/productCalendar.js";
