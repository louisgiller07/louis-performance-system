// A09 — every word of « Tes courses » (Affiner ton profil), in one place.
// Only what the engine really uses is asked: a name, dates, an importance and
// a format whose pre-race behaviour exists (2 / 3 days) or is honestly absent
// (« Autre format »). Never a self-service « Reconstruire » here (HPM: during
// the beta, the preparation is rebuilt by NALYNT).
import { RACE_FORMAT_LABELS } from "../trainingLabels/raceLabels";

export type RacePriority = "A_PLUS" | "A" | "B" | "C";

/** A+ stays readable for existing races; a new race is A, B or C only. */
export const NEW_RACE_PRIORITIES = ["A", "B", "C"] as const satisfies readonly RacePriority[];

/** The formats with a defined engine behaviour: M1's T-X tables (2 / 3 days) or none (OTHER). */
export const NEW_RACE_FORMATS = ["HOT_TRAIL_2DAY", "IXS_3DAY", "OTHER"] as const;
export type NewRaceFormat = (typeof NEW_RACE_FORMATS)[number];

/** A 2-day / 3-day format IS its duration: the end date follows the start date. */
export const RACE_FORMAT_DAYS: Readonly<Partial<Record<string, number>>> = { HOT_TRAIL_2DAY: 2, IXS_3DAY: 3 };

export const PRIORITY_OPTION_LABELS: Readonly<Record<RacePriority, string>> = {
  A_PLUS: "A+",
  A: "A — objectif principal",
  B: "B — course importante",
  C: "C — course secondaire / entraînement",
};

export const FORMAT_OPTION_LABELS: Readonly<Record<NewRaceFormat, string>> = {
  HOT_TRAIL_2DAY: "Course sur 2 jours (entraînements + course)",
  IXS_3DAY: "Course sur 3 jours (practice officielle la veille)",
  OTHER: "Autre format",
};

/** Any stored format (an existing SWISS_CUP / UCI one included), never shown raw; null = not specified. */
export function formatLabel(format: string | null): string {
  if (format === null) return "Format non précisé";
  if ((NEW_RACE_FORMATS as readonly string[]).includes(format)) return FORMAT_OPTION_LABELS[format as NewRaceFormat];
  return RACE_FORMAT_LABELS[format] ?? "Autre format";
}

export const RACES = {
  title: "Tes courses",
  none: "Aucune course à venir.",
  add: "Ajouter une course",
  recent: "Courses récentes",
  name: "Nom de la course",
  start: "Début",
  end: "Fin",
  endFromFormat: "La fin suit le format choisi.",
  priority: "Importance",
  format: "Format",
  otherFormatHint: "Pas d'affûtage spécifique automatique les jours précédents.",
  existing: "(existant)",
  edit: "Modifier",
  delete: "Supprimer",
  confirmDelete: (name: string) => `Supprimer « ${name} » ?`,
  confirm: "Confirmer",
  cancel: "Annuler",
  save: "Enregistrer",
  saving: "Enregistrement…",
  saved:
    "Ta course est prise en compte dès maintenant dans ton coaching quotidien. Pendant la bêta, contacte-nous si tu veux que nous reconstruisions aussi ta préparation autour de cette course.",
  deleted: "Course supprimée.",
  loadError: "Impossible de charger tes courses. Réessaie.",
  saveError: "Impossible d'enregistrer la course. Réessaie.",
  deleteError: "Impossible de supprimer la course. Réessaie.",
  errors: {
    name: "Donne un nom à ta course.",
    dates: "Indique les dates de la course.",
    order: "La fin doit être le même jour que le début ou après.",
    past: "Cette course est déjà terminée : ajoute une course à venir.",
    duration: (days: number) => `Une course sur ${days} jours dure ${days} jours : ajuste les dates.`,
  },
} as const;
