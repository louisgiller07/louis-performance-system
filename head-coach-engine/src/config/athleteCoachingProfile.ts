/**
 * Config de coaching-profil statique — mono-athlète, V0.3, PROVISIONAL.
 * Voir docs/06_ARCHITECTURE.md §V0.3_002 (Option A bornée). Faits
 * spécifiquement propres à Louis uniquement — jamais de constante
 * heuristique générique (voir techniquePolicy.ts pour ça), jamais de
 * donnée opérationnelle courante (spot/venue/météo/disponibilité).
 *
 * Remplacement multi-athlète futur attendu — ce fichier n'est pas conçu
 * pour scaler au-delà d'un seul athlète.
 */
export interface AthleteCoachingProfile {
  readonly technique: {
    readonly primaryFocus: {
      readonly id: string;
      readonly focus: string;
    };
  };
  readonly mental: {
    readonly preRaceCue: {
      readonly id: string;
      readonly cue: string;
    };
  };
}

/**
 * `technique.primaryFocus.focus` est une formulation PROVISIONAL nouvellement
 * approuvée en V0.3_002B — pas une citation directe de Louis. Elle dérive de
 * la priorité de développement technique déjà canonique
 * (docs/02_ATHLETE_PROFILE.md §7.2 "tendance au surfreinage par peur" en
 * sections rapides/précises + §12 item 4, seule faiblesse technique
 * explicitement élevée au rang de priorité de développement).
 *
 * `mental.preRaceCue.cue` est une cue mentale déjà canonique (V0.3_002C) —
 * dérivée directement de docs/02_ATHLETE_PROFILE.md §7.4/§8 (course flow de
 * référence Wiriehorn) et de docs/03_COACHING_MODEL.md C2.1 ("Comme à
 * Wiriehorn", hypothèse issue de l'onboarding, révisable).
 */
export const ATHLETE_COACHING_PROFILE: AthleteCoachingProfile = {
  technique: {
    primaryFocus: {
      id: "fast_precision_overbraking",
      focus: "Fixe ta ligne, dose le freinage, laisse rouler.",
    },
  },
  mental: {
    preRaceCue: {
      id: "wiriehorn_flow_reference",
      cue: "Comme à Wiriehorn.",
    },
  },
};
