// Client-side mirror of supabase/functions/completed-session/validation.ts's
// status-dependent numeric matrix and pain-shape rules — not the source of
// truth (the Edge Function/RPC re-validate authoritatively), but what
// drives "Save disabled until valid" and inline field errors.
import type { CompletedSessionFormState, CompletedSessionInput, SessionType } from "./completedSessionTypes";

export type CompletedSessionFieldErrors = Partial<Record<keyof CompletedSessionFormState, string>>;
export type ValidateCompletedSessionResult =
  | { ok: true; values: CompletedSessionInput }
  | { ok: false; errors: CompletedSessionFieldErrors };

function inRange0to10(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10;
}

export function validateCompletedSessionForm(state: CompletedSessionFormState, sessionDate: string): ValidateCompletedSessionResult {
  const errors: CompletedSessionFieldErrors = {};

  // No fallback: an unselected session_type must block Save, exactly like
  // an unanswered new_pain — this app never fabricates which session type
  // was actually done (see completedSessionTypes.ts's own doc for why
  // RECOVERY was rejected as a default).
  if (state.session_type === "") {
    errors.session_type = "Sélectionne un type de séance.";
  }

  let duration: number | null = null;
  let rpe: number | null = null;
  let legFatigue: number | null = null;
  let gripFatigue: number | null = null;

  // M5_003 final review: session_type REST never requires an invented
  // duration/RPE — the frozen M5_001A DB/RPC contract already allows these
  // null. Deliberately not generalized to any other session_type.
  const isRest = state.session_type === "REST";

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
    errors.completion_status = "Repos partiel n'est pas un statut valide. Choisis Faite ou Non faite, ou change le type de séance.";
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
      // Safe: errors.session_type would have blocked this return above if
      // state.session_type were still "".
      session_type: state.session_type as SessionType,
      completion_status: state.completion_status,
      actual_duration_min: duration,
      rpe,
      post_leg_fatigue: legFatigue,
      post_grip_fatigue: gripFatigue,
      new_pain: state.new_pain as boolean,
      new_pain_note: painNote,
      intervention: state.intervention,
      main_content: state.main_content,
    },
  };
}
