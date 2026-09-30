// UX-09 — every word of the first run ("Ton premier jour avec NALYNT"), in
// one place (same discipline as afterSessionPresentation / coachInsights).
// A coach getting to know a rider, never a configuration tool: one question
// per screen, the promise first, the fine settings later ("Affiner ton
// profil"). Nothing here claims NALYNT learns by itself; it builds the plan
// from what the rider declares.

/** The four chapters shown above every first-run screen. */
export const CHAPTERS = ["Qui es-tu ?", "Ton objectif", "Ton entraînement", "Ton plan"] as const;
export type Chapter = 0 | 1 | 2 | 3;

export const SHELL = {
  back: "Retour",
  next: "Continuer",
  saving: "Enregistrement…",
  loading: "Chargement…",
} as const;

export const WELCOME = {
  kicker: "Bienvenue dans NALYNT",
  title: ["Ton objectif reste.", "Ton plan s'adapte."],
  promise: "NALYNT construit ta préparation autour de ton objectif, de ton niveau et de ton temps. Chaque jour, il ajuste ta séance à ton état.",
  inMinutes: "En quelques minutes :",
  essentials: ["Ton objectif", "Ton niveau", "Ta réalité quotidienne"],
  builds: "NALYNT construit ta préparation.",
  nameQuestion: "Comment tu t'appelles ?",
  nameLabel: "Ton prénom et ton nom",
  start: "Commencer",
  creating: "Création…",
} as const;

export const ONBOARDING_STEPS = {
  discipline: { chapter: 0 as Chapter, title: "Ta discipline", question: "Qu'est-ce que tu roules ?" },
  level: { chapter: 0 as Chapter, title: "Ton niveau", question: "Où en es-tu aujourd'hui ?" },
  goal: { chapter: 1 as Chapter, title: "Ton objectif", question: "Sur quoi NALYNT doit-il t'aider en priorité ?" },
  hours: { chapter: 1 as Chapter, title: "Ton temps", question: "Combien de temps peux-tu consacrer à ta progression chaque semaine ?" },
  ridingDays: { chapter: 2 as Chapter, title: "Tes jours de roulage", question: "Quand roules-tu généralement ?", hint: "Sélectionne tous les jours qui s'appliquent." },
  consent: { chapter: 2 as Chapter, title: "Tes données", question: "Ton état du jour (sommeil, fatigue, douleurs) sert à adapter tes séances." },
} as const;

export function greeting(firstName: string | null): string {
  return firstName ? `${firstName}, construisons ta préparation.` : "Construisons ta préparation.";
}

export const SETUP_STEPS = {
  training: {
    chapter: 2 as Chapter,
    title: "Tes créneaux",
    question: "Quand peux-tu t'entraîner ?",
    hint: "Préremplis avec tes jours de roulage. Ajoute les jours de renfo ou de mobilité.",
    slotQuestion: "En général, tu t'entraînes plutôt :",
    customStart: "Début",
    customEnd: "Fin",
    later: "Tu pourras régler chaque jour plus tard.",
  },
  terrain: { chapter: 2 as Chapter, title: "Ton terrain", question: "Sur quels terrains peux-tu rouler ?", hint: "Au moins un. Ta première séance technique en dépend." },
  // UX-11A.5a.2b — declared DH technical tier + 1–3 ordered priorities.
  // Self-assessment wording: PROVISIONAL — coaching validation required.
  technique: {
    chapter: 2 as Chapter,
    title: "Ton pilotage",
    question: "Ton niveau technique en descente ?",
    prioritiesQuestion: "Sur quoi veux-tu progresser en priorité ?",
    prioritiesHint: "1 à 3 choix. L'ordre compte : ton premier choix est ta priorité n°1.",
    rank: (n: number) => `Priorité n°${n}`,
  },
  strength: {
    chapter: 2 as Chapter,
    title: "Ton renfo",
    question: "Ton expérience en préparation physique ?",
    equipmentQuestion: "Ton matériel (facultatif)",
    equipmentHint: "Rien de coché : tes séances de renfo se font au poids du corps.",
  },
  preparation: {
    chapter: 3 as Chapter,
    title: "Ta préparation",
    question: "Combien de temps veux-tu préparer cet objectif ?",
    objectiveLabel: "Ton objectif de saison, en une phrase (facultatif)",
    objectivePlaceholder: "Ex. : top 10 aux Championnats suisses",
    weeks: (n: number) => `${n} semaines`,
    build: "Construire ma préparation",
  },
} as const;

/** A typical training window, shown with its exact hours (what is stored). */
export const TIME_SLOTS = [
  { id: "morning", label: "Matin", start: "08:00", end: "12:00" },
  { id: "afternoon", label: "Après-midi", start: "13:00", end: "17:00" },
  { id: "evening", label: "Soir", start: "17:00", end: "21:00" },
  { id: "day", label: "Toute la journée", start: "08:00", end: "18:00" },
] as const;
export const CUSTOM_SLOT = "Autre plage";

export function slotHours(start: string, end: string): string {
  const h = (time: string) => {
    const [hh, mm] = time.split(":");
    return mm === "00" ? `${Number(hh)} h` : `${Number(hh)} h ${mm}`;
  };
  return `${h(start)} – ${h(end)}`;
}

/** Monday first; keyed by the DB day of week (0 = Sunday). */
export const DAY_SHORT: Record<number, string> = { 1: "Lun", 2: "Mar", 3: "Mer", 4: "Jeu", 5: "Ven", 6: "Sam", 0: "Dim" };
export const DAY_FULL: Record<number, string> = { 1: "Lundi", 2: "Mardi", 3: "Mercredi", 4: "Jeudi", 5: "Vendredi", 6: "Samedi", 0: "Dimanche" };

export const PLAN_DURATIONS = [4, 6, 8, 12] as const;
export const DEFAULT_PLAN_WEEKS = 6;

export const BUILDING = {
  kicker: "Ton plan",
  title: "NALYNT prépare ta saison…",
  checklist: ["Ton objectif", "Ton niveau", "Tes disponibilités", "Ton terrain", "Ta préparation"],
  done: "Ton plan est construit autour de ta réalité.",
  retry: "Réessayer",
  fixSetup: "Modifier mon terrain ou mon renfo",
} as const;

export const READY = {
  kicker: "Ton plan",
  title: "Ton premier plan est prêt",
  preparation: "Préparation",
  week1: "Semaine 1",
  nextSessions: "Tes prochaines séances",
  weeks: (n: number) => `${n} semaine${n > 1 ? "s" : ""}`,
  promise: ["Ton objectif reste.", "Ton plan s'adapte."],
  start: "Commencer ma préparation",
  starting: "Lancement…",
} as const;

export const FIRST_DAY = {
  kicker: "Ton premier jour avec NALYNT",
  title: "Comment tu te sens aujourd'hui ?",
  text: "Ton check-in permet à NALYNT d'adapter ta première séance à ton état.",
} as const;

export const TODAY_NO_PLAN = {
  title: "Ta préparation commence ici",
  text: "Quelques questions sur ton entraînement, et NALYNT construit ton premier plan.",
  cta: "Construire ma préparation",
} as const;

export const REFINE = {
  title: "Affiner ton profil",
  subtitle: "Points forts, priorités de pilotage, matériel, créneaux jour par jour : tout ce qui rend ton plan plus précis.",
} as const;
