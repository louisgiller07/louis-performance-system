/**
 * TrainingIntervention — représentation interne riche d'une intervention
 * d'entraînement. Voir docs/05_DATA_MODEL.md §TrainingIntervention et
 * docs/07_GLOSSARY.md.
 *
 * Discriminated union sur `kind` : certains `kind` ont une intensité
 * réellement variable (HEAVY/MODERATE/LIGHT change le sens de la séance et,
 * pour les kinds de type force, le mapping DbSessionType — voir
 * docs/05_DATA_MODEL.md §Mapping). D'autres `kind` n'ont pas de notion
 * d'intensité coach-pertinente (REST, MOBILITY, RECOVERY_ACTIVE,
 * BIKE_MAINTENANCE, RACE_ACTIVITY — l'intensité de RACE_ACTIVITY est dictée
 * par la course, pas par un choix de coaching). Rendre `load_profile`
 * obligatoire pour ces derniers serait artificiel ; le type l'exclut donc
 * pour eux plutôt que de le rendre optionnel partout.
 */
export type LoadProfile = "HEAVY" | "MODERATE" | "LIGHT";

export type LoadVariableKind =
  | "STRENGTH_LOWER"
  | "STRENGTH_UPPER"
  | "STRENGTH_FULL_LIGHT"
  | "POWER"
  | "GRIP_WORK"
  | "AEROBIC_BASE"
  | "AEROBIC_INTERVALS"
  | "DH_TECHNICAL"
  | "DH_PERFORMANCE"
  | "DH_LIGHT"
  | "PUMPTRACK";

export type FixedLoadKind =
  | "MOBILITY"
  | "RECOVERY_ACTIVE"
  | "REST"
  | "BIKE_MAINTENANCE"
  | "RACE_ACTIVITY";

export type TrainingInterventionKind = LoadVariableKind | FixedLoadKind;

interface TrainingInterventionCommon {
  duration_min?: number;
  focus?: string;
  cue?: string;
}

export interface LoadVariableIntervention extends TrainingInterventionCommon {
  kind: LoadVariableKind;
  load_profile: LoadProfile;
}

export interface FixedLoadIntervention extends TrainingInterventionCommon {
  kind: FixedLoadKind;
  load_profile?: undefined;
}

export type TrainingIntervention = LoadVariableIntervention | FixedLoadIntervention;

const FIXED_LOAD_KINDS: ReadonlySet<FixedLoadKind> = new Set([
  "MOBILITY",
  "RECOVERY_ACTIVE",
  "REST",
  "BIKE_MAINTENANCE",
  "RACE_ACTIVITY",
]);

export function isFixedLoadKind(kind: TrainingInterventionKind): kind is FixedLoadKind {
  return FIXED_LOAD_KINDS.has(kind as FixedLoadKind);
}

/** Type guard sur l'intervention elle-même (pas seulement `kind`) — nécessaire pour que
 * TypeScript affine correctement le type discriminé lors des mises à jour de `load_profile`. */
export function isFixedLoadIntervention(t: TrainingIntervention): t is FixedLoadIntervention {
  return isFixedLoadKind(t.kind);
}

/** Compare deux interventions par `kind` + `load_profile` (ignore duration/focus/cue). */
export function sameIntervention(a: TrainingIntervention, b: TrainingIntervention): boolean {
  return a.kind === b.kind && a.load_profile === b.load_profile;
}

/** Réduit l'intensité d'un cran (HEAVY→MODERATE→LIGHT). Reste LIGHT si déjà LIGHT. */
export function downgradeLoadProfile(load: LoadProfile): LoadProfile {
  if (load === "HEAVY") return "MODERATE";
  if (load === "MODERATE") return "LIGHT";
  return "LIGHT";
}

/** Réduit l'intensité de `t` d'un cran ; no-op si `t` n'a pas de `load_profile` pertinent. */
export function withDowngradedLoad(t: TrainingIntervention): TrainingIntervention {
  if (isFixedLoadIntervention(t)) return t;
  return { ...t, load_profile: downgradeLoadProfile(t.load_profile) };
}
