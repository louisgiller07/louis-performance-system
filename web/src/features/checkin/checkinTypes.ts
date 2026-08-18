// Field classification derived from the real schema
// (supabase/migrations/20260814095000_baseline_v0_2.sql,
// 20260814133000_M2_001_daily_checkins_pain_criteria.sql) and the real M2
// adapter contract (head-coach-engine/src/supabase/mapping/dailyCheckinRow.ts,
// dailyCheckinPainCriteria.ts) — not invented:
//
// - Required unconditionally (adapter throws IncompleteDailyCheckinError if
//   missing): sleep_hours, sleep_quality, sleep_wake_ups, energy,
//   work_stress, motivation, leg_fatigue, grip_fatigue, pain, pain_new,
//   suspected_concussion, fever_or_illness. In the form, pain/
//   suspected_concussion/fever_or_illness/pain_new are collected as an
//   explicit tri-state Oui/Non (never pre-selected) — an unanswered
//   health/safety question must never be silently saved as "non".
// - Required unconditionally too, but semantically only meaningful when
//   pain=true (adapter throws IncompleteCheckinPainCriteriaError if
//   missing, regardless of `pain`): pain_traumatic, pain_function_loss,
//   pain_getting_worse. Same tri-state discipline: explicit Oui/Non only
//   when pain=true, normalized to false in the saved payload when pain=false
//   (see checkinValidation.ts — not a safety decision, just "not applicable").
// - Conditionally required: pain_intensity — DB CHECK
//   (pain_intensity_requires_pain) demands NOT NULL iff pain=true, NULL iff
//   pain=false.
// - Optional always: pain_location_code, free_comment.
// - System-managed, never user-editable: id, athlete_id, checkin_date,
//   submitted_at, created_at, updated_at.
//
// `pain_location` (legacy free-text column) is deliberately not surfaced —
// the M2 adapter never reads it (only `pain_location_code`).

export const PAIN_LOCATION_CODES = [
  "lower_back",
  "upper_back",
  "neck",
  "shoulder_L",
  "shoulder_R",
  "elbow_L",
  "elbow_R",
  "wrist_L",
  "wrist_R",
  "hand_L",
  "hand_R",
  "thumb_L",
  "thumb_R",
  "forearm_L",
  "forearm_R",
  "hip_L",
  "hip_R",
  "knee_L",
  "knee_R",
  "ankle_L",
  "ankle_R",
  "quad_L",
  "quad_R",
  "hamstring_L",
  "hamstring_R",
  "calf_L",
  "calf_R",
  "groin",
  "chest",
  "abs",
  "head",
  "other",
] as const;

export type PainLocationCode = (typeof PAIN_LOCATION_CODES)[number];

/** Row shape as read from `daily_checkins` — reflects real DB nullability. */
export interface CheckinRow {
  checkin_date: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  sleep_wake_ups: number | null;
  energy: number | null;
  work_stress: number | null;
  motivation: number | null;
  leg_fatigue: number | null;
  grip_fatigue: number | null;
  pain: boolean;
  pain_intensity: number | null;
  pain_new: boolean | null;
  pain_location_code: PainLocationCode | null;
  pain_traumatic: boolean | null;
  pain_function_loss: boolean | null;
  pain_getting_worse: boolean | null;
  suspected_concussion: boolean;
  fever_or_illness: boolean;
  free_comment: string | null;
}

/** Validated payload the repo saves — satisfies both the DB CHECKs and the M2 adapter's required-field contract. */
export interface CheckinInput {
  sleep_hours: number;
  sleep_quality: number;
  sleep_wake_ups: number;
  energy: number;
  work_stress: number;
  motivation: number;
  leg_fatigue: number;
  grip_fatigue: number;
  pain: boolean;
  pain_intensity: number | null;
  pain_new: boolean;
  pain_location_code: PainLocationCode | null;
  pain_traumatic: boolean;
  pain_function_loss: boolean;
  pain_getting_worse: boolean;
  suspected_concussion: boolean;
  fever_or_illness: boolean;
  free_comment: string | null;
}

/**
 * Raw, in-progress form state — numeric fields may be "" while the user is
 * typing. Health/safety booleans are tri-state (`boolean | null`):
 * `null` means "not yet answered" and must never be silently treated as
 * `false` — an unanswered "suspicion de commotion ?" is not the same fact
 * as an explicit "non". Only `CheckinInput` (the validated save payload)
 * ever collapses these to a real `boolean`, and only after the user gave
 * an explicit answer (see checkinValidation.ts).
 */
export interface CheckinFormState {
  sleep_hours: number | "";
  sleep_quality: number | "";
  sleep_wake_ups: number | "";
  energy: number | "";
  work_stress: number | "";
  motivation: number | "";
  leg_fatigue: number | "";
  grip_fatigue: number | "";
  pain: boolean | null;
  pain_intensity: number | "";
  pain_new: boolean | null;
  pain_location_code: PainLocationCode | "";
  pain_traumatic: boolean | null;
  pain_function_loss: boolean | null;
  pain_getting_worse: boolean | null;
  suspected_concussion: boolean | null;
  fever_or_illness: boolean | null;
  free_comment: string;
}

export const EMPTY_CHECKIN_FORM_STATE: CheckinFormState = {
  sleep_hours: "",
  sleep_quality: "",
  sleep_wake_ups: "",
  energy: "",
  work_stress: "",
  motivation: "",
  leg_fatigue: "",
  grip_fatigue: "",
  pain: null,
  pain_intensity: "",
  pain_new: null,
  pain_location_code: "",
  pain_traumatic: null,
  pain_function_loss: null,
  pain_getting_worse: null,
  suspected_concussion: null,
  fever_or_illness: null,
  free_comment: "",
};

export function rowToFormState(row: CheckinRow | null): CheckinFormState {
  if (!row) return EMPTY_CHECKIN_FORM_STATE;
  return {
    sleep_hours: row.sleep_hours ?? "",
    sleep_quality: row.sleep_quality ?? "",
    sleep_wake_ups: row.sleep_wake_ups ?? "",
    energy: row.energy ?? "",
    work_stress: row.work_stress ?? "",
    motivation: row.motivation ?? "",
    leg_fatigue: row.leg_fatigue ?? "",
    grip_fatigue: row.grip_fatigue ?? "",
    // pain/suspected_concussion/fever_or_illness are DB NOT NULL — an
    // existing row always carries a real true/false, never null. The
    // tri-state possibility only matters for a fresh (unsaved) form.
    pain: row.pain,
    pain_intensity: row.pain_intensity ?? "",
    // No `?? false` here: a legacy NULL must stay null (unanswered), never
    // become a fabricated "no".
    pain_new: row.pain_new,
    pain_location_code: row.pain_location_code ?? "",
    pain_traumatic: row.pain_traumatic,
    pain_function_loss: row.pain_function_loss,
    pain_getting_worse: row.pain_getting_worse,
    suspected_concussion: row.suspected_concussion,
    fever_or_illness: row.fever_or_illness,
    free_comment: row.free_comment ?? "",
  };
}
