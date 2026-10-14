// ART-02 — copy of the inner pages (/comment-ca-marche, /coaching,
// /philosophie, /a-propos, /contact), same direction as the homepage
// (content/home.ts). Rewritten from V3: no decorative indexes, no all-caps
// display titles, no free / beta wording, downhill (DH) scope only, no
// first-person founder quote. Same honesty rules as content/copy.ts: every
// statement matches what the app does today (daily check-in, keep / adjust /
// replace with a stated reason, planned vs done history, recent facts
// recalled later).

export interface PageIntroCopy {
  label: string;
  titleLines: string[];
  intro: string;
}

export interface Step {
  title: string;
  body: string;
}

export interface Statement {
  title: string;
  body: string;
}

export const howPage = {
  meta: {
    title: "Comment ça marche — NALYNT",
    description:
      "Tu planifies, tu fais ton check-in, NALYNT ajuste ta séance, tu roules et il retient. Une boucle quotidienne pensée pour les pilotes de descente.",
  },
  intro: {
    label: "Comment ça marche",
    titleLines: ["Chaque jour,", "la bonne séance."],
    intro: "Quatre temps. Une boucle qui tourne chaque jour, jusqu'au jour de course.",
  } satisfies PageIntroCopy,

  loop: {
    title: ["Une boucle simple.", "Chaque jour."],
    aside: "Planifier, faire le point, décider, retenir.",
    exampleTag: "Exemple fictif",
    closing: "Et demain, la boucle repart de ce que tu as vraiment fait.",
    /** Fictional mini-screens, one per step (app labels; values are an example). */
    week: [
      ["Lun", "Renfo bas du corps"],
      ["Mar", "DH technique"],
      ["Mer", "Repos"],
      ["Jeu", "Aérobie"],
      ["Ven", "Entretien vélo"],
      ["Sam", "DH performance"],
      ["Dim", "Course"],
    ] as [string, string][],
    checkin: [
      { label: "Sommeil", value: "6 h 20", level: 0.55 },
      { label: "Énergie", value: "Moyenne", level: 0.5 },
      { label: "Fatigue jambes", value: "Élevée", level: 0.84, key: true },
      { label: "Douleur", value: "Aucune", level: 0.04 },
      { label: "Temps disponible", value: "2 h 30", level: 0.45 },
    ],
    decision: {
      options: ["Garder", "Ajuster", "Remplacer"],
      chosen: 1,
      session: "DH technique",
      from: "4 h",
      to: "2 h 30",
      reason: "Fatigue jambes élevée : volume réduit, objectif technique conservé.",
    },
    history: [
      { session: "DH technique", day: "Mardi", detail: "4 h prévues · 2 h 30 réalisées · ressenti 6/10" },
      { session: "Renfo bas du corps", day: "Lundi", detail: "45 min prévues · 45 min réalisées" },
    ],
    steps: [
      { title: "Planifier", body: "Tes objectifs, tes courses et tes créneaux d'entraînement posent le cadre de ta semaine." },
      { title: "Faire ton check-in", body: "Sommeil, énergie, fatigue, douleur, temps disponible. Quelques secondes le matin, comme tu le dirais à ton coach." },
      { title: "Décider", body: "NALYNT confronte ta séance prévue à ton état du jour et tranche. Toujours avec la raison, en une phrase." },
      { title: "Retenir", body: "Tu notes ce que tu as vraiment fait. Tout reste dans ton historique, et les séances suivantes partent de là." },
    ] satisfies Step[],
  },

  decisions: {
    title: ["Même objectif.", "Trois façons d'y aller."],
    items: [
      { id: "keep", word: "Garder", when: "Bonne nuit, jambes fraîches.", result: "La séance prévue reste. Tu y vas à fond." },
      {
        id: "adjust",
        word: "Ajuster",
        when: "Jambes lourdes, deux heures devant toi.",
        result: "Même objectif, volume réduit : des runs propres plutôt que des runs de trop.",
      },
      {
        id: "replace",
        word: "Remplacer",
        when: "Jambes et grip à bout.",
        result: "La force bas du corps laisse place au haut du corps ou à de la récupération active.",
      },
    ],
    rest: {
      word: "Repos",
      body: "Certaines journées demandent de récupérer plutôt que de s'entraîner. Quand tu déclares un signal de santé préoccupant, NALYNT suspend ses propositions d'entraînement et, selon le signal, t'oriente vers un professionnel de santé.",
    },
  },

  promises: {
    title: "Ce que NALYNT ne fait pas.",
    items: [
      { title: "Décider dans ton dos.", body: "Chaque changement est affiché et expliqué. Tu gardes la main." },
      { title: "Jouer au médecin.", body: "Une douleur qui inquiète ? NALYNT t'oriente vers un médecin ou un physio." },
      { title: "Promettre des miracles.", body: "Il t'aide à t'entraîner juste, chaque jour. Le travail, c'est toi qui le fais." },
    ] satisfies Statement[],
  },

  finish: { title: "Ta prochaine séance t'attend.", lead: "Un check-in, une séance claire, une raison." },
};

export const coachingPage = {
  meta: {
    title: "Le coaching — NALYNT",
    description:
      "Technique, mental, physique, récupération, nutrition, vie hors vélo, progression : sept domaines qui font un pilote de descente rapide, arbitrés chaque jour vers le jour de course.",
  },
  intro: {
    label: "Le coaching",
    titleLines: ["Sept domaines.", "Un seul cap."],
    intro: "Un pilote rapide ne se construit pas que sur le vélo. NALYNT suit tout ce qui compte, et arbitre chaque jour entre eux.",
  } satisfies PageIntroCopy,

  arbitration: {
    title: ["Quand tout tire dans des sens différents,", "NALYNT tranche."],
    body: "Une nuit courte, des jambes lourdes, une course dans dix jours et deux heures devant toi : chaque domaine pousse dans sa direction. NALYNT les met en balance pour te donner une seule séance claire. Et il te dit pourquoi.",
    inputs: ["Sommeil", "Jambes", "Course dans dix jours", "2 h disponibles"],
    outcome: "Une seule séance, expliquée",
  },

  finish: { title: "Entraîne-toi avec un cap.", lead: "Sept domaines, une séance claire chaque jour." },
};

export const philosophyPage = {
  meta: {
    title: "Philosophie — NALYNT",
    description:
      "Nos convictions : la réalité d'abord, un objectif qui ne bouge pas, chaque décision expliquée, la qualité avant le volume. Et ce qu'on s'interdit.",
  },
  intro: {
    label: "Philosophie",
    titleLines: ["S'entraîner juste.", "Pas plus. Pas moins."],
    intro: "Ce en quoi on croit, et ce qu'on s'interdit. Parce qu'un pilote doit pouvoir faire confiance à son coach.",
  } satisfies PageIntroCopy,

  convictions: {
    title: "Nos convictions.",
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
    title: "Ce qu'on s'interdit.",
    items: [
      {
        title: "Jouer au médecin.",
        body: "NALYNT ne pose aucun diagnostic. Quand un signal de santé l'exige, il t'oriente vers un professionnel de santé.",
      },
      { title: "Décider à ta place.", body: "NALYNT propose et explique. Tu gardes le dernier mot sur ta séance." },
      {
        title: "Promettre la lune.",
        body: "Il garde la mémoire de tes séances, mais ne décide pas seul d'augmenter ta charge. Progresser reste ton travail.",
      },
    ] satisfies Statement[],
  },

  finish: { title: "Prêt à t'entraîner juste ?", lead: "Ton objectif reste. Le plan s'adapte." },
};

export const aboutPage = {
  meta: {
    title: "À propos — NALYNT",
    description: "NALYNT est né dans le VTT de descente de compétition, construit et testé chaque jour par Louis Giller, pilote Elite suisse.",
  },
  intro: {
    label: "À propos",
    titleLines: ["Construit", "depuis le terrain."],
    intro: "NALYNT est né sur les pistes de DH, d'une question qu'un pilote se pose chaque matin avant de rouler.",
  } satisfies PageIntroCopy,
  imageAlt: "Louis Giller en plein saut sur une piste de VTT descente, au-dessus d'une bosse de terre.",

  origin: {
    lead: "Un plan peut être parfait sur le papier. Le jour J, la réalité a souvent changé.",
    contrast: ["Une récupération différente.", "Une fatigue qui s'accumule.", "Une contrainte extérieure.", "Un mental qui n'est pas au rendez-vous."],
    mapLegend: { planned: "Le plan sur le papier", actual: "La réalité du jour", goal: "Jour J" },
    questionIntro: "La question n'est plus seulement :",
    questionOld: "Qu'est-ce qui était prévu ?",
    questionBridge: "Mais :",
    questionNew: "Quelle est la meilleure décision aujourd'hui ?",
  },

  founder: {
    title: "Le fondateur.",
    text: [
      "Pilote de descente en compétition, Louis vit chaque jour ce que NALYNT cherche à résoudre : concilier la piste, la préparation physique, la récupération, le travail et les courses.",
      "Il est le premier utilisateur de NALYNT et teste chaque évolution sur ses propres séances avant qu'elle n'arrive chez d'autres pilotes.",
    ],
    name: "Louis Giller",
    role: "Pilote Elite DH, Suisse. Fondateur de NALYNT.",
    card: [
      ["Discipline", "VTT de descente (DH)"],
      ["Niveau", "Elite"],
      ["Pays", "Suisse"],
      ["Rôle", "Fondateur, premier utilisateur"],
    ] as [string, string][],
    imageAlt: "Louis Giller en course sur une piste de VTT descente rocailleuse, dans un nuage de poussière.",
  },

  downhill: {
    title: ["Un sport où chaque erreur", "se paie tout de suite."],
    body: [
      "En DH, une trajectoire imprécise ou une décision prise trop tard a des conséquences immédiates. La marge d'erreur est minuscule.",
      "La fatigue y pèse directement sur la prise de risque et la qualité de pilotage. Progresser, c'est aussi savoir quand lever le pied.",
      "C'est le terrain le plus exigeant pour construire un coach qui s'adapte. C'est pour ça que NALYNT est né ici.",
    ],
  },

  today: {
    title: "Aujourd'hui.",
    milestones: [
      { label: "Au départ", title: "Un pilote, ses séances.", body: "NALYNT est construit et testé au quotidien par Louis, sur de vraies séances." },
      { label: "Aujourd'hui", title: "La suite se construit.", body: "Conçu pour les pilotes de descente qui veulent progresser avec un plan adapté à leur réalité.", current: true },
      { label: "Demain", title: "Plus de pilotes, plus de terrain.", body: "Chaque retour de pilote rend le coaching plus juste, toujours validé avant d'arriver dans l'app." },
    ],
    vision: ["Un bon coach ne sait pas seulement ce qui était prévu.", "Il comprend ce qui s'est vraiment passé."],
  },

  finish: { title: "Rejoins l'aventure.", lead: "Construit avec les pilotes, sur le terrain." },
};

export const contactPage = {
  meta: {
    title: "Contact — NALYNT",
    description: "Une question ou un retour sur NALYNT ? Écris-nous.",
  },
  intro: {
    label: "Contact",
    titleLines: ["Une question ?", "On t'écoute."],
    intro: "Une question sur NALYNT ou un retour après une séance : écris-nous.",
  } satisfies PageIntroCopy,
  email: "contact@nalynt.ch",
  aside: {
    emailLabel: "Écris-nous directement",
    tryLabel: "Tu préfères essayer ?",
    tryText: "Crée ton compte et fais ton premier check-in dès demain matin.",
  },
};

/**
 * /confidentialite — what happens to what a visitor sends through the contact
 * form. Facts checked against the code and public records (ART-RELEASE-01):
 * - fields: name, e-mail, subject, message, all required, 5000 characters max
 *   each (src/pages/api/contact.ts); the site stores nothing and never logs
 *   the content (errors log a status code only);
 * - path: a Vercel serverless function (region iad1, United States, per the
 *   `x-vercel-id` response header) → Resend e-mail API → contact@nalynt.ch,
 *   a mailbox hosted by Infomaniak (MX record of nalynt.ch);
 * - no cookie, no analytics, self-hosted fonts, no third-party request;
 * - Resend (official docs, 2026-10-14): customer data, message content
 *   included, stored in the United States whatever the sending region
 *   (resend.com/docs/dashboard/domains/regions); email data kept 30 days on
 *   the Free, Pro and Scale plans, Enterprise configurable
 *   (resend.com/docs/knowledge-base/account-quotas-and-limits); DPA in force
 *   for every account, Swiss transfers under the EU SCCs with the Swiss
 *   modifications of the DPA (resend.com/security/gdpr);
 * - Vercel DPA (updated 2026-03-17): Pro and Enterprise plans only; EU SCCs
 *   for transfers from the EEA, the UK and Switzerland (Schedule 3), Swiss
 *   Federal Act on Data Protection included (Schedule 4) (vercel.com/legal/dpa).
 * Confirmed by the operator (HPM decisions, ART-RELEASE-02): Vercel Pro,
 * Resend Free, contact messages kept 6 months at most after the last exchange
 * (monthly purge), controller details by link to the app notice (option C).
 * `TO_CONFIRM` marks a fact the operator must confirm before publication; the
 * release checks fail while one is left in the page. Never replace it with an
 * invented retention period or legal commitment.
 */
export const TO_CONFIRM = "À CONFIRMER";

export const privacyPage = {
  meta: {
    title: "Confidentialité — NALYNT",
    description: "Ce que deviennent les données que tu envoies par le formulaire de contact de NALYNT.",
  },
  intro: {
    label: "Confidentialité",
    titleLines: ["Ce que tu nous écris,", "et ce qu'on en fait."],
    intro: "Cette notice couvre le formulaire de contact de ce site. L'application NALYNT a sa propre notice.",
  } satisfies PageIntroCopy,
  sections: [
    {
      title: "Qui est responsable",
      body: ["Louis Giller, fondateur de NALYNT. Pour toute question sur tes données : contact@nalynt.ch."],
      link: {
        text: "Ses coordonnées complètes figurent dans la",
        label: "notice de confidentialité de l'application",
        href: "https://app.nalynt.ch/privacy",
      },
    },
    {
      title: "Ce que le formulaire collecte",
      body: [
        "Ton nom, ton adresse e-mail, le sujet et ton message. Les quatre champs sont obligatoires, et rien d'autre n'est demandé.",
        "Le site n'utilise ni cookies ni outil de mesure d'audience.",
      ],
    },
    {
      title: "Pourquoi",
      body: ["Pour lire ta demande et te répondre."],
    },
    {
      title: "Par où passe ton message",
      body: [
        "Le site n'enregistre pas ton message. Une fonction serveur hébergée chez Vercel le reçoit, puis le service d'envoi d'e-mails Resend le transmet à la messagerie de NALYNT (contact@nalynt.ch), hébergée chez Infomaniak. Ton message est lu par l'équipe NALYNT.",
      ],
    },
    {
      title: "Hors de Suisse",
      body: [
        "Ton message passe par les États-Unis : la fonction serveur de Vercel qui reçoit le formulaire y est exécutée, et Resend y stocke les données des e-mails, quelle que soit la région d'envoi.",
        "Le contrat de traitement des données de Resend, en vigueur pour chaque compte, encadre ces transferts par les clauses contractuelles types de l'Union européenne, adaptées au droit suisse. Celui de Vercel (plan Pro) les encadre aussi par les clauses contractuelles types de l'Union européenne et couvre la loi suisse sur la protection des données.",
      ],
    },
    {
      title: "Conservation",
      body: [
        "Le site ne conserve pas ton message. Resend conserve les données de l'e-mail (contenu, métadonnées et journaux d'envoi) pendant 30 jours.",
        // The marker stays until the operator confirms the monthly purge is in place (HPM): never published as operational before.
        `Dans la messagerie de NALYNT, ton message est conservé au plus 6 mois après notre dernier échange, puis supprimé, sauf si la loi impose de le garder plus longtemps. [${TO_CONFIRM} : purge mensuelle effectivement en place]`,
      ],
    },
    {
      title: "Tes droits",
      body: ["Tu peux demander l'accès à tes données, leur correction ou leur suppression en écrivant à contact@nalynt.ch."],
    },
  ],
  app: {
    text: "Pour les données de l'application (compte, check-ins, entraînement), voir la",
    link: "notice de confidentialité de l'application",
    href: "https://app.nalynt.ch/privacy",
  },
  // Set to the real publication day on the day of the GO (never a guessed date).
  updated: `Mise à jour : [${TO_CONFIRM} : date réelle de publication]`,
};
