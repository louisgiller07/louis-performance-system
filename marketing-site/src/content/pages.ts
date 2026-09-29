// V3 — copy for the redesigned inner pages (/comment-ca-marche, /coaching),
// same brand language as the homepage (content/home.ts): rider-first, about
// performance, progression and race day — not about the technology. Same
// honesty rules as content/copy.ts: every statement matches what the app
// does today (weekly plan built around availability and races, daily
// check-in, keep / adjust / replace with a stated reason, planned vs done
// history, recent facts recalled later).

export interface HowStep {
  id: "plan" | "checkin" | "decide" | "memory";
  word: string;
  title: string;
  body: string;
}

export interface Decision {
  word: string;
  when: string;
  result: string;
  highlighted?: boolean;
}

export interface PageHeroCopy {
  kicker: string;
  titleLines: string[];
  intro: string;
}

export const howPage = {
  meta: {
    title: "Comment ça marche — NALYNT",
    description:
      "Tu planifies, tu fais ton check-in, NALYNT ajuste ta séance, tu roules et il retient. Une boucle quotidienne pensée pour les pilotes DH et Enduro.",
  },
  hero: {
    kicker: "Comment ça marche",
    titleLines: ["Chaque jour,", "la bonne séance."],
    intro: "Quatre étapes. Une boucle qui tourne tous les jours, jusqu'au jour de course.",
  } satisfies PageHeroCopy,

  loop: {
    index: "01",
    kicker: "La boucle",
    steps: [
      {
        id: "plan",
        word: "Planifier",
        title: "Ta semaine, construite autour de ta vie.",
        body: "Tes disponibilités, tes courses, tes objectifs. NALYNT place chaque séance là où elle tient vraiment, pas là où elle serait idéale sur le papier.",
      },
      {
        id: "checkin",
        word: "Check-in",
        title: "Comment tu te sens, vraiment.",
        body: "Sommeil, énergie, fatigue, douleur, temps disponible. Quelques secondes le matin, comme tu le dirais à ton coach.",
      },
      {
        id: "decide",
        word: "Décider",
        title: "Garder, ajuster ou remplacer.",
        body: "NALYNT confronte ta séance prévue à ton état du jour et tranche. Toujours avec la raison, en une phrase.",
      },
      {
        id: "memory",
        word: "Retenir",
        title: "Prévu, réalisé, ressenti.",
        body: "Tu notes ce que tu as vraiment fait. Tout reste dans ton historique, et les séances suivantes partent de là.",
      },
    ] satisfies HowStep[],
  },

  decisions: {
    index: "02",
    kicker: "Trois décisions possibles",
    titleLines: ["Même objectif.", "Trois façons d'y aller."],
    items: [
      { word: "Garder", when: "Bonne nuit, jambes fraîches.", result: "La séance prévue reste. Tu y vas à fond." },
      {
        word: "Ajuster",
        when: "Jambes lourdes, deux heures devant toi.",
        result: "Même objectif, volume réduit : des runs propres plutôt que des runs de trop.",
        highlighted: true,
      },
      { word: "Remplacer", when: "Jambes et grip à bout.", result: "La force bas du corps laisse place au haut du corps ou à de la récupération active." },
    ] satisfies Decision[],
  },

  promises: {
    index: "03",
    kicker: "Ce que NALYNT ne fait pas",
    items: [
      { title: "Décider dans ton dos.", body: "Chaque changement est affiché et expliqué. Tu gardes la main." },
      { title: "Jouer au médecin.", body: "Une douleur qui inquiète ? NALYNT t'oriente vers un médecin ou un physio." },
      { title: "Promettre des miracles.", body: "Il t'aide à t'entraîner juste, chaque jour. Le travail, c'est toi qui le fais." },
    ],
  },

  cta: {
    index: "04",
    titleLines: ["Ta prochaine séance", "t'attend."],
  },
};

export const coachingPage = {
  meta: {
    title: "Le coaching — NALYNT",
    description:
      "Technique, mental, physique, récupération, nutrition, vie hors vélo, progression : sept domaines qui font un pilote rapide, arbitrés chaque jour vers le jour de course.",
  },
  hero: {
    kicker: "Le coaching",
    titleLines: ["Sept domaines.", "Un seul cap :", "le jour de course."],
    intro:
      "Un pilote rapide ne se construit pas que sur le vélo. NALYNT suit tout ce qui compte, et arbitre chaque jour entre eux.",
  } satisfies PageHeroCopy,

  domains: {
    index: "01",
    kicker: "Les sept domaines",
    fieldLabel: "Sur le terrain",
  },

  arbitration: {
    index: "02",
    kicker: "L'arbitrage",
    titleLines: ["Quand tout tire", "dans des sens différents,", "NALYNT tranche."],
    body: "Une nuit courte, des jambes lourdes, une course dans dix jours et deux heures devant toi : chaque domaine pousse dans sa direction. NALYNT les met en balance pour te donner une seule séance claire. Et il te dit pourquoi.",
    chips: ["Sommeil", "Jambes", "Course J-10", "2 h dispo"],
    outcome: "Une seule séance, expliquée.",
  },

  cta: {
    index: "03",
    titleLines: ["Entraîne-toi", "comme un pro."],
  },
};
