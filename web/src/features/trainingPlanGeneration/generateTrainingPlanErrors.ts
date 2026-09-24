import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// What the UI can actually do about an error — never a hardcoded coaching
// or safety decision, just a UX category. Same vocabulary as
// dailyPlan/dailyRunErrors.ts's DailyRunErrorAction — deliberately
// re-declared here rather than imported: web has no shared build boundary
// between feature folders (same "Option A" precedent already applied by
// trainingPlanReview/acceptTrainingPlanErrors.ts, which re-declares its own
// subset locally instead of importing from dailyPlan/).
export type GenerateTrainingPlanErrorAction = "user_fixable" | "config_issue" | "retry" | "session_issue" | "generic";

export interface GenerateTrainingPlanError {
  code: string;
  message: string;
  retryable: boolean;
  action: GenerateTrainingPlanErrorAction;
}

function genericError(code: string): GenerateTrainingPlanError {
  return { code, message: "Une erreur inattendue s'est produite. Réessaie.", retryable: true, action: "retry" };
}

// Canonical GenerationBlockedError reasons from
// supabase/functions/generate-training-plan/errorMapping.ts's own
// MESSAGE_FOR_BLOCKED_REASON (V0.5_023) — not invented. Same closed-mapping
// discipline: a 5th reason added later without updating this map still
// resolves safely via the fallback message below, never a crash. Never a
// navigation instruction here (ticket-locked scope) — only a message the
// future component can act on.
//
// PILOT_015 — no_compatible_drill / no_compatible_exercise are the same kind
// of user-fixable 422: a valid setup for which the catalogue has no DH drill
// (plan priority × experience × terrain) or strength exercise (equipment ×
// experience).
const MESSAGE_FOR_BLOCKED_REASON: Partial<Record<string, string>> = {
  missing_availability: "Ajoute au moins un jour de disponibilité.",
  missing_performance_profile: "Complète et enregistre ton profil de performance.",
  missing_discipline: "Sélectionne ta discipline.",
  missing_strength_experience_tier: "Indique ton expérience en préparation physique.",
  no_compatible_drill:
    "Aucun exercice technique ne correspond à ta priorité pour ce plan, ton expérience et tes terrains. Choisis une autre priorité pour ce plan ou ajoute des terrains accessibles, enregistre, puis réessaie.",
  no_compatible_exercise:
    "Ton équipement ne permet pas de construire toutes les séances de force. Ajoute le matériel dont tu disposes, enregistre, puis réessaie.",
};

// Canonical codes from supabase/functions/generate-training-plan/index.ts +
// errorMapping.ts (V0.5_023, contract minimized V0.5_032) — not invented.
// `invalid_request` should never happen from this client (local validation
// rejects malformed input before the network call — see
// generateTrainingPlan.ts's validateInput), so it falls through to a
// generic message rather than getting a dedicated one — same discipline as
// acceptTrainingPlanErrors.ts's mapHttpBody.
function mapHttpBody(status: number, code: string | undefined): GenerateTrainingPlanError {
  if (status === 401) {
    return { code: code ?? "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" };
  }
  if (status === 403 && code === "no_athlete_for_user") {
    return {
      code,
      message: "Configuration manquante : aucun profil athlète associé à ton compte.",
      retryable: false,
      action: "config_issue",
    };
  }
  if (status === 422) {
    // GenerationBlockedError — data validly absent, always user-fixable.
    // An unrecognized reason still gets a safe, generic "incomplete
    // configuration" message rather than falling through to the unrelated
    // default case below.
    return {
      code: code ?? "generation_blocked",
      message: (code ? MESSAGE_FOR_BLOCKED_REASON[code] : undefined) ?? "Ta configuration athlète est incomplète pour générer un plan d'entraînement.",
      retryable: false,
      action: "user_fixable",
    };
  }
  switch (code) {
    case "invalid_request":
      return { code, message: "Requête invalide.", retryable: false, action: "generic" };
    case "internal_error":
      return {
        code,
        message: "La génération du plan a rencontré une erreur. Réessaie ou contacte le support si le problème continue.",
        retryable: true,
        action: "retry",
      };
    default:
      return genericError(code ?? "unknown_http_error");
  }
}

/**
 * Maps a `supabase.functions.invoke("generate-training-plan")` error to a
 * frontend-safe, structured error. Never surfaces SQL, stack traces, or raw
 * backend internals — only the canonical `code`/`message` pair the Edge
 * Function itself returns, or a generic message for anything else. Same
 * pattern as dailyRunErrors.ts/acceptTrainingPlanErrors.ts's mapping
 * functions. Checks both the flat `{code,message}` gateway-level body (a
 * 401 from withSupabase's own auth wrapper, before this endpoint's handler
 * ever runs — same real-world shape daily-run's own mapDailyRunError
 * already had to account for) and the nested `{error:{code,message}}` body
 * this endpoint's own errorResponse() always returns.
 */
export async function mapGenerateTrainingPlanError(error: unknown): Promise<GenerateTrainingPlanError> {
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
