// Mirrors supabase/functions/completed-session/validation.ts's canonical
// field set exactly — see docs/11_DECISION_LOG.md (M5_003). `free_notes` is
// deliberately not part of this contract (see that module's own doc).

export const SESSION_TYPES = [
  "STRENGTH_A",
  "STRENGTH_B",
  "AEROBIC_BASE",
  "AEROBIC_INTERVALS",
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "RECOVERY",
  "REST",
  "BIKE_MAINTENANCE",
  "RACE_PREP",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  STRENGTH_A: "Force A",
  STRENGTH_B: "Force B",
  AEROBIC_BASE: "Aérobie base",
  AEROBIC_INTERVALS: "Aérobie intervalles",
  DH_TECHNICAL: "DH technique",
  DH_PERFORMANCE: "DH performance",
  RECOVERY: "Récupération",
  REST: "Repos",
  BIKE_MAINTENANCE: "Entretien vélo",
  RACE_PREP: "Prépa course",
};

export const COMPLETION_STATUSES = ["done", "partial", "skipped", "replaced"] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

export const COMPLETION_STATUS_LABELS: Record<CompletionStatus, string> = {
  done: "Faite",
  partial: "Partielle",
  skipped: "Non faite",
  replaced: "Remplacée",
};

/** Exact response shape of GET/PUT's `completedSession` field — see supabase/functions/completed-session/index.ts's CANONICAL_READBACK_COLUMNS. */
export interface CompletedSessionRecord {
  id: string;
  session_date: string;
  decision_id: string | null;
  session_type: SessionType;
  completion_status: CompletionStatus;
  actual_duration_min: number | null;
  rpe: number | null;
  post_leg_fatigue: number | null;
  post_grip_fatigue: number | null;
  new_pain: boolean;
  new_pain_note: string | null;
  intervention: Record<string, unknown> | null;
  main_content: Record<string, unknown> | null;
  session_load: number | null;
  updated_at: string;
}

/** Exact PUT request body — every key required-present, matching the Edge Function's strict full-replacement contract. */
export interface CompletedSessionInput {
  session_date: string;
  decision_id: string | null;
  session_type: SessionType;
  completion_status: CompletionStatus;
  actual_duration_min: number | null;
  rpe: number | null;
  post_leg_fatigue: number | null;
  post_grip_fatigue: number | null;
  new_pain: boolean;
  new_pain_note: string | null;
  intervention: Record<string, unknown> | null;
  main_content: Record<string, unknown> | null;
}

/**
 * The exact, current in-memory daily-run result — decisionId AND the coarse
 * session_type actually persisted for it (derived from that same DailyPlan's
 * final_session via trainingInterventionToSessionType.ts's canonical
 * mapping, never guessed). null whenever no DailyPlan is currently live —
 * see DailyPlanPanel's onLiveContextChange doc for the exact lifecycle
 * rules (never a "latest decision" lookup, never localStorage).
 */
export interface LiveDecisionContext {
  decisionId: string;
  sessionType: SessionType;
}

/**
 * Raw, in-progress form state — numeric fields may be "" while the user is
 * typing, same discipline as CheckinFormState. `session_type` is likewise
 * `SessionType | ""`: `""` means "not yet explicitly chosen" and must never
 * be silently treated as any real session type (in particular never
 * RECOVERY as a fallback) — a session's actual type is a fact this app must
 * never fabricate. `new_pain` is tri-state (`boolean | null`) for the same
 * reason (unanswered must never read as "non"). `intervention`/
 * `main_content` are carried opaquely — this form never displays or edits
 * their contents (no JSON editor), it only preserves whatever was loaded so
 * a full-replacement PUT never erases them.
 */
export interface CompletedSessionFormState {
  completion_status: CompletionStatus;
  session_type: SessionType | "";
  actual_duration_min: number | "";
  rpe: number | "";
  post_leg_fatigue: number | "";
  post_grip_fatigue: number | "";
  new_pain: boolean | null;
  new_pain_note: string;
  decision_id: string | null;
  intervention: Record<string, unknown> | null;
  main_content: Record<string, unknown> | null;
}

/**
 * A fresh (no existing row) form. `liveContext` is the exact daily-run
 * result from the current in-memory Today UI lifecycle, or null — when
 * present, both its decisionId and its session_type are preselected exactly
 * as returned; when absent, decision_id starts null and session_type starts
 * UNSELECTED (`""`) — never defaulted to RECOVERY or any other real type.
 */
export function emptyCompletedSessionForm(liveContext: LiveDecisionContext | null): CompletedSessionFormState {
  return {
    completion_status: "done",
    session_type: liveContext?.sessionType ?? "",
    actual_duration_min: "",
    rpe: "",
    post_leg_fatigue: "",
    post_grip_fatigue: "",
    new_pain: null,
    new_pain_note: "",
    decision_id: liveContext?.decisionId ?? null,
    intervention: null,
    main_content: null,
  };
}

export function recordToFormState(record: CompletedSessionRecord): CompletedSessionFormState {
  return {
    completion_status: record.completion_status,
    session_type: record.session_type,
    actual_duration_min: record.actual_duration_min ?? "",
    rpe: record.rpe ?? "",
    post_leg_fatigue: record.post_leg_fatigue ?? "",
    post_grip_fatigue: record.post_grip_fatigue ?? "",
    new_pain: record.new_pain,
    new_pain_note: record.new_pain_note ?? "",
    decision_id: record.decision_id,
    intervention: record.intervention,
    main_content: record.main_content,
  };
}
