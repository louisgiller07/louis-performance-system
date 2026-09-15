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
 */
export interface StoryOriginCopy {
  eyebrow: string;
  /** Two-line editorial headline — exact line break preserved, not CSS wrap. */
  title: [string, string];
  intro: string;
  /** Four short staccato fragments — rendered as distinct lines, not a paragraph. */
  contrastList: [string, string, string, string];
  turn: string;
  origin: string;
  approach: string;
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

export interface SiteCopy {
  hero: HeroCopy;
  /** Une phrase unique résumant la valeur centrale — utilisable en meta description. */
  coreValueProposition: string;
  keyMessages: KeyMessagesCopy;
  storyOrigin: StoryOriginCopy;
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
    intro:
      "Un entraînement prévu plusieurs jours à l’avance ne rencontre jamais exactement les mêmes conditions une fois arrivé sur le terrain.",
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
