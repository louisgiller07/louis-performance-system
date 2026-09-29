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

export interface Statement {
  title: string;
  body: string;
}

export interface Milestone {
  label: string;
  title: string;
  body: string;
  current?: boolean;
}

export const philosophyPage = {
  meta: {
    title: "Philosophie — NALYNT",
    description:
      "Nos convictions : la réalité d'abord, un objectif qui ne bouge pas, chaque décision expliquée, la qualité avant le volume. Et ce qu'on s'interdit.",
  },
  hero: {
    kicker: "Philosophie",
    titleLines: ["S'entraîner juste.", "Pas plus.", "Pas moins."],
    intro: "Ce en quoi on croit, et ce qu'on s'interdit. Parce qu'un pilote doit pouvoir faire confiance à son coach.",
  } satisfies PageHeroCopy,

  convictions: {
    index: "01",
    kicker: "Nos convictions",
    items: [
      {
        title: "La réalité d'abord.",
        body: "Un plan n'a de valeur que s'il colle à ta journée. NALYNT part de ton état du jour, pas d'un calendrier écrit il y a trois semaines.",
      },
      {
        title: "L'objectif ne bouge pas.",
        body: "On ajuste le chemin, jamais le cap. Ta course reste le point fixe autour duquel tout s'organise.",
      },
      {
        title: "Chaque décision s'explique.",
        body: "Derrière chaque ajustement, une logique de coach que tu peux lire, en une phrase. Jamais une boîte noire.",
      },
      {
        title: "La qualité avant le volume.",
        body: "Un run propre vaut mieux que trois runs de trop. En DH, la fatigue se paie en trajectoires.",
      },
      {
        title: "Né sur le terrain.",
        body: "Chaque principe est testé sur les vraies séances d'un pilote Elite, pas sur des données de laboratoire.",
      },
    ] satisfies Statement[],
  },

  limits: {
    index: "02",
    kicker: "Ce qu'on s'interdit",
    items: [
      {
        title: "Jouer au médecin.",
        body: "NALYNT ne pose aucun diagnostic. Au moindre signal qui inquiète, il t'oriente vers un médecin, un physio ou un ostéo.",
      },
      {
        title: "Décider à ta place.",
        body: "NALYNT propose et explique. Tu gardes le dernier mot sur ta séance.",
      },
      {
        title: "Promettre la lune.",
        body: "Il garde la mémoire de tes séances, mais ne décide pas seul d'augmenter ta charge. Progresser reste ton travail.",
      },
    ] satisfies Statement[],
  },

  cta: {
    index: "03",
    titleLines: ["Prêt à t'entraîner", "juste ?"],
  },
};

export const aboutPage = {
  meta: {
    title: "À propos — NALYNT",
    description:
      "NALYNT est né dans le VTT Downhill de compétition, construit et testé chaque jour par Louis Giller, pilote Elite suisse.",
  },
  hero: {
    kicker: "À propos",
    titleLines: ["Construit", "depuis le terrain."],
    intro: "NALYNT est né sur les pistes de DH, d'une question qu'un pilote se pose chaque matin avant de rouler.",
    imageAlt: "Louis Giller en plein saut sur une piste de VTT descente, dossard 86, au-dessus d'une bosse de terre.",
  },

  origin: {
    index: "01",
    kicker: "L'origine",
    lead: "Un plan peut être parfait sur le papier. Le jour J, la réalité a souvent changé.",
    contrast: ["Une récupération différente.", "Une fatigue qui s'accumule.", "Une contrainte extérieure.", "Un mental qui n'est pas au rendez-vous."],
    questionIntro: "La question n'est plus seulement :",
    questionOld: "Qu'est-ce qui était prévu ?",
    questionBridge: "Mais :",
    questionNew: "Quelle est la meilleure décision aujourd'hui ?",
  },

  founder: {
    index: "02",
    kicker: "Le fondateur",
    text: [
      "Pilote de descente en compétition, Louis vit chaque jour ce que NALYNT cherche à résoudre : concilier la piste, la préparation physique, la récupération, le travail et les courses.",
      "Il est le premier utilisateur de NALYNT et teste chaque évolution sur ses propres séances avant qu'elle n'arrive chez d'autres pilotes.",
    ],
    facts: [
      { value: "Elite", label: "Pilote DH, Suisse" },
      { value: "N° 1", label: "Premier utilisateur" },
      { value: "Chaque jour", label: "Testé sur ses séances" },
    ],
    imageAlt: "Louis Giller en course sur une piste de VTT descente rocailleuse, dossard 86, nuage de poussière.",
  },

  downhill: {
    index: "03",
    kicker: "Pourquoi le Downhill",
    titleLines: ["Un sport où chaque", "erreur se paie", "tout de suite."],
    body: [
      "En DH, une trajectoire imprécise ou une décision prise trop tard a des conséquences immédiates. La marge d'erreur est minuscule.",
      "La fatigue y pèse directement sur la prise de risque et la qualité de pilotage. Progresser, c'est aussi savoir quand lever le pied.",
      "C'est le terrain le plus exigeant pour construire un coach qui s'adapte. C'est pour ça que NALYNT est né ici.",
    ],
  },

  today: {
    index: "04",
    kicker: "Aujourd'hui",
    milestones: [
      { label: "Au départ", title: "Un pilote, ses séances.", body: "NALYNT est construit et testé au quotidien par Louis, sur de vraies séances." },
      { label: "Aujourd'hui", title: "Bêta ouverte.", body: "Les premiers pilotes DH et Enduro rejoignent NALYNT, gratuitement.", current: true },
      { label: "Demain", title: "Plus de pilotes, plus de terrain.", body: "Chaque retour de pilote rend le coaching plus juste, toujours validé avant d'arriver dans l'app." },
    ] satisfies Milestone[],
    vision: ["Un bon coach ne sait pas seulement ce qui était prévu.", "Il comprend ce qui s'est vraiment passé."],
  },

  cta: {
    index: "05",
    titleLines: ["Rejoins", "l'aventure."],
  },
};

export const contactPage = {
  meta: {
    title: "Contact — NALYNT",
    description: "Une question, un retour ou envie de rejoindre la bêta NALYNT ? Écris-nous.",
  },
  hero: {
    kicker: "Contact",
    titleLines: ["Une question ?", "On t'écoute."],
    intro: "Une question sur NALYNT, un retour après une séance ou envie de rejoindre la bêta : écris-nous.",
  } satisfies PageHeroCopy,
  email: "contact@nalynt.ch",
  aside: {
    emailLabel: "Écris-nous directement",
    tryLabel: "Tu préfères essayer ?",
    tryText: "Crée ton compte gratuitement et fais ton premier check-in dès demain matin.",
  },
};
