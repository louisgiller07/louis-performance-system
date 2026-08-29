/**
 * Politique de domaine Nutrition (V0.3_002D) — PAS un fait athlète (voir
 * athleteCoachingProfile.ts pour ça, qui ne contient aucune extension
 * Nutrition — voir docs/06_ARCHITECTURE.md §V0.3_002 : les baselines
 * d'hydratation PROVISIONAL sont des heuristiques de domaine génériques,
 * pas des faits personnels de Louis), PAS un seuil M1 (voir
 * engine/provisionalThresholds.ts, jamais modifié par ce fichier).
 *
 * Provenance : docs/03_COACHING_MODEL.md C5.2/C5.3/C5.4/C5.6.
 * `baselineHydrationTargetL` est la seule valeur numérique canonique
 * unique (C5.3) — la seule autorisée à peupler `hydration_target_l`.
 * `dhHydrationRangeL` (C5.4) reste une plage, jamais convertie en point
 * médian — texte uniquement dans `notes`. `strengthPostWindowMinutes`
 * (C5.2) et `raceBreakfastLeadHours` (C5.6) n'ont pas de champ `DailyPlan`
 * numérique dédié — texte uniquement.
 */
export interface NutritionPolicy {
  readonly baselineHydrationTargetL: number;
  readonly dhHydrationRangeL: { readonly min: number; readonly max: number };
  readonly strengthPostWindowMinutes: number;
  readonly raceBreakfastLeadHours: number;
}

export const NUTRITION_POLICY: NutritionPolicy = {
  baselineHydrationTargetL: 2,
  dhHydrationRangeL: { min: 3, max: 3.5 },
  strengthPostWindowMinutes: 60,
  raceBreakfastLeadHours: 2,
};
