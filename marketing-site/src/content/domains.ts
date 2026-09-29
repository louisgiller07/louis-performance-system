// The 7 canonical coaching domains (docs/03_COACHING_MODEL.md), in rider
// language for /coaching (V3). Every `field` example below is grounded in
// real, shipped behavior — no invented feature:
// - technique: DH session lightened on high leg/grip fatigue; last technical
//   task outcome recalled as a factual reminder on a later DH prescription;
// - mental: personal race-day cue resurfaces near a race; high declared
//   stress lowers the session's cognitive load, not its physical nature;
// - physique: high leg fatigue pivots lower-body strength to upper body, or
//   to active recovery when grip is also very tired;
// - sommeil: short/fragmented night lowers intensity + specific recovery note;
// - nutrition: guidance follows the final session of the day, not the plan;
// - vie: weekly sessions are placed inside the athlete's availability
//   windows (planning engine v2 — slot capacity); still the least mature
//   domain, so nothing more is claimed;
// - progression: recent facts recalled later, purely factual; longer-term
//   patterns go through a human review before counting.
//
// NEEDS HUMAN VALIDATION: wording/tone proposal, not final marketing copy.

export interface CoachingDomain {
  id: string;
  name: string;
  /** One-line rider promise. */
  promise: string;
  /** Concrete "sur le terrain" example. */
  field: string;
}

export const domains: CoachingDomain[] = [
  {
    id: "technique",
    name: "Technique",
    promise: "Une vraie tâche technique à chaque séance DH.",
    field:
      "Jambes cuites ? La séance DH est allégée plutôt que maintenue coûte que coûte. Et le résultat de ta dernière tâche technique revient comme repère la fois suivante.",
  },
  {
    id: "mental",
    name: "Mental",
    promise: "Le bon repère mental, au bon moment.",
    field:
      "À l'approche d'une course, ton rappel mental personnel revient dans la séance du jour. Stress élevé : la séance reste physique, mais la charge mentale baisse.",
  },
  {
    id: "physique",
    name: "Physique",
    promise: "La séance physique qui colle à ton état.",
    field:
      "Jambes lourdes : la force bas du corps bascule vers le haut du corps, ou vers de la récupération active si le grip est lui aussi à bout.",
  },
  {
    id: "sommeil",
    name: "Sommeil & récupération",
    promise: "Récupérer, c'est aussi s'entraîner.",
    field:
      "Nuit courte ou hachée : l'intensité du jour baisse et tu reçois une consigne de récupération précise, pas juste une alerte.",
  },
  {
    id: "nutrition",
    name: "Nutrition & hydratation",
    promise: "Manger pour la séance que tu fais vraiment.",
    field:
      "Ta force prévue devient de la récupération ? La consigne nutrition suit la séance du jour, pas celle écrite il y a trois semaines.",
  },
  {
    id: "charge-pro-vie",
    name: "Vie hors vélo",
    promise: "Ton travail et ta vie comptent aussi.",
    field:
      "Tes disponibilités structurent ta semaine : chaque séance se place dans un créneau où elle tient vraiment, pas sur un planning théorique.",
  },
  {
    id: "analyse-longitudinale",
    name: "Progression",
    promise: "Ta saison, pas seulement ta journée.",
    field:
      "Les faits récents (ta dernière tâche technique, une veille difficile) reviennent au bon moment. Les tendances de fond sont validées avant d'influencer ton coaching.",
  },
];
