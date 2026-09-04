/**
 * Politique de domaine Technique DH (V0.3_002B) — PAS un fait athlète (voir
 * `public.athlete_coaching_profiles`/`RawContext.coaching_profile` pour ça,
 * V0.3_004A), PAS un seuil M1 (voir engine/provisionalThresholds.ts, jamais
 * modifié par ce fichier).
 *
 * `raceProximityWindowDays` implémente C1.5 (docs/03_COACHING_MODEL.md :
 * "course ≤ 2 semaines") — un horizon volontairement distinct de la fenêtre
 * PRE_EVENT de 7 jours utilisée par engine/eventContext.ts et
 * rules/raceProtocol.ts. Les deux fenêtres coexistent sans se substituer
 * l'une à l'autre — voir docs/06_ARCHITECTURE.md §V0.3_002.
 */
export interface TechniquePolicy {
  readonly raceProximityWindowDays: number;
}

export const TECHNIQUE_POLICY: TechniquePolicy = {
  raceProximityWindowDays: 14,
};
