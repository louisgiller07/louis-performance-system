/**
 * DailyCheckin — voir docs/05_DATA_MODEL.md §daily_checkins.
 *
 * Les champs douleur enrichis (pain_traumatic, pain_function_loss,
 * pain_getting_worse) sont requis par SAFETY (docs/04_DAILY_DECISION_ENGINE.md
 * §RawContext) mais n'existent pas encore dans la table Supabase daily_checkins.
 * Décision tracée dans docs/11_DECISION_LOG.md (2026-08-11 — Champs douleur
 * enrichis en RawContext, migration DB reportée à M2). En M1 (local), ils
 * vivent uniquement dans ce type et les fixtures.
 */
export type PainLocationCode = string;

export interface DailyCheckin {
  date: string; // ISO date (YYYY-MM-DD)

  sleep_hours: number;
  sleep_quality: number; // 0-10, plus haut = meilleur
  sleep_wake_ups: number;

  energy: number; // 0-10
  work_stress: number; // 0-10, plus haut = plus de stress
  motivation: number; // 0-10, plus haut = plus motivé

  leg_fatigue: number; // 0-10, plus haut = plus fatigué
  grip_fatigue: number; // 0-10, plus haut = plus fatigué

  pain: boolean;
  pain_intensity: number; // 0-10
  pain_new: boolean;
  pain_location_code?: PainLocationCode;

  // Champs douleur enrichis — M1 local uniquement, voir docstring ci-dessus.
  pain_traumatic: boolean;
  pain_function_loss: boolean;
  pain_getting_worse: boolean;

  suspected_concussion: boolean;
  fever_or_illness: boolean;

  free_comment?: string;
}
