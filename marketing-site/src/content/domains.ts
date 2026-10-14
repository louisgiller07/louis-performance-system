// The 7 canonical coaching domains (docs/03_COACHING_MODEL.md), in rider
// language for the homepage and /coaching (ART-02). Every `field` example is
// grounded in real, shipped behavior — no invented feature:
// - technique: DH session lightened on high leg/grip fatigue; last technical
//   task outcome recalled as a factual reminder on a later DH prescription;
// - mental: high work stress / low motivation (check-in) → one simple
//   regulation action (AMBER); RED lowers the session's cognitive load, not
//   its physical nature. ART-RELEASE-01: the personal pre-race cue
//   (athlete_coaching_profiles.mental_pre_race_cue) has no input in the app,
//   so a new rider cannot have one — not promised;
// - physique: high leg fatigue pivots lower-body strength to upper body, or
//   to active recovery when grip is also very tired;
// - sommeil: short/fragmented night lowers intensity + specific recovery note;
// - nutrition: guidance follows the final session of the day, not the plan;
// - vie: the session adapts to the time available today (check-in available
//   minutes, A10); weekly sessions are also placed on dates whose
//   availability window can hold them (planning-engine weekSegmenter,
//   V0.4_105 / V06-03 — the homepage Act I relies on it);
// - progression: recent facts recalled later, purely factual; longer-term
//   patterns go through a human review before counting.
//
// Copy validated before publication (2026-10).

export interface CoachingDomain {
  id: "technique" | "mental" | "physique" | "recuperation" | "nutrition" | "vie" | "progression";
  name: string;
  /** Editorial headline of the domain. */
  title: string;
  intro: string;
  /** Concrete "sur le terrain" example. */
  field: string;
}

export const domains: CoachingDomain[] = [
  {
    id: "technique",
    name: "Technique",
    title: "Une vraie tâche sur la piste.",
    intro: "Chaque séance DH garde un objectif technique précis.",
    field: "Jambes lourdes ? La séance DH est allégée, et le résultat de ta dernière tâche technique revient comme repère.",
  },
  {
    id: "mental",
    name: "Mental",
    title: "Un repère au bon moment.",
    intro: "La préparation tient compte de ton stress et de ta motivation du jour.",
    field: "Stress élevé ou motivation en berne : une action simple t'aide à te recentrer avant ta séance, et la charge mentale baisse quand c'est nécessaire.",
  },
  {
    id: "physique",
    name: "Physique",
    title: "La force qui suit ton état.",
    intro: "La séance physique tient compte de ta fatigue et complète ton riding.",
    field: "Jambes lourdes : le travail bascule vers le haut du corps, ou vers de la récupération active si le grip est aussi à bout.",
  },
  {
    id: "recuperation",
    name: "Sommeil et récupération",
    title: "Récupérer fait partie du plan.",
    intro: "Ton sommeil et ta récupération comptent dans la séance proposée.",
    field: "Nuit courte ou hachée : l'intensité baisse et une consigne de récupération précise accompagne la journée.",
  },
  {
    id: "nutrition",
    name: "Nutrition et hydratation",
    title: "Pour la séance que tu fais vraiment.",
    intro: "Les repères nutrition suivent l'entraînement du jour.",
    field: "Ta séance de force devient de la récupération ? La consigne nutrition suit la séance du jour, pas celle écrite il y a trois semaines.",
  },
  {
    id: "vie",
    name: "Vie hors vélo",
    title: "Un plan qui tient dans ta vie.",
    intro: "Ton travail et ton temps disponible ont leur place dans la séance.",
    field: "Tu as moins de temps aujourd'hui ? Indique-le au check-in : la séance s'ajuste au temps que tu as vraiment.",
  },
  {
    id: "progression",
    name: "Progression",
    title: "Garder le fil de ta saison.",
    intro: "Le réalisé et les faits récents servent de repères pour la suite.",
    field: "Le résultat de ta dernière tâche technique revient au bon moment. Les tendances de fond sont validées avant d'influencer ton coaching.",
  },
];
