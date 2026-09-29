// V3 — Premium homepage (brand experience). Content source only for the seven
// homepage sections in src/components/home/ — no component adds copy of its
// own. Same honesty rules as content/copy.ts: every product statement below
// matches what the app actually does today (daily check-in, Today / Programme
// / History screens, explained adaptations, free beta without payment).
//
// Deliberately NOT claimed: a 7-day trial (no trial exists — the beta is free),
// "NALYNT apprend tout seul" (banned framing — the system keeps a factual
// memory, it does not self-improve), weather as an input (weather appears
// only as an example of the athlete's changing reality in "Le problème").
//
// The day-story and app-screen values are one fictional-but-representative DH
// technical day, using the app's real labels (Mission du jour, Plan de
// séance, Intensité, Pourquoi cette décision ?, Programme, Historique).

export interface HomeLink {
  label: string;
  href: string;
}

export interface Reality {
  word: string;
  note: string;
}

export interface Metric {
  label: string;
  value: string;
  /** Bar fill, 0–100. */
  level: number;
  /** The one signal the day's decision is built on — highlighted in gold. */
  retained?: boolean;
}

export interface DayStep {
  label: string;
  title: string;
  body: string;
}

export interface Pillar {
  word: string;
  line: string;
  detail: string;
}

export interface ProductFeature {
  id: "today" | "programme" | "history" | "adaptation";
  label: string;
  line: string;
}

export const signupHref = "https://app.nalynt.ch/signup";
export const loginHref = "https://app.nalynt.ch/login";

export const home = {
  meta: {
    title: "NALYNT — Coach IA de performance pour le VTT Downhill, l'Enduro et le Gravity",
    description:
      "NALYNT adapte chaque jour ton entraînement DH et enduro à ton état réel, à tes disponibilités et à tes courses. Ton objectif reste. Le plan s'adapte.",
  },

  hero: {
    eyebrow: "DH · Enduro · Gravity",
    titleLines: ["Ton objectif reste.", "Le plan"],
    titleAccent: "s'adapte.",
    /** Positioning first: this is for riders, not a generic adaptive-fitness app. ("Le premier …" dropped — unverifiable superlative.) */
    subtitle: "Le coach IA conçu pour les pilotes DH et Enduro.",
    support: "Il analyse ton état, adapte ton entraînement et t'aide à arriver plus fort le jour de course.",
    primary: { label: "Commencer gratuitement", href: signupHref } satisfies HomeLink,
    secondary: { label: "Découvrir comment ça marche", href: "#journee" } satisfies HomeLink,
    caption: "Louis Giller — pilote Elite DH, Suisse",
    image: {
      alt: "Un pilote de VTT descente, dossard 86, fonce vers l'objectif dans un nuage de poussière sur une piste rocailleuse.",
    },
  },

  problem: {
    index: "02",
    kicker: "Le problème",
    titleLines: ["Le problème n'est pas ton ambition.", "C'est que ta réalité change constamment."],
    realities: [
      { word: "Fatigue", note: "Des jambes lourdes après trois jours de piste." },
      { word: "Météo", note: "Une piste détrempée, une séance à repenser." },
      { word: "Blessures", note: "Un poignet qui tire depuis mardi." },
      { word: "Travail", note: "Une semaine à rallonge au bureau." },
      { word: "Courses", note: "Une manche iXS dans douze jours." },
      { word: "Contraintes", note: "Une heure devant toi au lieu de trois." },
    ] satisfies Reality[],
    closing: "Un plan figé ignore tout ça. NALYNT part de là.",
  },

  day: {
    index: "03",
    kicker: "Une journée avec NALYNT",
    title: "Mardi, 7 h 12.",
    intro: "Tu connais cette journée. Voici ce qui change avec NALYNT.",
    stamp: "Mar 12 · 07:12",
    steps: [
      {
        label: "Avant NALYNT",
        title: "« Mon programme disait 4 h. »",
        body: "DH technique, quatre heures, écrit il y a trois semaines. Ton programme ne sait pas quelle nuit tu viens de passer.",
      },
      {
        label: "La réalité",
        title: "« Jambes lourdes. Genou qui tire. Boulot jusqu'à 16 h. »",
        body: "Tu le dis au check-in, comme tu le dirais à ton coach. NALYNT en tient compte avant de proposer quoi que ce soit.",
      },
      {
        label: "Avec NALYNT",
        title: "Le coach ajuste.",
        body: "L'objectif reste : précision et lignes. La séance passe à 2 h 30, pour des runs propres sans forcer sur un genou sensible.",
      },
      {
        label: "La suite",
        title: "NALYNT garde la mémoire. Le plan évolue.",
        body: "Prévu, réalisé, ressenti : tout reste dans ton historique. Les séances suivantes partent de ce qui s'est vraiment passé.",
      },
    ] satisfies DayStep[],
    /** "Avant NALYNT" — the fixed plan, as written weeks ago. */
    plan: {
      heading: "Programme · Mardi",
      kind: "DH technique",
      rows: [
        { label: "Durée", value: "4 h" },
        { label: "Intensité", value: "Élevée" },
        { label: "Objectif", value: "Précision des lignes" },
      ],
      footnote: "Écrit il y a 3 semaines · jamais mis à jour",
    },
    metrics: [
      { label: "Sommeil", value: "6 h 20", level: 55 },
      { label: "Fatigue jambes", value: "Élevée", level: 84, retained: true },
      { label: "Genou", value: "Douleur légère", level: 28, retained: true },
      { label: "Énergie", value: "Moyenne", level: 50 },
      { label: "Disponible", value: "2 h 30 · après 16 h", level: 45 },
    ] satisfies Metric[],
    signal: "Signaux retenus : fatigue jambes · genou sensible",
    session: {
      heading: "Mission du jour",
      kind: "DH technique",
      plannedDuration: "4 h",
      plannedLabel: "prévues",
      duration: "2 h 30",
      adaptedLabel: "adaptées",
      objective: "Précision des lignes",
      intensity: "Modérée",
      focus: "Qualité des répétitions",
      badge: "Séance adaptée",
      reason: "Fatigue jambes élevée et genou sensible : volume réduit, objectif technique conservé.",
    },
    history: [
      { day: "Mar 12", kind: "DH technique", detail: "Prévu 4 h · Réalisé 2 h 30", tag: "Adaptée" },
      { day: "Lun 11", kind: "Renfo bas du corps", detail: "Prévu 45 min · Réalisé 45 min", tag: "Conforme" },
      { day: "Dim 10", kind: "Repos", detail: "Journée de récupération", tag: "Conforme" },
    ],
    /** Week strip — planned volume per day before / after today's adaptation (0–100). */
    week: {
      label: "Programme · Semaine 3",
      days: ["L", "M", "M", "J", "V", "S", "D"],
      before: [30, 80, 25, 45, 15, 70, 0],
      after: [30, 50, 30, 45, 15, 70, 0],
      today: 1,
    },
  },

  how: {
    index: "04",
    kicker: "Comment ça fonctionne",
    pillars: [
      { word: "Observer", line: "Comprendre ton contexte.", detail: "Check-in du jour, disponibilités, courses à venir, historique." },
      { word: "Adapter", line: "Modifier ton plan.", detail: "Garder, ajuster ou remplacer la séance, toujours avec une raison claire." },
      { word: "Progresser", line: "Améliorer tes performances.", detail: "Des séances de qualité, jour après jour, jusqu'au jour de course." },
    ] satisfies Pillar[],
  },

  product: {
    index: "05",
    kicker: "Le produit",
    titleLines: ["Une seule question.", "Que faire aujourd'hui ?"],
    features: [
      { id: "today", label: "Aujourd'hui", line: "Ta mission du jour, lisible entre deux runs." },
      { id: "programme", label: "Programme", line: "Ta semaine, construite autour de tes courses." },
      { id: "history", label: "Historique", line: "Prévu et réalisé, côte à côte." },
      { id: "adaptation", label: "Adaptation IA", line: "Chaque ajustement, expliqué en une phrase." },
    ] satisfies ProductFeature[],
  },

  why: {
    index: "06",
    kicker: "Pourquoi NALYNT",
    titleLines: ["Créé pour les pilotes", "qui veulent progresser", "intelligemment."],
    /**
     * Human proof — "créé pour les pilotes, par un pilote". NEEDS VALIDATION:
     * `quote` is a first-person draft in Louis's name, built only from the
     * project's documented origin (content/copy.ts `about.origin`).
     */
    founder: {
      kicker: "Créé pour les pilotes, par un pilote",
      quote:
        "Je roule en Elite DH. Mon programme ne savait jamais dans quel état j'arrivais le matin d'une séance. J'ai construit NALYNT pour ça.",
      name: "Louis Giller",
      role: "Pilote Elite DH, Suisse · Fondateur de NALYNT",
    },
    body: [
      "NALYNT est né sur les pistes de DH, un sport où une trajectoire imprécise ou une décision prise trop tard se paie tout de suite. Il est testé chaque jour sur de vraies séances avant d'accompagner d'autres pilotes.",
    ],
    facts: [
      { value: "Elite DH", label: "Né en compétition" },
      { value: "Chaque jour", label: "Testé sur de vraies séances" },
      { value: "Jour J", label: "Tout converge vers la course" },
    ],
    links: [
      { label: "L'histoire du projet", href: "/a-propos" },
      { label: "Les 7 domaines de coaching", href: "/coaching" },
    ] satisfies HomeLink[],
    image: {
      alt: "Louis Giller en plein saut sur une piste de VTT descente, dossard 86, au-dessus d'une bosse de terre.",
    },
  },

  cta: {
    index: "07",
    titleLines: ["Prêt à passer", "au niveau supérieur ?"],
    /** Community framing at the end of the page (hero keeps "Commencer gratuitement"). */
    primary: { label: "Rejoindre les premiers pilotes", href: signupHref } satisfies HomeLink,
    note: "Accès bêta gratuit. Aucun paiement demandé.",
    secondary: { label: "Une question ? Nous contacter", href: "/contact" } satisfies HomeLink,
  },
};
