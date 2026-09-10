// Client-side mirror of supabase/functions/completed-session/validation.ts's
// status-dependent numeric matrix, pain-shape rules, and (V0.3_007B) rich
// performed-intervention rules — not the source of truth (the Edge
// Function/RPC re-validate authoritatively), but what drives "Save disabled
// until valid" and inline field errors. Accumulates every applicable field
// error into one object (never short-circuits on the first failure) — same
// discipline as the pre-007B version, so e.g. both fatigue fields can be
// reported missing in the same pass.
import type { CompletedSessionFormState, CompletedSessionInput, SessionType } from "./completedSessionTypes";
import { validatePerformedIntervention, type TrainingIntervention } from "./performedInterventionTypes";
import { mapTrainingInterventionToSessionType } from "../dailyPlan/trainingInterventionToSessionType";

export type CompletedSessionFieldErrors = Partial<Record<keyof CompletedSessionFormState, string>>;
export type ValidateCompletedSessionResult =
  | { ok: true; values: CompletedSessionInput }
  | { ok: false; errors: CompletedSessionFieldErrors };

function inRange0to10(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10;
}

export function validateCompletedSessionForm(state: CompletedSessionFormState, sessionDate: string): ValidateCompletedSessionResult {
  const errors: CompletedSessionFieldErrors = {};

  // V0.3_007B — the ONE athlete-authored fact for a performed session: the
  // rich `intervention` (done/partial/replaced) or nothing at all
  // (skipped — no performed intervention concept, see completedSessionTypes.ts).
  // `session_type` is NEVER independently chosen: for done/partial/replaced
  // it is always mapTrainingInterventionToSessionType(intervention) (the
  // same canonical derivation Planning already uses for
  // planned_sessions.session_type); for skipped it is the athlete's own
  // skipped_session_type choice (the coarse type of the session that was
  // skipped — unchanged pre-007B meaning).
  let intervention: TrainingIntervention | null = null;
  let effectiveSessionType: SessionType | null = null;

  if (state.completion_status === "skipped") {
    if (state.skipped_session_type === "") {
      errors.skipped_session_type = "Sélectionne le type de séance qui n'a pas été fait.";
    } else {
      effectiveSessionType = state.skipped_session_type;
    }
  } else if (state.performed_kind === "") {
    errors.performed_kind = "Sélectionne l'activité réellement effectuée.";
  } else {
    const validated = validatePerformedIntervention(state.performed_kind, state.performed_load);
    if (!validated.ok) {
      errors.performed_load = validated.error;
    } else {
      intervention = validated.intervention;
      effectiveSessionType = mapTrainingInterventionToSessionType(validated.intervention);
    }
  }

  let duration: number | null = null;
  let rpe: number | null = null;
  let legFatigue: number | null = null;
  let gripFatigue: number | null = null;

  // M5_003 final review: a REST performed/skipped activity never requires
  // an invented duration/RPE — the frozen M5_001A DB/RPC contract already
  // allows these null. Deliberately not generalized to any other kind.
  // effectiveSessionType is null only when the block above already recorded
  // a blocking error (performed_kind/skipped_session_type unresolved) — the
  // numeric checks below still run so every applicable error surfaces in
  // the same pass, exactly like the pre-007B behavior.
  const isRest = effectiveSessionType === "REST";

  if (state.completion_status === "skipped" || (isRest && state.completion_status !== "partial")) {
    if (state.post_leg_fatigue !== "") {
      if (!inRange0to10(state.post_leg_fatigue)) errors.post_leg_fatigue = "Doit être entre 0 et 10.";
      else legFatigue = state.post_leg_fatigue;
    }
    if (state.post_grip_fatigue !== "") {
      if (!inRange0to10(state.post_grip_fatigue)) errors.post_grip_fatigue = "Doit être entre 0 et 10.";
      else gripFatigue = state.post_grip_fatigue;
    }
  } else if (isRest && state.completion_status === "partial") {
    // "Partial rest" is not a meaningful M5 state.
    errors.completion_status = "Repos partiel n'est pas un statut valide. Choisis Faite ou Non faite, ou change l'activité.";
  } else {
    if (state.actual_duration_min === "") {
      errors.actual_duration_min = "Requis.";
    } else if (!Number.isInteger(state.actual_duration_min) || state.actual_duration_min <= 0) {
      errors.actual_duration_min = "Doit être un entier positif (minutes).";
    } else {
      duration = state.actual_duration_min;
    }

    if (state.rpe === "") {
      errors.rpe = "Requis.";
    } else if (!inRange0to10(state.rpe)) {
      errors.rpe = "Doit être entre 0 et 10.";
    } else {
      rpe = state.rpe;
    }

    if (state.post_leg_fatigue === "") {
      errors.post_leg_fatigue = "Requis.";
    } else if (!inRange0to10(state.post_leg_fatigue)) {
      errors.post_leg_fatigue = "Doit être entre 0 et 10.";
    } else {
      legFatigue = state.post_leg_fatigue;
    }

    if (state.post_grip_fatigue === "") {
      errors.post_grip_fatigue = "Requis.";
    } else if (!inRange0to10(state.post_grip_fatigue)) {
      errors.post_grip_fatigue = "Doit être entre 0 et 10.";
    } else {
      gripFatigue = state.post_grip_fatigue;
    }
  }

  if (state.new_pain === null) {
    errors.new_pain = "Réponds Oui ou Non.";
  }

  let painNote: string | null = null;
  if (state.new_pain === true) {
    const trimmed = state.new_pain_note.trim();
    if (trimmed.length < 1) {
      errors.new_pain_note = "Décris brièvement la douleur.";
    } else if (trimmed.length > 500) {
      errors.new_pain_note = "500 caractères maximum.";
    } else {
      painNote = trimmed;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      session_date: sessionDate,
      decision_id: state.decision_id,
      // Safe: errors.performed_kind/skipped_session_type would have
      // blocked this return above if effectiveSessionType were still null.
      session_type: effectiveSessionType as SessionType,
      completion_status: state.completion_status,
      actual_duration_min: duration,
      rpe,
      post_leg_fatigue: legFatigue,
      post_grip_fatigue: gripFatigue,
      new_pain: state.new_pain as boolean,
      new_pain_note: painNote,
      intervention,
      main_content: state.main_content,
    },
  };
}
