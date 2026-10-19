// A09 — every word of « Tes courses » (Affiner ton profil), in one place.
// Only what the engine really uses is asked: a name, dates, an importance and
// the competition (SPORT-RACE-01P.3: its circuit / organizer, from which the
// event format follows — raceProtocol.ts; never a duration standing for a
// protocol). Never a self-service « Reconstruire » here (HPM: during the beta,
// the preparation is rebuilt by NALYNT).

export type RacePriority = "A_PLUS" | "A" | "B" | "C";

/** A+ stays readable for existing races; a new race is A, B or C only. */
export const NEW_RACE_PRIORITIES = ["A", "B", "C"] as const satisfies readonly RacePriority[];

/**
 * The two protocol formats have a fixed duration: the end date follows the start date. SPORT-RACE-01P.3: the format is
 * no longer chosen as a duration — it follows the competition (raceProtocol.ts).
 */
export const RACE_FORMAT_DAYS: Readonly<Partial<Record<string, number>>> = { HOT_TRAIL_2DAY: 2, IXS_3DAY: 3 };

export const PRIORITY_OPTION_LABELS: Readonly<Record<RacePriority, string>> = {
  A_PLUS: "A+",
  A: "A — objectif principal",
  B: "B — course importante",
  C: "C — course secondaire / entraînement",
};


export const RACES = {
  title: "Tes courses",
  none: "Aucune course à venir.",
  add: "Ajouter une course",
  recent: "Courses récentes",
  name: "Nom de la course",
  start: "Début",
  end: "Fin",
  endFromFormat: "La fin suit le format de cette compétition.",
  priority: "Importance",
  competition: "Compétition",
  competitionPlaceholder: "Choisis la compétition",
  protocolHint: (protocol: string) => `Préparation spécifique : les 7 jours avant la course suivent le protocole ${protocol}.`,
  noProtocolHint: "Préparation spécifique non définie pour cette compétition : NALYNT ne planifie pas de séance les jours qui la précèdent.",
  clarifyHint: "Compétition à préciser : choisis-la dans la liste. D'ici là, NALYNT ne planifie pas de préparation spécifique pour cette course.",
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
    competition: "Choisis la compétition.",
    dates: "Indique les dates de la course.",
    order: "La fin doit être le même jour que le début ou après.",
    past: "Cette course est déjà terminée : ajoute une course à venir.",
    duration: (days: number) => `Cette compétition dure ${days} jours : ajuste les dates.`,
  },
} as const;
