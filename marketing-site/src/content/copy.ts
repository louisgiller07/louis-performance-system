// Site-wide copy — content source only, no components/design touched here.
// Every claim below is grounded in real, shipped head-coach-engine behavior
// (see docs/11_DECISION_LOG.md, docs/03_COACHING_MODEL.md). Nothing here
// describes a feature that does not exist yet.
//
// Banned phrasing (NALYNT — Marketing Website V1.1 brief): "IA magique",
// "remplace un coach", "l'IA apprend toute seule", any unproven promise.
// None of the strings below use these — do not reintroduce them in future
// edits without re-checking against this constraint.
//
// NEEDS HUMAN VALIDATION: every field below is a first proposal. The
// `sloganOptions` array in particular holds 3 candidates — `headline`
// currently carries the recommended one, the other two are alternatives
// for Louis to pick from, not a decided choice.

export interface HeroCopy {
  /**
   * Short editorial kicker shown above `headline` — positions NALYNT in the
   * performance/gravity space. A category label, never a slogan/promise.
   */
  eyebrow: string;
  /** Recommended slogan — one of `sloganOptions` below. NEEDS VALIDATION. */
  headline: string;
  subheadline: string;
  ctaLabel: string;
  ctaHref: string;
}

/** All slogan candidates considered for `hero.headline`. NEEDS VALIDATION — pick one. */
export const sloganOptions: string[] = [
  "Le coaching qui s'adapte à ta vraie journée.",
  "Ce qui est prescrit. Ce qui est fait. Ce qui compte.",
  "Un coaching qui observe avant de proposer.",
];

export interface DisclaimerCopy {
  text: string;
}

export interface NavLink {
  label: string;
  href: string;
}

export interface LoopStepCopy {
  title: string;
  description: string;
}

export interface KeyMessagesCopy {
  /** Le problème du coaching générique / plan figé. */
  problem: string;
  /** Ce qui distingue concrètement NALYNT. */
  difference: string;
  /** La philosophie produit : règles explicites, transparence, dogfood réel. */
  philosophy: string;
  /** La boucle Planning → Prescription → Performed → Feedback. */
  loop: {
    planning: LoopStepCopy;
    prescription: LoopStepCopy;
    performed: LoopStepCopy;
    feedback: LoopStepCopy;
  };
}

/**
 * V1.5 — "Pourquoi NALYNT existe" homepage section. Exact copy provided by
 * Louis (NALYNT — Clarification V1.5 Brand Story Integration) — verbatim,
 * including its original punctuation. Replaces the home-page usage of
 * `about.origin` (StoryBlock) — `about.origin` itself is unchanged and
 * still used as-is on /a-propos.
 *
 * V1.8 — relaxed (`title`/`intro` flexible, `turn`/`origin`/`approach`
 * optional) so the same shape/component can also carry the shorter
 * /a-propos hero content (no turn/origin/approach beat, single-line title,
 * two intro paragraphs) without inventing fields that content doesn't have.
 * `storyOrigin` (home) keeps using every optional field; `aboutPage.hero`
 * only uses the subset it actually has.
 */
export interface StoryOriginCopy {
  eyebrow: string;
  /** Single line, or a two-line editorial headline — exact line break preserved, not CSS wrap. */
  title: string | [string, string];
  /** One or more paragraphs, rendered in order. */
  intro: string[];
  /** Four short staccato fragments — rendered as distinct lines, not a paragraph. */
  contrastList: [string, string, string, string];
  turn?: string;
  origin?: string;
  approach?: string;
  questionIntro: string;
  questionOld: string;
  questionBridge: string;
  questionNew: string;
}

export interface AboutCopy {
  /** D'où vient le projet — contexte concret, pas de storytelling exagéré. */
  origin: string;
  /** Le contexte athlète réel sur lequel le système est construit/testé. */
  athleteContext: string;
  /** Pourquoi le système existe, formulé simplement. */
  whyItExists: string;
}

/**
 * V1.8 — /a-propos as a real project-origin page. Each text section carries
 * its own "surtitre" (small numbered kicker, non-heading) and "titre" (the
 * real, large section heading) — content given verbatim or closely
 * paraphrased from Louis's brief (NALYNT V1.8 — About Page / Athlete Origin
 * & Credibility), deliberately reworded versus the homepage sections it's
 * adjacent to in spirit (`keyMessages.problem`, `storyOrigin`) so the two
 * pages don't repeat each other verbatim.
 */
export interface AboutPageTextSection {
  eyebrow: string;
  title: string | [string, string];
  /** One or more paragraphs, rendered in order. */
  body: string[];
}

export interface AboutPageLouisSection {
  eyebrow: string;
  title: string | [string, string];
  text: string;
  image: { src: string; alt: string };
}

export interface AboutPageCopy {
  hero: StoryOriginCopy;
  problem: AboutPageTextSection;
  bornInDownhill: AboutPageTextSection;
  louis: AboutPageLouisSection;
  whyDownhill: AboutPageTextSection;
  today: AboutPageTextSection;
  vision: AboutPageTextSection;
}

export interface ProductLimitsCopy {
  notMedical: string;
  notAutonomousAI: string;
  noAutomaticProgress: string;
}

/**
 * V1.6.1 — closing CTA on the homepage, before the disclaimer. Addresses the
 * V1.6 review finding that the only CTA on the whole page was the Hero one,
 * with nothing prompting a next step for a visitor who reads all the way
 * down. Points to /contact (not /comment-ca-marche again) — a convinced
 * visitor has already absorbed how it works by this point; the project is
 * still at an early/dogfood stage (no signup flow, no pricing), so "get in
 * touch" is the honest next step, not a conversion funnel.
 */
export interface ClosingCtaCopy {
  text: string;
  ctaLabel: string;
  ctaHref: string;
}

/**
 * V1.7 — "Une journée avec NALYNT" homepage section (product proof). A
 * single fictional-but-representative DH technical session walked through
 * Planning → Check-in → Prescription → Performed → Feedback — the same
 * vocabulary as `keyMessages.loop`, just instantiated with concrete values
 * instead of described abstractly. No date, no real race, no personal data.
 *
 * Every step's `message` is deliberately worded to avoid: "analyse
 * biométrique avancée", "prédiction", "diagnostic" (step 2), "NALYNT
 * optimise automatiquement", "NALYNT sait exactement ce qui est meilleur",
 * "NALYNT remplace un coach" (step 3), "NALYNT apprend tout seul", "le
 * système devient automatiquement meilleur" (step 5) — do not reintroduce
 * this framing in future edits.
 */
export interface DayWithNalyntStep {
  title: string;
  /** Short spec-sheet facts — rendered as distinct lines, not a paragraph. */
  facts: string[];
  message: string;
}

export interface DayWithNalyntCopy {
  eyebrow: string;
  title: string;
  intro: string;
  steps: [DayWithNalyntStep, DayWithNalyntStep, DayWithNalyntStep, DayWithNalyntStep, DayWithNalyntStep];
}

export interface SiteCopy {
  hero: HeroCopy;
  /** Une phrase unique résumant la valeur centrale — utilisable en meta description. */
  coreValueProposition: string;
  keyMessages: KeyMessagesCopy;
  storyOrigin: StoryOriginCopy;
  dayWithNalynt: DayWithNalyntCopy;
  aboutPage: AboutPageCopy;
  about: AboutCopy;
  limits: ProductLimitsCopy;
  closingCta: ClosingCtaCopy;
  disclaimer: DisclaimerCopy;
  nav: NavLink[];
}

export const siteCopy: SiteCopy = {
  hero: {
    eyebrow: "Coaching de performance — Gravity / VTT Downhill",
    headline: sloganOptions[0],
    subheadline:
      "NALYNT est un système de coaching qui combine chaque jour ton intention d'entraînement, ton état réel du jour et l'historique de tes séances pour proposer un plan cohérent — pas une routine figée à l'avance.",
    ctaLabel: "Découvrir la démarche",
    ctaHref: "/comment-ca-marche",
  },

  coreValueProposition:
    "NALYNT est un système de coaching de performance qui adapte la séance du jour à l'état réel de l'athlète, distingue ce qui a été prescrit de ce qui a réellement été fait, et garde une mémoire factuelle des séances passées pour éclairer les prescriptions suivantes.",

  keyMessages: {
    /**
     * V1.6.1 — volontairement un simple constat général (jamais la
     * conclusion "le plan ne change pas malgré la réalité", qui appartient
     * désormais à `storyOrigin.turn` — évite la répétition relevée par la
     * revue V1.6 entre "Le problème" et "Pourquoi NALYNT existe".
     */
    problem:
      "Un plan d'entraînement générique est écrit à l'avance, sans connaître l'état réel de l'athlète le jour J : une nuit courte, une fatigue accumulée, une douleur, une semaine professionnelle chargée.",
    difference:
      "NALYNT part d'un check-in quotidien réel — sommeil, énergie, fatigue, mental, douleur — et ajuste la séance du jour à partir de règles de coaching explicites et traçables, écrites et validées par un coach. Ce n'est ni un plan figé à l'avance, ni une estimation générique.",
    philosophy:
      "Chaque adaptation proposée par NALYNT suit une règle de coaching explicite, écrite par un humain et vérifiable — jamais une décision opaque. Le système est construit et testé au quotidien sur de vraies séances d'un athlète réel, pas sur des données synthétiques.",
    loop: {
      planning: {
        title: "Planning",
        description: "L'athlète exprime une intention de séance pour la journée — ce qu'il prévoit de faire.",
      },
      prescription: {
        title: "Prescription",
        description:
          "NALYNT combine cette intention avec l'état réel du jour (check-in) et le contexte (course à venir, récupération, sécurité) pour produire le plan du jour.",
      },
      performed: {
        title: "Performed",
        description:
          "Après la séance, l'athlète enregistre ce qui a réellement été fait — parfois identique à la prescription, parfois différent.",
      },
      feedback: {
        title: "Feedback",
        description:
          "Ce qui a été prescrit et ce qui a réellement été fait restent visibles et distincts dans l'historique ; certains faits récents (par exemple le résultat d'une tâche technique précédente) sont rappelés lors des prescriptions suivantes, à titre purement factuel.",
      },
    },
  },

  storyOrigin: {
    eyebrow: "Pourquoi NALYNT existe",
    title: [
      "La performance ne se construit pas sur un plan parfait.",
      "Elle se construit dans la réalité.",
    ],
    intro: [
      "Un entraînement prévu plusieurs jours à l’avance ne rencontre jamais exactement les mêmes conditions une fois arrivé sur le terrain.",
    ],
    contrastList: [
      "Une récupération différente.",
      "Une fatigue accumulée.",
      "Une contrainte extérieure.",
      "Un contexte de course qui évolue.",
    ],
    turn: "Pourtant, beaucoup de plans restent identiques alors que l’athlète, lui, a changé.",
    origin:
      "NALYNT est né d’un besoin simple : créer un coaching capable de prendre en compte la réalité du jour, pas uniquement ce qui était prévu.",
    approach:
      "Pensé depuis la pratique du VTT Downhill de compétition, le système relie l’intention d’entraînement, l’état réel de l’athlète et l’historique des séances pour aider à prendre de meilleures décisions.",
    questionIntro: "Parce qu’au final, la question n’est pas seulement :",
    questionOld: "Qu’est-ce qui était prévu ?",
    questionBridge: "Mais :",
    questionNew: "Quelle est la meilleure décision aujourd’hui ?",
  },

  dayWithNalynt: {
    eyebrow: "Exemple produit",
    title: "Une journée avec NALYNT",
    intro:
      "Concrètement, voici comment cette question se traduit sur une séance DH technique — du plan initial jusqu'à la mémoire qui en reste.",
    steps: [
      {
        title: "La séance prévue",
        facts: [
          "DH technique",
          "Durée prévue : 4 heures",
          "Objectif : travailler les lignes, la précision et les répétitions",
        ],
        message: "L'athlète commence avec une intention claire : ce qu'il souhaite travailler aujourd'hui.",
      },
      {
        title: "L'état du jour",
        facts: [
          "Sommeil : correct",
          "Énergie : bonne",
          "Fatigue jambes : élevée",
          "Grip / avant-bras : moyen",
          "Motivation : bonne",
        ],
        message: "NALYNT confronte l'objectif prévu avec la réalité du jour.",
      },
      {
        title: "La décision NALYNT",
        facts: [
          "DH technique",
          "Volume adapté",
          "Focus : qualité des répétitions",
          "Réduction du volume avant dégradation technique",
        ],
        message: "L'objectif reste le même. La manière de l'atteindre évolue selon le contexte.",
      },
      {
        title: "La séance effectuée",
        facts: ["DH technique", "2h30 réalisées", "Focus conservé : précision et lignes"],
        message: "NALYNT distingue ce qui était prévu de ce qui a réellement été effectué.",
      },
      {
        title: "L'historique",
        facts: [
          "Contexte conservé : fatigue jambes avant séance",
          "Contexte conservé : adaptation réalisée",
          "Contexte conservé : résultat enregistré",
        ],
        message: "Les événements importants restent visibles pour comprendre les décisions suivantes.",
      },
    ],
  },

  aboutPage: {
    hero: {
      eyebrow: "L'origine du projet",
      title: "Construit depuis le terrain.",
      intro: [
        "NALYNT est né d'une idée simple : dans la réalité d'un athlète, une journée ne se déroule jamais exactement comme prévu.",
        "Un plan d'entraînement peut être parfaitement construit sur le papier. Pourtant, lorsque vient le moment de s'entraîner, le contexte a parfois changé.",
      ],
      contrastList: [
        "Une récupération différente.",
        "Une fatigue qui s'accumule.",
        "Une contrainte extérieure.",
        "Un état mental qui n'est pas celui attendu.",
      ],
      questionIntro: "La question n'est alors plus seulement :",
      questionOld: "Qu'est-ce qui était prévu ?",
      questionBridge: "Mais :",
      questionNew: "Quelle est la meilleure décision aujourd'hui ?",
    },

    problem: {
      eyebrow: "Un problème rencontré dans la pratique",
      title: "Les plans ne rencontrent jamais exactement la même réalité.",
      body: [
        "Un plan d'entraînement se construit avant la séance — sur la base de ce qui est prévu, pas de ce qui va réellement se passer.",
        "Il ne peut pas connaître à l'avance l'état exact du jour : la récupération, la fatigue, le contexte extérieur, la disponibilité mentale.",
        "Dans la pratique, la bonne décision ne dépend jamais uniquement du plan initial. Elle dépend de ce qui est vrai ce jour-là.",
      ],
    },

    bornInDownhill: {
      eyebrow: "Né dans le VTT Downhill de compétition",
      title: "Un système pensé depuis un sport où chaque décision compte.",
      body: [
        "La descente (DH) est une discipline où chaque décision d'entraînement a un effet direct sur la piste : la progression technique, la préparation physique, la récupération et la confiance doivent avancer ensemble, jamais isolément.",
        "Une séance n'est jamais seulement une séance. Elle s'inscrit dans un équilibre plus large — celui d'arriver prêt, techniquement et mentalement, au bon moment.",
        "C'est dans cette réalité que NALYNT a été pensé : un sport où le contexte du jour peut changer ce qu'il est pertinent de faire.",
      ],
    },

    louis: {
      eyebrow: "Louis Giller",
      title: ["Construit par un athlète.", "Testé dans une pratique réelle."],
      text: "NALYNT est construit et testé à partir d'un cas réel : celui d'un pilote de VTT Downhill en compétition. En tant que pilote confronté quotidiennement à ces contraintes, Louis utilise NALYNT comme premier environnement de test réel — le système cherche à conserver le contexte autour de chaque décision qu'il traverse lui-même : ce qui était prévu, ce qui a réellement été effectué, l'état de l'athlète au moment de décider, et les informations importantes des séances précédentes.",
      image: {
        src: "/images/about/race-performance.webp",
        alt: "Louis Giller en course sur une piste de VTT descente (DH) rocailleuse, dossard visible, nuage de poussière.",
      },
    },

    whyDownhill: {
      eyebrow: "Pourquoi le Downhill ?",
      title: "Un environnement exigeant pour tester l'adaptation.",
      body: [
        "En VTT Downhill, une trajectoire imprécise ou une décision prise trop tard a des conséquences immédiates — la marge d'erreur est faible.",
        "La fatigue y a une influence directe sur la prise de risque et la qualité d'exécution. Progresser techniquement suppose donc de savoir aussi quand freiner l'intensité pour préserver la récupération.",
        "C'est un environnement où le contexte du jour ne peut pas être ignoré — ce qui en fait un terrain d'exigence particulièrement pertinent pour construire et tester un système d'adaptation.",
      ],
    },

    today: {
      eyebrow: "Aujourd'hui",
      title: "Une phase de développement basée sur des situations réelles.",
      body: [
        "NALYNT est aujourd'hui dans une phase de « dogfood » : concrètement, il est utilisé et testé en conditions réelles, sur de vraies séances, avant d'être proposé plus largement.",
        "Chaque étape suit le même principe : observer ce qui se passe réellement, valider si la décision proposée était pertinente, puis ajuster le système en conséquence.",
        "Avant d'accompagner d'autres athlètes, NALYNT doit continuer à démontrer sa pertinence là où il est né — sur le terrain d'un pilote DH réel.",
      ],
    },

    vision: {
      eyebrow: "La vision",
      title: "Relier le plan à la réalité.",
      body: [
        "NALYNT ne cherche pas à remplacer l'expérience d'un athlète ou d'un coach.",
        "L'objectif est de construire un système capable de conserver les informations importantes d'une journée afin d'aider à prendre des décisions cohérentes avec la réalité.",
        "Un bon système ne doit pas seulement connaître ce qui était prévu. Il doit comprendre ce qui s'est réellement passé.",
      ],
    },
  },

  about: {
    origin:
      "NALYNT est né d'un besoin concret : encadrer un entraînement de VTT Downhill Elite qui varie chaque jour, sans se contenter d'un plan figé à l'avance qui ignore la fatigue, la douleur ou une semaine professionnelle chargée.",
    athleteContext:
      "Le système est construit et testé en premier lieu sur un cas réel — un pilote suisse Elite de VTT Downhill, dont l'entraînement combine préparation physique, technique DH, gestion mentale de course, récupération et vie professionnelle.",
    whyItExists:
      "NALYNT existe pour rendre visible, chaque jour, l'écart entre ce qui était prévu et ce qui a réellement été fait — et pour que cette information serve les décisions suivantes plutôt que d'être perdue.",
  },

  limits: {
    notMedical:
      "NALYNT n'est pas un système médical. Il ne pose aucun diagnostic et oriente vers un médecin, un physiothérapeute ou un autre professionnel de santé dès qu'un signal le justifie.",
    notAutonomousAI:
      "NALYNT ne prend pas de décision autonome et opaque. Chaque adaptation proposée suit une règle de coaching explicite, écrite et validée par un humain.",
    noAutomaticProgress:
      "NALYNT ne promet pas de progression automatique. Le système mémorise des faits — ce qui a été prescrit, ce qui a été fait, le résultat rapporté — mais ne décide pas aujourd'hui, seul, d'augmenter ou de réduire une charge d'entraînement sur cette base.",
  },

  closingCta: {
    text: "Envie d'en discuter ou de suivre l'avancée du projet ?",
    ctaLabel: "Nous contacter",
    ctaHref: "/contact",
  },

  disclaimer: {
    text: "NALYNT ne remplace pas un médecin, un physiothérapeute, un ostéopathe ou tout autre professionnel de santé. Il oriente vers eux quand nécessaire.",
  },

  nav: [
    { label: "Accueil", href: "/" },
    { label: "Comment ça marche", href: "/comment-ca-marche" },
    { label: "Le modèle de coaching", href: "/coaching" },
    { label: "Philosophie", href: "/philosophie" },
    { label: "À propos", href: "/a-propos" },
    { label: "Contact", href: "/contact" },
  ],
};
