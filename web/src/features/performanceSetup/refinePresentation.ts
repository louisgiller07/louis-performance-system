// UX-10B-1 — every word of "Affiner ton profil", in one place. A coach
// getting to know the rider better, never a settings screen: each section
// shows what NALYNT already knows, one [Modifier], one save. Only data the
// app really stores is shown or asked (no bike, suspension or spots).

export type RefineSectionId = "practice" | "terrain" | "equipment" | "strengths" | "slots" | "preparation";

export const REFINE_PAGE = {
  kicker: "Profil",
  title: "Affiner ton profil",
  // Never "NALYNT te connaît / apprend": it uses what the rider declares.
  intro: "Plus ton profil est précis, plus ta préparation correspond à ta réalité.",
  planNote: "Ton plan actuel reste inchangé : tes réglages servent à construire ta prochaine préparation.",
  loadError: "Impossible de charger ton profil. Réessaie.",
} as const;

export const SECTION_TITLES: Record<RefineSectionId, string> = {
  practice: "Ta pratique",
  terrain: "Ton terrain",
  equipment: "Ton matériel",
  strengths: "Tes points forts",
  slots: "Tes créneaux",
  preparation: "Ta préparation",
};

export const ACTIONS = {
  edit: "Modifier",
  save: "Enregistrer",
  saving: "Enregistrement…",
  cancel: "Annuler",
  close: "Fermer",
  saved: "Enregistré.",
  rebuildHint: "Ton plan actuel reste inchangé. Reconstruis ta préparation pour en tenir compte.",
  rebuildLink: "Aller à ta préparation ↓",
  genericError: "Une erreur inattendue s'est produite. Réessaie.",
} as const;

export const PRACTICE = {
  discipline: "Ta discipline",
  level: "Ton niveau",
  goal: "Ton objectif principal",
  hours: "Ton temps par semaine",
  ridingDays: "Tes jours de roulage",
  ridingDaysHint: "Au moins un.",
  seasonObjective: "Ton objectif de saison (facultatif)",
  seasonObjectivePlaceholder: "Ex. : top 10 aux Championnats suisses",
  summaryGoal: (goal: string) => `Objectif : ${goal}`,
  summaryHours: (hours: string, days: string) => `${hours} par semaine · roule ${days}`,
  summarySeason: (objective: string) => `Objectif de saison : ${objective}`,
} as const;

export const TERRAIN = {
  question: "Sur quels terrains peux-tu rouler ?",
  hint: "Au moins un : tes séances techniques en dépendent.",
  none: "Aucun terrain renseigné — ajoute-en au moins un pour tes séances techniques.",
} as const;

export const EQUIPMENT = {
  question: "Le matériel de renfo auquel tu as accès",
  bodyweight: "Au poids du corps",
  hint: "Rien de coché : tes séances de renfo se font au poids du corps.",
} as const;

export const STRENGTHS = {
  strengths: "Tes points forts",
  weaknesses: "À travailler",
  priorities: "Tes priorités de pilotage",
  tier: "Ton expérience en renfo",
  summaryStrengths: (list: string) => `Points forts : ${list}`,
  summaryWeaknesses: (list: string) => `À travailler : ${list}`,
  summaryPriorities: (list: string) => `Priorités : ${list}`,
  summaryTier: (tier: string) => `Renfo : ${tier}`,
  noPriorities: "Aucune priorité de pilotage : NALYNT fait tourner les thèmes techniques.",
} as const;

export const SLOTS = {
  none: "Aucun créneau : ta préparation ne peut pas être construite sans au moins un jour.",
} as const;

export const PREPARATION = {
  build: "Construire ma préparation",
  rebuild: "Reconstruire ma préparation",
  description: "NALYNT construit une nouvelle version de ta préparation avec ton profil et tes créneaux. Tu décides ensuite si tu la commences.",
  descriptionFirst: "NALYNT construit ta préparation avec ton profil et tes créneaux.",
  question: "Combien de temps veux-tu préparer ton objectif ?",
  notReady: "Enregistre ou annule ta modification en cours avant de construire ta préparation.",
} as const;

export const PLAN_DURATIONS = [4, 6, 8, 12] as const;
export const DEFAULT_PLAN_WEEKS = 6;

export const DAY_SHORT: Record<number, string> = { 1: "lun.", 2: "mar.", 3: "mer.", 4: "jeu.", 5: "ven.", 6: "sam.", 0: "dim." };

export function hoursLabel(time: string): string {
  const [hh, mm] = time.split(":");
  return mm === "00" ? `${Number(hh)} h` : `${Number(hh)} h ${mm}`;
}
