// ART-02 — NALYNT homepage copy (single source for src/components/art/).
// Base: the validated designer reference (NALYNT-design-valide-transmission)
// and ART-01. Honesty rules of content/copy.ts apply: every product statement
// matches shipped behavior.
//
// Scope (HPM, ART-02): downhill (DH) only — enduro is not presented as a
// supported product until validated.
// Deliberately NOT published, pending HPM / owner validation:
// - any free / beta / price wording: no pricing decision is validated;
// - any first-person founder quote: factual project text instead;
// - any statistic or sporting result.
// All demo / week / telemetry values are a fictional example, labelled as such.
// Copy and the use of both photos validated before publication (2026-10).
// V1 accounts (production): the app shows a session's duration window,
// technical objective and reason, not a minute-by-minute breakdown — the demo
// note says the breakdown is indicative; no claim that NALYNT knows track
// sectors.

export const signupHref = "https://app.nalynt.ch/signup";
export const loginHref = "https://app.nalynt.ch/login";

export interface Scenario {
  id: "fresh" | "tired" | "busy";
  label: string;
  hint: string;
  checkin: string;
  /** Short state of the day's decision. */
  status: string;
  summary: string;
  /** The reason, with its decisive factor highlighted: before + key + after. */
  reason: [string, string, string];
  /** The 3 blocks of the session (same roles in every scenario), in minutes. */
  steps: { label: string; minutes: number }[];
  /** Adapted route of the console race line (same command structure in every scenario). */
  route: string;
}

/** The session planned in the programme before the check-in. */
export const PLANNED_MINUTES = 240;

export const formatMinutes = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
};

export const home = {
  meta: {
    title: "NALYNT — Le coach d'entraînement des pilotes de descente",
    description:
      "NALYNT adapte chaque jour ton entraînement de VTT de descente (DH) à ton état, à ton temps disponible et à tes courses. Ton objectif reste. Le plan s'adapte.",
  },

  hero: {
    titleLines: ["Ton objectif reste.", "Le plan s'adapte."],
    lead: "Le coach d'entraînement des pilotes de descente. Ta séance suit ton état, ton temps disponible et tes courses, avec la raison de chaque ajustement.",
    primary: "Découvrir mon plan",
    secondary: "Essayer l'exemple",
    credit: "Louis Giller, pilote Elite DH",
    imageAlt: "Un pilote de VTT descente, dossard 86, lancé sur une piste rocailleuse dans la poussière.",
    lineLabels: { change: "état du jour", goal: "objectif" },
    telemetry: {
      head: "Mardi, exemple",
      rows: [
        ["Check-in", "Jambes lourdes"],
        ["Séance", "DH technique"],
      ] as [string, string][],
      from: "4 h",
      to: "2 h 30",
      status: "Volume ajusté",
    },
  },

  reality: {
    line: "Ta semaine change. Ton programme aussi.",
    factors: ["Fatigue", "Disponibilités", "Courses"],
  },

  acts: {
    start: "Le point de départ",
    daily: "Le coaching quotidien",
    race: "Le jour de course",
  },

  /** Act I — a week built from the rider's inputs (fictional example). */
  start: {
    title: ["Tout part", "de ta saison."],
    lead: "Tes créneaux d'entraînement, tes courses et ton objectif posent le cadre. Ta semaine se construit autour.",
    inputs: [
      { key: "creneaux", label: "Tes créneaux", value: "5 jours sur 7" },
      { key: "course", label: "Tes courses", value: "Course dimanche" },
      { key: "objectif", label: "Ton objectif", value: "Précision en DH" },
    ],
    boardTitle: "Ta semaine",
    exampleTag: "Exemple fictif",
    replay: "Rejouer",
    days: [
      { day: "Lun", slot: true, session: "Renfo bas du corps" },
      { day: "Mar", slot: true, session: "DH technique", today: true },
      { day: "Mer", slot: false, session: "Repos" },
      { day: "Jeu", slot: true, session: "Aérobie" },
      { day: "Ven", slot: false, session: "Entretien vélo" },
      { day: "Sam", slot: true, session: "DH performance" },
      { day: "Dim", slot: true, session: "Course", race: true },
    ],
    note: "Exemple fictif. Ta semaine réelle dépend de ton profil, de tes courses et de tes disponibilités.",
    todayLabel: "aujourd'hui",
    /** Bridge to Act II: the demo is this week's Tuesday. */
    bridge: { text: "Mardi matin, ton check-in recompose la séance du jour.", link: "Voir la séance de mardi" },
  },

  demo: {
    title: ["Un check-in.", "Une séance adaptée."],
    lead: "Choisis un état du jour. La séance se recompose, l'objectif technique reste.",
    pickLabel: "Ton état ce matin",
    day: "Mardi",
    exampleTag: "Exemple fictif",
    mission: "Mission du jour",
    session: "DH technique",
    objective: "Objectif : précision des lignes",
    routeLegend: { planned: "Plan prévu", goal: "Objectif" },
    plannedLabel: "Prévu",
    adaptedLabel: "Proposé",
    removedLabel: "retiré",
    whyLabel: "Pourquoi cette décision ?",
    note: "Exemple fictif, calculé dans ton navigateur. Le découpage est indicatif : dans l'application, ta séance indique sa durée, son objectif et la raison du choix.",
    defaultScenario: "tired" as Scenario["id"],
    plannedRoute: "M 8 40 C 120 40, 220 40, 330 40 S 500 40, 612 40",
    scenarios: [
      {
        id: "fresh",
        label: "En forme",
        hint: "Bonne nuit, journée libre",
        checkin: "Check-in · Bonne forme",
        status: "Séance conservée",
        summary: "Tu es en forme et disponible : la séance prévue est conservée.",
        reason: ["", "État du jour favorable", " et temps disponible : la séance prévue est conservée."],
        steps: [
          { label: "Échauffement et reconnaissance", minutes: 30 },
          { label: "Travail des lignes sur une section", minutes: 170 },
          { label: "Runs complets et retour au calme", minutes: 40 },
        ],
        route: "M 8 40 C 120 40, 220 40, 330 40 S 500 40, 612 40",
      },
      {
        id: "tired",
        label: "Jambes lourdes",
        hint: "Fatigue des jambes élevée",
        checkin: "Check-in · Fatigue jambes élevée",
        status: "Volume réduit",
        summary: "La séance raccourcit. Le travail des lignes reste au programme.",
        reason: ["Volume réduit pour tenir compte de ", "ta fatigue", ". L'objectif technique est conservé."],
        steps: [
          { label: "Échauffement et lignes lentes", minutes: 20 },
          { label: "Runs techniques, même section", minutes: 110 },
          { label: "Retour au calme", minutes: 20 },
        ],
        route: "M 8 40 C 110 40, 170 70, 300 70 S 500 44, 612 40",
      },
      {
        id: "busy",
        label: "Moins de temps",
        hint: "1 h 30 devant toi",
        checkin: "Check-in · 1 h 30 disponible",
        status: "Séance ciblée",
        summary: "Moins de temps : la séance tient dans ton créneau, centrée sur une section.",
        reason: ["", "Temps disponible réduit", " : travail ciblé sur les lignes, avec échauffement et retour au calme."],
        steps: [
          { label: "Échauffement et reconnaissance", minutes: 15 },
          { label: "Travail ciblé sur une section", minutes: 60 },
          { label: "Retour au calme", minutes: 15 },
        ],
        route: "M 8 40 C 90 40, 120 12, 230 12 S 470 30, 612 40",
      },
    ] satisfies Scenario[],
    week: [
      { day: "Lun", session: "Renfo bas du corps", duration: "45 min" },
      { day: "Mar", session: "DH technique", duration: null, current: true },
      { day: "Mer", session: "Récupération active", duration: "40 min" },
      { day: "Jeu", session: "Aérobie", duration: "1 h" },
      { day: "Ven", session: "Entretien vélo", duration: "—" },
      { day: "Sam", session: "DH performance", duration: "3 h" },
      { day: "Dim", session: "Repos", duration: "—" },
    ],
    history: [
      { session: "Renfo bas du corps", day: "Lundi", detail: "45 min prévues · 45 min réalisées" },
      { session: "Repos", day: "Dimanche", detail: "Journée de récupération" },
      { session: "DH performance", day: "Samedi", detail: "3 h prévues · 2 h 40 réalisées · séance adaptée" },
    ],
    historyNote: "La suite du plan part de ce que tu as vraiment fait.",
  },

  race: {
    title: ["Ta saison donne", "la direction."],
    lead: "Tes courses font partie du plan. La technique et le physique s'organisent autour de tes échéances, et ton état mental est suivi chaque jour.",
    inputs: ["Technique", "Physique", "Mental"],
    outcome: "Jour de course",
    link: "Préparer ma saison",
    imageAlt: "Un pilote de VTT descente en plein saut au-dessus d'une bosse de terre, sous un ciel gris.",
  },

  project: {
    title: ["Créé pour les pilotes,", "par un pilote."],
    body: "NALYNT est né sur les pistes de DH, un sport où une trajectoire imprécise ou une décision prise trop tard se paie tout de suite.",
    name: "Louis Giller",
    role: "Pilote Elite DH, Suisse. Fondateur de NALYNT.",
    link: "L'histoire du projet",
  },

  faq: {
    title: "Avant de commencer.",
    lead: "Quelques repères pour savoir si NALYNT correspond à ta pratique.",
    contact: "Une autre question ?",
    items: [
      {
        q: "Pour quels pilotes ?",
        a: "Pour les pilotes de VTT de descente (DH) qui veulent structurer leur préparation autour de leurs objectifs et de leurs courses.",
      },
      {
        q: "Comment mon plan s'adapte-t-il ?",
        a: "Ton check-in, tes disponibilités, tes courses et ton historique servent de contexte. La séance du jour est conservée, ajustée ou remplacée, avec une raison claire.",
      },
      {
        q: "Et si j'ai moins de temps aujourd'hui ?",
        a: "Indique ton temps disponible au check-in. La séance est ajustée pour tenir dans ce créneau.",
      },
      {
        q: "Il y a aussi de la préparation physique ?",
        a: "Oui. Le physique complète le riding, avec des séances structurées et adaptées à ton état du jour.",
      },
      {
        q: "NALYNT remplace-t-il un médecin ?",
        a: "Non. NALYNT ne remplace pas un médecin, un physiothérapeute, un ostéopathe ou tout autre professionnel de santé. Il oriente vers eux quand c'est nécessaire.",
      },
      {
        q: "Comment commencer ?",
        a: "Crée ton compte, renseigne ton profil et tes disponibilités, puis découvre ton plan dans l'application. Tes courses s'ajoutent ensuite dans ton profil.",
      },
    ],
  },

  finish: {
    title: "Découvre ton prochain entraînement.",
    lead: "Un plan construit autour de tes courses.",
    primary: "Découvrir mon plan",
  },
};
