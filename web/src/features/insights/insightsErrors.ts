import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// What the UI can actually do about an error — never a hardcoded coaching
// or safety decision, just a UX category. Same shape as
// dailyRunErrors.ts/completedSessionErrors.ts.
export type InsightsErrorAction = "user_fixable" | "config_issue" | "retry" | "session_issue" | "generic";

export interface InsightsError {
  code: string;
  message: string;
  retryable: boolean;
  action: InsightsErrorAction;
}

export const INVALID_RESPONSE_ERROR: InsightsError = {
  code: "invalid_response",
  message: "Réponse du serveur invalide. Réessaie.",
  retryable: true,
  action: "retry",
};

function genericError(code: string): InsightsError {
  return { code, message: "Une erreur inattendue s'est produite. Réessaie.", retryable: true, action: "retry" };
}

// Canonical codes from supabase/functions/get-insights/errorMapping.ts and
// supabase/functions/submit-review/{index,errorMapping}.ts — not invented.
// `candidate_not_found`/`stale_candidate` are NOT mapped here: insightsRepo's
// submitReview() intercepts those two codes itself (they carry meaning
// beyond a flat message — stale_candidate also carries a fresh candidate
// payload) BEFORE this generic mapping ever runs for them.
function mapStatusAndCode(status: number, code: string | undefined): InsightsError {
  if (status === 401) {
    return { code: code ?? "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" };
  }
  switch (code) {
    case "no_athlete_for_user":
      return { code, message: "Configuration manquante : aucun profil athlète associé à ton compte.", retryable: false, action: "config_issue" };
    case "invalid_request":
      return { code, message: "Requête invalide. Recharge la page et réessaie.", retryable: true, action: "retry" };
    case "unsupported_insight_projector":
    case "internal_error":
      return { code, message: "Une erreur inattendue s'est produite côté serveur. Réessaie.", retryable: true, action: "retry" };
    default:
      return genericError(code ?? "unknown_http_error");
  }
}

export interface ParsedInvokeError {
  readonly status: number;
  readonly code: string | undefined;
  readonly rawBody: unknown;
}

/**
 * Reads the FunctionsHttpError's Response body EXACTLY ONCE — a Response
 * body stream can only be consumed a single time, so callers (insightsRepo)
 * must call this at most once per error and reuse the result, never call
 * `mapInsightsError` afterward on the SAME error object.
 */
export async function parseFunctionsHttpError(error: FunctionsHttpError): Promise<ParsedInvokeError> {
  const response = error.context as Response;
  let rawBody: unknown = null;
  let code: string | undefined;
  try {
    rawBody = await response.json();
    if (rawBody && typeof rawBody === "object" && "error" in rawBody) {
      const inner = (rawBody as { error?: unknown }).error;
      if (inner && typeof inner === "object" && "code" in inner && typeof (inner as { code?: unknown }).code === "string") {
        code = (inner as { code: string }).code;
      }
    }
  } catch {
    // Body wasn't JSON (or empty) — fall through to status-based mapping.
  }
  return { status: response.status, code, rawBody };
}

export function mapParsedInsightsError(parsed: ParsedInvokeError): InsightsError {
  return mapStatusAndCode(parsed.status, parsed.code);
}

/**
 * Maps a `supabase.functions.invoke` error to a frontend-safe, structured
 * error. Never surfaces SQL, stack traces, or raw backend internals. Do
 * NOT call this a second time on an error already passed through
 * `parseFunctionsHttpError` — use `mapParsedInsightsError` on the already-
 * parsed result instead, to avoid reading the Response body twice.
 */
export async function mapInsightsError(error: unknown): Promise<InsightsError> {
  if (error instanceof FunctionsHttpError) {
    const parsed = await parseFunctionsHttpError(error);
    return mapParsedInsightsError(parsed);
  }

  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return { code: "network_error", message: "Problème de connexion. Vérifie ta connexion et réessaie.", retryable: true, action: "retry" };
  }

  return genericError("unknown_error");
}
