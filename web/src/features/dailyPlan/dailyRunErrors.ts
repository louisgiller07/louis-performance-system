import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// What the UI can actually do about an error — never a hardcoded coaching
// or safety decision, just a UX category.
export type DailyRunErrorAction = "user_fixable" | "config_issue" | "retry" | "session_issue" | "generic";

export interface DailyRunError {
  code: string;
  message: string;
  retryable: boolean;
  action: DailyRunErrorAction;
}

function genericError(code: string): DailyRunError {
  return { code, message: "Une erreur inattendue s'est produite. Réessaie.", retryable: true, action: "retry" };
}

// Canonical codes from supabase/functions/daily-run/errorMapping.ts — not
// invented. `invalid_request`/`method_not_allowed` should never happen from
// this client (it always sends exactly {date}), so they fall through to
// the generic case rather than getting a dedicated user-facing message.
function mapHttpBody(status: number, code: string | undefined): DailyRunError {
  if (status === 401) {
    return { code: code ?? "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" };
  }
  switch (code) {
    case "no_checkin_for_date":
      return { code, message: "Enregistre d'abord ton check-in du jour.", retryable: false, action: "user_fixable" };
    case "pain_criteria_missing":
      return { code, message: "Complète les informations sur ta douleur.", retryable: false, action: "user_fixable" };
    case "checkin_incomplete":
      return { code, message: "Ton check-in est incomplet.", retryable: false, action: "user_fixable" };
    case "no_current_training_block":
      return {
        code,
        message: "Configuration manquante : aucun bloc d'entraînement actif. Contacte ton coach.",
        retryable: false,
        action: "config_issue",
      };
    case "no_athlete_for_user":
      return {
        code,
        message: "Configuration manquante : aucun profil athlète associé à ton compte.",
        retryable: false,
        action: "config_issue",
      };
    case "persistence_failed":
      return { code, message: "Erreur d'enregistrement côté serveur. Réessaie.", retryable: true, action: "retry" };
    case "internal_error":
      return { code, message: "Une erreur inattendue s'est produite côté serveur. Réessaie.", retryable: true, action: "retry" };
    default:
      return genericError(code ?? "unknown_http_error");
  }
}

/**
 * Maps a `supabase.functions.invoke` error to a frontend-safe, structured
 * error. Never surfaces SQL, stack traces, or raw backend internals — only
 * the canonical `code`/`message` pair the daily-run handler itself returns
 * (see supabase/functions/daily-run/errorMapping.ts), or a generic message
 * for anything else.
 */
export async function mapDailyRunError(error: unknown): Promise<DailyRunError> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let code: string | undefined;
    try {
      const body = await response.json();
      if (body && typeof body === "object" && "code" in body && typeof body.code === "string") {
        code = body.code;
      } else if (body && typeof body === "object" && "error" in body) {
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
