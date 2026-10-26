import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { TECHNICAL_PRIORITY_LABELS, TERRAIN_LABELS, type TechnicalPriority, type Terrain } from "../performanceSetup/performanceSetupOptions";

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
/**
 * P0 first generation — the V2 terrain refusal: which priority, at the rider's level, needs which
 * terrain. Honest by design: add a terrain ONLY if really accessible, otherwise change the priority.
 */
export function unavailableTerrainMessage(detail: { skill?: unknown; requiredTerrain?: unknown; compatibleTerrains?: unknown } | undefined): string {
  const skill = typeof detail?.skill === "string" ? TECHNICAL_PRIORITY_LABELS[detail.skill as TechnicalPriority] : undefined;
  const listed = Array.isArray(detail?.compatibleTerrains) ? detail.compatibleTerrains : [detail?.requiredTerrain];
  const terrains = listed.map((t) => (typeof t === "string" ? TERRAIN_LABELS[t as Terrain] : undefined)).filter((t): t is string => Boolean(t)).map((t) => `« ${t} »`);
  if (skill && terrains.length === 1) {
    return `Pour travailler « ${skill} » à ton niveau, le programme a besoin du terrain ${terrains[0]}, qui ne fait pas partie de tes terrains. Ajoute-le seulement si tu y as réellement accès ; sinon, choisis une autre priorité pour ce plan.`;
  }
  if (skill && terrains.length > 1) {
    return `Pour travailler « ${skill} » à ton niveau, le programme a besoin d'un de ces terrains : ${terrains.slice(0, -1).join(", ")} ou ${terrains.at(-1)}. Aucun ne fait partie de tes terrains. Ajoute-en un seulement si tu y as réellement accès ; sinon, choisis une autre priorité pour ce plan.`;
  }
  return "Aucun exercice technique de ton niveau ne correspond à ta priorité sur tes terrains. Ajoute un terrain seulement si tu y as réellement accès ; sinon, choisis une autre priorité pour ce plan.";
}

/**
 * V2-DH-ATTRIBUTION-01 — the V2 refusal for a DH drill whose repetition unit (section or full descent) is not validated
 * yet, or a full descent without the track's descent time: NALYNT's own gap. The rider has nothing to change.
 */
export function dhUnitRefusalMessage(code: "dh_repetition_unit_unknown" | "dh_full_run_needs_track_data", detail: { skill?: unknown } | undefined): string {
  const skill = typeof detail?.skill === "string" ? TECHNICAL_PRIORITY_LABELS[detail.skill as TechnicalPriority] : undefined;
  const drill = skill ? `L'exercice technique prévu pour « ${skill} » à ton niveau` : "Un exercice technique de ton programme";
  const why =
    code === "dh_full_run_needs_track_data"
      ? "se répète en descentes complètes, et NALYNT ne connaît pas encore la durée de descente de ta piste"
      : "n'a pas encore d'unité validée (section ou descente complète) : NALYNT ne fixe pas de nombre de passages sans elle";
  return `Ton programme ne peut pas encore être créé. ${drill} ${why}. Ton profil n'est pas en cause : tu n'as rien à modifier.`;
}

function mapHttpBody(status: number, code: string | undefined, detail?: { skill?: unknown; requiredTerrain?: unknown; compatibleTerrains?: unknown }): GenerateTrainingPlanError {
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
  if (status === 422 && code === "unavailable_dh_drill_terrain") {
    return { code, message: unavailableTerrainMessage(detail), retryable: false, action: "user_fixable" };
  }
  if (status === 422 && (code === "dh_repetition_unit_unknown" || code === "dh_full_run_needs_track_data")) {
    return { code, message: dhUnitRefusalMessage(code, detail), retryable: false, action: "config_issue" };
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
  // A09 — paid-beta guard: an athlete assigned V2 while V2 generation is off is refused (never served V1).
  if (code === "v2_generation_disabled") {
    return {
      code,
      message: "Pendant la bêta, nous reconstruisons ta préparation avec toi. Contacte-nous pour la mettre à jour.",
      retryable: false,
      action: "config_issue",
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
    let detail: { skill?: unknown; requiredTerrain?: unknown; compatibleTerrains?: unknown } | undefined;
    try {
      const body = await response.json();
      const innerDetail = body && typeof body === "object" && "error" in body ? (body as { error?: { detail?: unknown } }).error?.detail : undefined;
      if (innerDetail && typeof innerDetail === "object") detail = innerDetail as { skill?: unknown; requiredTerrain?: unknown; compatibleTerrains?: unknown };
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
    return mapHttpBody(response.status, code, detail);
  }

  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return { code: "network_error", message: "Problème de connexion. Vérifie ta connexion et réessaie.", retryable: true, action: "retry" };
  }

  return genericError("unknown_error");
}
