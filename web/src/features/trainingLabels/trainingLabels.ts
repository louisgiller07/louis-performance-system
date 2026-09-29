// REV-015.2 — the one place that turns training identifiers (engine enums,
// catalogue ids) into athlete-facing French. Presentation only: the stored
// identifiers are never changed, so already-generated plans are translated
// at display time too.
//
// Existing tables are reused, never copied (single source of truth):
// - session kinds: TRAINING_KIND_LABELS (dailyPlan/dailyPlanLabels.ts), all
//   16 values of the DB enum plan_session_kind / TrainingInterventionKind;
// - skills and terrains: TECHNICAL_PRIORITY_LABELS / TERRAIN_LABELS
//   (performanceSetup/performanceSetupOptions.ts), the same vocabulary as the
//   drill catalogue's skillTarget / terrainRequirement.
// Only the two vocabularies with no table yet are defined here: dose-target
// domains (planning-engine SessionDoseTarget.domain) and week types (DB enum
// plan_week_type).
//
// Every translate* function returns `null` for an unknown/empty value — a
// raw identifier is never returned; the caller decides whether to hide the
// element or use UNKNOWN_SESSION_LABEL.
import { TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import { TECHNICAL_PRIORITY_LABELS, TERRAIN_LABELS } from "../performanceSetup/performanceSetupOptions";

/** Neutral wording for a session whose kind is not recognized — never the raw identifier. */
export const UNKNOWN_SESSION_LABEL = "Séance d'entraînement";

/** Same wording as the Programme "Volume" line ("force · DH · aérobie · repos"). */
export const DOMAIN_LABELS: Readonly<Record<string, string>> = {
  strength: "Force",
  dh_technical: "DH",
  aerobic: "Aérobie",
  recovery: "Récupération",
};

/** All 5 values of the DB enum plan_week_type. Short labels: the week header already reads "Semaine N". */
export const WEEK_TYPE_LABELS: Readonly<Record<string, string>> = {
  development: "Développement",
  taper: "Affûtage",
  race: "Course",
  deload: "Allègement",
  recovery: "Récupération",
};

/** Own keys only — an inherited name ("toString", "constructor") never matches. */
function ownLabel(table: Readonly<Record<string, string>>, value: unknown): string | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(table, value) ? table[value]! : null;
}

export function translateTrainingKind(kind: unknown): string | null {
  return ownLabel(TRAINING_KIND_LABELS, kind);
}

export function translateDomain(domain: unknown): string | null {
  return ownLabel(DOMAIN_LABELS, domain);
}

export function translateWeekType(weekType: unknown): string | null {
  return ownLabel(WEEK_TYPE_LABELS, weekType);
}

export function translateSkill(skill: unknown): string | null {
  return ownLabel(TECHNICAL_PRIORITY_LABELS, skill);
}

export function translateTerrain(terrain: unknown): string | null {
  return ownLabel(TERRAIN_LABELS, terrain);
}

/** "1 répétition" / "8 répétitions" / "8-12 répétitions" — the French replacement for the former "reps". */
export function formatRepetitions(reps: number): string {
  return `${reps} ${reps === 1 ? "répétition" : "répétitions"}`;
}

export function formatRepetitionRange(min: number, max: number): string {
  return `${min}-${max} répétitions`;
}
