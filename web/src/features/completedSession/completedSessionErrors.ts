import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

export type CompletedSessionErrorAction = "user_fixable" | "config_issue" | "retry" | "session_issue" | "generic";

export interface CompletedSessionError {
  code: string;
  message: string;
  retryable: boolean;
  action: CompletedSessionErrorAction;
}

function genericError(code: string): CompletedSessionError {
  return { code, message: "Une erreur inattendue s'est produite. Réessaie.", retryable: true, action: "retry" };
}

// Canonical codes from supabase/functions/completed-session/validation.ts +
// index.ts — not invented. The 400 validation codes should never actually
// reach this client (validateCompletedSessionForm runs first), but they are
// still mapped defensively rather than falling through as an unlabeled
// generic error.
function mapHttpBody(status: number, code: string | undefined): CompletedSessionError {
  if (status === 401) {
    return { code: code ?? "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" };
  }
  switch (code) {
    case "no_athlete_for_user":
      return {
        code,
        message: "Configuration manquante : aucun profil athlète associé à ton compte.",
        retryable: false,
        action: "config_issue",
      };
    case "decision_link_invalid":
      return {
        code,
        message: "La décision liée n'est plus valide pour cette date. Recharge la page et réessaie.",
        retryable: false,
        action: "user_fixable",
      };
    case "decision_session_mismatch":
      return {
        code,
        message: "Le statut et le type de séance ne correspondent pas à la séance liée.",
        retryable: false,
        action: "user_fixable",
      };
    case "persistence_failed":
    case "persistence_readback_missing":
    case "internal_error":
      return { code, message: "Erreur d'enregistrement côté serveur. Réessaie.", retryable: true, action: "retry" };
    case "invalid_body":
    case "unknown_field":
    case "forbidden_field":
    case "invalid_enum":
    case "invalid_range":
    case "invalid_body_for_status":
    case "invalid_pain_shape":
    case "missing_date":
    case "invalid_date_format":
      return { code, message: "Le formulaire contient une valeur invalide. Vérifie les champs.", retryable: false, action: "user_fixable" };
    default:
      return genericError(code ?? "unknown_http_error");
  }
}

/** Maps a `supabase.functions.invoke` error for completed-session to a frontend-safe, structured error — never surfaces SQL, stack traces, or raw backend internals. */
export async function mapCompletedSessionError(error: unknown): Promise<CompletedSessionError> {
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
