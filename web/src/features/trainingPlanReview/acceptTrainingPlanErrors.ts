import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// What the UI can actually do about an error — never a hardcoded coaching
// or safety decision, just a UX category. Same vocabulary as dailyRunErrors.ts.
export type AcceptTrainingPlanErrorAction = "session_issue" | "retry" | "generic";

export interface AcceptTrainingPlanError {
  code: string;
  message: string;
  retryable: boolean;
  action: AcceptTrainingPlanErrorAction;
}

function genericError(code: string): AcceptTrainingPlanError {
  return { code, message: "Une erreur inattendue s'est produite. Réessaie.", retryable: true, action: "retry" };
}

// Canonical codes from supabase/functions/accept-training-plan/errorMapping.ts
// (V0.5_012/014) — not invented. `invalid_request` should never happen from
// this client (it always sends exactly { planVersionId }), so it falls
// through to a generic message rather than getting a dedicated one.
function mapHttpBody(status: number, code: string | undefined): AcceptTrainingPlanError {
  if (status === 401) {
    return { code: code ?? "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" };
  }
  switch (code) {
    case "no_athlete_for_user":
      return {
        code,
        message: "Configuration manquante : aucun profil athlète associé à ton compte.",
        retryable: false,
        action: "generic",
      };
    case "accept_rejected":
      return { code, message: "Ce plan ne peut pas être accepté dans son état actuel.", retryable: false, action: "generic" };
    case "invalid_request":
      return { code, message: "Requête invalide.", retryable: false, action: "generic" };
    case "internal_error":
      return { code, message: "Une erreur inattendue s'est produite côté serveur. Réessaie.", retryable: true, action: "retry" };
    default:
      return genericError(code ?? "unknown_http_error");
  }
}

/**
 * Maps a `supabase.functions.invoke("accept-training-plan")` error to a
 * frontend-safe, structured error. Never surfaces SQL, stack traces, or raw
 * backend internals — only the canonical `code`/`message` pair the Edge
 * Function itself returns, or a generic message for anything else. Same
 * pattern as dailyRunErrors.ts's mapDailyRunError.
 */
export async function mapAcceptTrainingPlanError(error: unknown): Promise<AcceptTrainingPlanError> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let code: string | undefined;
    try {
      const body = await response.json();
      if (body && typeof body === "object" && "error" in body) {
        const inner = (body as { error?: unknown }).error;
        if (inner && typeof inner === "object" && "code" in inner && typeof (inner as { code?: unknown }).code === "string") {
          code = (inner as { code: string }).code;
        }
      }
    } catch {
      // Body wasn't JSON (or empty) — fall through to status-based mapping.
    }
    return mapHttpBody(response.status, code);
  }

  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return { code: "network_error", message: "Problème de connexion. Vérifie ta connexion et réessaie.", retryable: true, action: "retry" };
  }

  return genericError("unknown_error");
}
