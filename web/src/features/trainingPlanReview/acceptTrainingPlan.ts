// V0.5_028 — invokes the real remote Edge Function
// supabase/functions/accept-training-plan. Same pattern as
// dailyPlan/runDailyRun.ts exactly: the existing authenticated Supabase
// client already attaches the signed-in user's JWT/apikey on every
// `functions.invoke` call — nothing added manually here. The request body
// is exactly `{ planVersionId }`; never `athleteId` — the athlete is
// resolved server-side via RLS.
import { supabase } from "../../lib/supabase";
import { mapAcceptTrainingPlanError, type AcceptTrainingPlanError } from "./acceptTrainingPlanErrors";

export interface AcceptTrainingPlanResponse {
  planVersionId: string;
  idempotentReplay: boolean;
}

export type AcceptTrainingPlanResult =
  | { ok: true; data: AcceptTrainingPlanResponse }
  | { ok: false; error: AcceptTrainingPlanError };

const EMPTY_RESPONSE_ERROR: AcceptTrainingPlanError = {
  code: "empty_response",
  message: "Réponse vide du serveur. Réessaie.",
  retryable: true,
  action: "retry",
};

const INVALID_RESPONSE_ERROR: AcceptTrainingPlanError = {
  code: "invalid_response",
  message: "Réponse du serveur invalide. Réessaie.",
  retryable: true,
  action: "retry",
};

function isValidAcceptTrainingPlanResponse(value: unknown): value is AcceptTrainingPlanResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.planVersionId === "string" && typeof obj.idempotentReplay === "boolean";
}

export async function acceptTrainingPlan(planVersionId: string): Promise<AcceptTrainingPlanResult> {
  const { data, error } = await supabase.functions.invoke<unknown>("accept-training-plan", {
    body: { planVersionId },
  });

  if (error) {
    return { ok: false, error: await mapAcceptTrainingPlanError(error) };
  }

  if (!data) {
    return { ok: false, error: EMPTY_RESPONSE_ERROR };
  }

  if (!isValidAcceptTrainingPlanResponse(data)) {
    return { ok: false, error: INVALID_RESPONSE_ERROR };
  }

  return { ok: true, data };
}
