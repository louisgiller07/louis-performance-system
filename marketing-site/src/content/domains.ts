// The 7 canonical coaching domains (docs/03_COACHING_MODEL.md). Every
// `example` below is grounded in real, shipped head-coach-engine behavior —
// no invented feature. Where a domain is still immature/dormant in the
// engine (see docs/03_COACHING_MODEL.md §Maturité par domaine), the
// description says so honestly rather than overclaiming.
//
// NEEDS HUMAN VALIDATION: wording/tone proposal, not final marketing copy.

export interface CoachingDomain {
  id: string;
  name: string;
  description: string;
  example: string;
}

export const domains: CoachingDomain[] = [
  {
    id: "technique",
    name: "Technique",
    description:
      "Une tâche technique concrète pour la séance DH du jour, ajustée selon la fatigue et la proximité d'une course — jamais un objectif générique répété sans changement.",
    example:
      "Après une fatigue jambes/grip déclarée élevée, la séance DH du jour est allégée plutôt que maintenue telle quelle. La dernière tâche technique enregistrée (réussie, partielle ou non) reste visible comme rappel factuel lors d'une prescription DH ultérieure.",
  },
  {
    id: "mental",
    name: "Mental",
    description:
      "Un repère mental concret pour la journée, activé seulement quand le contexte le justifie — pas un message générique de motivation.",
    example:
      "À l'approche d'une course, un rappel mental personnel resurgit dans la prescription du jour. En cas de stress élevé déclaré, la charge cognitive de la séance est réduite sans changer sa nature physique.",
  },
  {
    id: "physique",
    name: "Physique",
    description:
      "La séance physique du jour, adaptée selon l'état réel déclaré au check-in — sommeil, fatigue jambes/grip, charge des 7 derniers jours.",
    example:
      "Une fatigue jambes élevée fait pivoter une séance de force bas du corps vers le haut du corps (ou vers de la récupération active si le grip est lui aussi très fatigué) plutôt que de maintenir une séance à risque.",
  },
  {
    id: "sommeil",
    name: "Sommeil",
    description:
      "Des actions concrètes de récupération, pas une injonction générique à « mieux dormir ».",
    example:
      "Une nuit courte ou un sommeil fragmenté déclarés réduisent l'intensité de la séance du jour et déclenchent une note de récupération spécifique, jamais une simple alerte sans effet sur le plan.",
  },
  {
    id: "nutrition",
    name: "Nutrition",
    description:
      "Des consignes nutritionnelles contextuelles à la séance réellement retenue pour le jour, pas un plan alimentaire fixe.",
    example:
      "La consigne nutrition suit la séance finale du jour, même quand elle diffère de ce qui était initialement prévu — si une séance de force planifiée est remplacée par de la récupération, la consigne nutrition liée à la force ne s'affiche plus.",
  },
  {
    id: "charge-pro-vie",
    name: "Charge professionnelle / vie",
    description:
      "Domaine encore le moins mature du système : aujourd'hui, le contexte hors-sport influence le plan via le mode d'entraînement déclaré par l'athlète (ex. période de récupération hors-saison), pas encore via une détection automatique de charge professionnelle ou personnelle.",
    example:
      "En période de récupération déclarée, une séance de développement physique n'est pas proposée par défaut, sauf raison explicite documentée par l'athlète.",
  },
  {
    id: "analyse-longitudinale",
    name: "Analyse longitudinale",
    description:
      "Des faits construits dans la durée à partir des séances réelles, jamais une interprétation immédiate imposée au plan du jour.",
    example:
      "Le système retient un fait récent — par exemple le résultat de la dernière tâche technique ou une séance J-1 marquée par de la fatigue — et le rappelle lors d'une prescription ultérieure, à titre purement factuel. D'éventuels patterns identifiés sur la durée passent par une revue humaine avant d'être considérés confirmés — ils ne sont jamais activés automatiquement dans le coaching quotidien.",
  },
];
