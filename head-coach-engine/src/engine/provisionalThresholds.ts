/**
 * Seuils numériques PROVISIONAL — voir docs/01_PRODUCT_REQUIREMENTS.md
 * principe #10 et docs/08_CONVENTIONS.md §Communication dans le code.
 *
 * Aucun de ces seuils n'est calibré sur les données longitudinales de Louis.
 * Ils sont centralisés ici (plutôt que dispersés dans rules/ et domains/)
 * pour qu'une future calibration (V0.3+, données réelles) n'ait qu'un seul
 * endroit à modifier. Toute évolution doit rester traçable dans
 * docs/11_DECISION_LOG.md si elle change un comportement métier documenté.
 */
export const PROVISIONAL_THRESHOLDS = {
  // Dimension `systemic` (sommeil + énergie globale). Chaque seuil correspond
  // à un signal causal distinct (sleep_deficit / sleep_quality_low /
  // energy_low / sleep_fragmented) — voir docs/11_DECISION_LOG.md 2026-08-13
  // et computeSystemic() dans engine/computeDimensions.ts. Ne jamais fusionner
  // ces causes sous un seul signal générique : le double-counting (docs/03_COACHING_MODEL.md §3)
  // se juge signal par signal, pas dimension par dimension.
  systemic: {
    redMaxSleepHours: 6, // sleep_hours < 6 → RED, signal sleep_deficit
    amberMaxSleepHours: 7, // sleep_hours < 7 → AMBER, signal sleep_deficit
    amberMaxSleepQuality: 5, // sleep_quality <= 5 → AMBER, signal sleep_quality_low
    amberMaxEnergy: 4, // energy <= 4 → AMBER, signal energy_low
    amberMinWakeUps: 2, // sleep_wake_ups >= 2 → AMBER, signal sleep_fragmented
  },

  // Dimensions `legs` / `arms_grip` (fatigue déclarée 0-10)
  fatigue: {
    redMinFatigue: 7,
    amberMinFatigue: 4,
  },

  // Dimension `mental` (stress travail + motivation, 0-10)
  mental: {
    redMinStress: 7,
    amberMinStress: 5,
    redMaxMotivation: 3,
    amberMaxMotivation: 5,
  },

  // Dimension `health` (douleur non-SAFETY)
  health: {
    redMinPainIntensity: 6, // aligné sur le seuil SAFETY A2 (docs/04 §2) mais évalué indépendamment
  },

  // Dimension `recent_load` (charge 7 jours, cf. docs/04_DAILY_DECISION_ENGINE.md §4 C3.7)
  recentLoad: {
    windowDays: 7,
    amberMinHeavyOrModerateSessions: 3,
    redMinHeavyOrModerateSessions: 5,
  },

  // Couche B — Race/Event context
  event: {
    preEventWindowDays: 7, // T-X s'applique pour days_to_event in [1, 7]
    postEventWindowDays: 2, // fenêtre post-event utile : days_since_event_end <= 2
  },

  // Couche C — Sommeil (C4.1)
  sleep: {
    targetHoursBaseline: 8,
  },

  // V0.3_008B — Continuité technique. PROVISIONAL PRODUCT-FRESHNESS
  // CONSTANT, pas une durée de récupération physiologique, pas une vérité
  // spécifique à Louis, pas une loi d'entraînement Elite — voir
  // docs/11_DECISION_LOG.md V0.3_008B. Fenêtre strictement inter-jours
  // (D-14 <= session_date < D, jour même et futur exclus).
  // `candidateLimit` dérive mathématiquement de la contrainte DB
  // `unique_completed_per_day UNIQUE (athlete_id, session_date)` : au plus
  // une ligne éligible par jour calendaire dans la fenêtre, donc au plus
  // `windowDays` lignes possibles — jamais un plafond arbitraire.
  recentTechnicalContext: {
    windowDays: 14,
    candidateLimit: 14,
  },
} as const;
