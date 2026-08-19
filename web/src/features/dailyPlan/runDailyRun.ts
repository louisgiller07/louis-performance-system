// Invokes the real remote Edge Function supabase/functions/daily-run. The
// existing authenticated Supabase client already attaches the signed-in
// user's JWT as `Authorization` and the public key as `apikey` on every
// `functions.invoke` call (see @supabase/functions-js FunctionsClient) —
// nothing is added manually here. The request body is exactly `{ date }`;
// never `athlete_id` — the athlete is resolved server-side via RLS.
import { supabase } from "../../lib/supabase";
import { mapDailyRunError, type DailyRunError } from "./dailyRunErrors";
import { isValidDailyRunResponse } from "./dailyPlanValidation";
import type { DailyRunResponse } from "./dailyPlanTypes";

export type RunDailyRunResult = { ok: true; data: DailyRunResponse } | { ok: false; error: DailyRunError };

const EMPTY_RESPONSE_ERROR: DailyRunError = {
  code: "empty_response",
  message: "Réponse vide du serveur. Réessaie.",
  retryable: true,
  action: "retry",
};

const INVALID_RESPONSE_ERROR: DailyRunError = {
  code: "invalid_response",
  message: "Réponse du serveur invalide. Réessaie.",
  retryable: true,
  action: "retry",
};

export async function runDailyRun(date: string): Promise<RunDailyRunResult> {
  // `unknown`, not `<DailyRunResponse>` — the generic only affects the TS
  // type, never what actually arrives on the wire. isValidDailyRunResponse
  // is what actually earns the DailyRunResponse type below.
  const { data, error } = await supabase.functions.invoke<unknown>("daily-run", {
    body: { date },
  });

  if (error) {
    return { ok: false, error: await mapDailyRunError(error) };
  }

  if (!data) {
    return { ok: false, error: EMPTY_RESPONSE_ERROR };
  }

  if (!isValidDailyRunResponse(data)) {
    return { ok: false, error: INVALID_RESPONSE_ERROR };
  }

  return { ok: true, data };
}
