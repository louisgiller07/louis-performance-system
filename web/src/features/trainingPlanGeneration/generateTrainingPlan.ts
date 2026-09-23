// Invokes the real remote Edge Function supabase/functions/generate-training-plan.
// Same pattern as dailyPlan/runDailyRun.ts and
// trainingPlanReview/acceptTrainingPlan.ts exactly: the existing
// authenticated Supabase client already attaches the signed-in user's
// JWT/apikey on every `functions.invoke` call — nothing added manually
// here. The request body is exactly `{ generationRequestId, durationWeeks }`
// (V0.5_031/032 lock) — never `block`/`athleteId`/`today`/`plannerVersion`/
// `catalogVersion`/`inputSnapshot`/`generationTrigger`: those are internal
// generation details owned entirely by head-coach-engine, never part of
// this endpoint's request contract.
//
// Ownership (V0.5_031's diagram: UI intention -> crypto.randomUUID() ->
// generateTrainingPlan(...)): this file never mints generationRequestId —
// no `crypto.randomUUID()` call exists here, and none should be added. The
// caller (a future component, not built in this ticket) owns the user's
// generation intent and its idempotency key.
import { supabase } from "../../lib/supabase";
import { mapGenerateTrainingPlanError, type GenerateTrainingPlanError } from "./generateTrainingPlanErrors";

export interface GenerateTrainingPlanInput {
  generationRequestId: string;
  durationWeeks: number;
}

export interface GenerateTrainingPlanResponse {
  planVersionId: string;
  idempotentReplay: boolean;
}

export type GenerateTrainingPlanResult =
  | { ok: true; data: GenerateTrainingPlanResponse }
  | { ok: false; error: GenerateTrainingPlanError };

const EMPTY_RESPONSE_ERROR: GenerateTrainingPlanError = {
  code: "empty_response",
  message: "Réponse vide du serveur. Réessaie.",
  retryable: true,
  action: "retry",
};

const INVALID_RESPONSE_ERROR: GenerateTrainingPlanError = {
  code: "invalid_response",
  message: "Réponse du serveur invalide. Réessaie.",
  retryable: true,
  action: "retry",
};

const INVALID_GENERATION_REQUEST_ID_ERROR: GenerateTrainingPlanError = {
  code: "invalid_generation_request_id",
  message: "Requête invalide : identifiant de génération manquant.",
  retryable: false,
  action: "generic",
};

const INVALID_DURATION_WEEKS_ERROR: GenerateTrainingPlanError = {
  code: "invalid_duration_weeks",
  message: "Requête invalide : durée du plan invalide.",
  retryable: false,
  action: "generic",
};

function isValidGenerateTrainingPlanResponse(value: unknown): value is GenerateTrainingPlanResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.planVersionId === "string" && obj.planVersionId.length > 0 && typeof obj.idempotentReplay === "boolean";
}

/**
 * Structural validation only, before the network call — the backend
 * (validateDurationWeeks in the Edge Function, itself trusting
 * head-coach-engine) remains the actual source of truth. Deliberately never
 * validates a maximum durationWeeks or a closed list of allowed values — no
 * such product limit is locked yet (V0.5_031 §2: "décision produit encore
 * nécessaire"), so none is invented here either.
 */
function validateInput(input: GenerateTrainingPlanInput): GenerateTrainingPlanError | null {
  if (typeof input.generationRequestId !== "string" || input.generationRequestId.length === 0) {
    return INVALID_GENERATION_REQUEST_ID_ERROR;
  }
  if (typeof input.durationWeeks !== "number" || !Number.isInteger(input.durationWeeks) || input.durationWeeks < 1) {
    return INVALID_DURATION_WEEKS_ERROR;
  }
  return null;
}

export async function generateTrainingPlan(input: GenerateTrainingPlanInput): Promise<GenerateTrainingPlanResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  // `unknown`, not `<GenerateTrainingPlanResponse>` — the generic only
  // affects the TS type, never what actually arrives on the wire.
  // isValidGenerateTrainingPlanResponse is what actually earns the
  // GenerateTrainingPlanResponse type below.
  const { data, error } = await supabase.functions.invoke<unknown>("generate-training-plan", {
    body: {
      generationRequestId: input.generationRequestId,
      durationWeeks: input.durationWeeks,
    },
  });

  if (error) {
    return { ok: false, error: await mapGenerateTrainingPlanError(error) };
  }

  if (!data) {
    return { ok: false, error: EMPTY_RESPONSE_ERROR };
  }

  if (!isValidGenerateTrainingPlanResponse(data)) {
    return { ok: false, error: INVALID_RESPONSE_ERROR };
  }

  return { ok: true, data };
}
