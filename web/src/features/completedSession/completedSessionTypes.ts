// Mirrors supabase/functions/completed-session/validation.ts's canonical
// field set — see docs/11_DECISION_LOG.md (M5_003, V0.3_007B). `free_notes`
// is deliberately not part of this contract (see that module's own doc).
import type { LoadProfile, TrainingIntervention, TrainingInterventionKind } from "./performedInterventionTypes";
import { TRAINING_KIND_LABELS, LOAD_PROFILE_LABELS } from "../dailyPlan/dailyPlanLabels";
import { mapTrainingInterventionToSessionType } from "../dailyPlan/trainingInterventionToSessionType";

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

/**
 * Exact response shape of GET/PUT's `completedSession` field — see
 * supabase/functions/completed-session/index.ts's CANONICAL_READBACK_COLUMNS.
 *
 * V0.3_007B — `intervention` is now the rich, AUTHORITATIVE representation
 * of what was actually performed (done/partial/replaced) — strengthened
 * from `Record<string, unknown> | null` to `TrainingIntervention | null`
 * now that this app actively writes it. `session_type` remains the coarse
 * compatibility projection: for done/partial/replaced it is always exactly
 * `mapTrainingInterventionToSessionType(intervention)` (never an
 * independent athlete-authored fact); for `skipped` it retains its
 * pre-existing meaning (the coarse type of the session that was skipped)
 * since there is no performed intervention to project in that case.
 */
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
  intervention: TrainingIntervention | null;
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
  intervention: TrainingIntervention | null;
  main_content: Record<string, unknown> | null;
}

/**
 * V0.3_007B — a same-day, athlete-owned, already-VALID persisted decision
 * the athlete might actually have followed. `finalSession` is the rich
 * prescription (`dailyPlan.final_session`), used both to label the option
 * ("10:05 — DH performance · charge lourde") and to prefill the performed
 * intervention for done/partial (see prefillFromPrescription below). Built
 * exclusively from `historyRepo.ts#loadValidDecisionsForDate` — never a
 * "latest decision" guess, never fabricated.
 */
export interface LinkableDecision {
  decisionId: string;
  createdAt: string;
  finalSession: TrainingIntervention;
}

/**
 * Raw, in-progress form state. `performed_kind`/`performed_load` back the
 * rich picker used for done/partial/replaced; `skipped_session_type` is the
 * separate, UNCHANGED coarse picker used only for `skipped` (there is no
 * performed intervention to pick from in that case — see docs/03/05/06).
 * `decision_id` is resolved by the card's own async decision lookup (0/1/2+
 * same-day decisions), never guessed from "whatever Today currently shows".
 */
export interface CompletedSessionFormState {
  completion_status: CompletionStatus;
  decision_id: string | null;
  performed_kind: TrainingInterventionKind | "";
  performed_load: LoadProfile | null;
  skipped_session_type: SessionType | "";
  actual_duration_min: number | "";
  rpe: number | "";
  post_leg_fatigue: number | "";
  post_grip_fatigue: number | "";
  new_pain: boolean | null;
  new_pain_note: string;
  main_content: Record<string, unknown> | null;
}

export function emptyCompletedSessionForm(): CompletedSessionFormState {
  return {
    completion_status: "done",
    decision_id: null,
    performed_kind: "",
    performed_load: null,
    skipped_session_type: "",
    actual_duration_min: "",
    rpe: "",
    post_leg_fatigue: "",
    post_grip_fatigue: "",
    new_pain: null,
    new_pain_note: "",
    main_content: null,
  };
}

export function recordToFormState(record: CompletedSessionRecord): CompletedSessionFormState {
  return {
    completion_status: record.completion_status,
    decision_id: record.decision_id,
    performed_kind: record.intervention?.kind ?? "",
    performed_load: record.intervention?.load_profile ?? null,
    skipped_session_type: record.session_type,
    actual_duration_min: record.actual_duration_min ?? "",
    rpe: record.rpe ?? "",
    post_leg_fatigue: record.post_leg_fatigue ?? "",
    post_grip_fatigue: record.post_grip_fatigue ?? "",
    new_pain: record.new_pain,
    new_pain_note: record.new_pain_note ?? "",
    main_content: record.main_content,
  };
}

/**
 * V0.3_007B §6 — the common path is "coach prescribed X, athlete did X":
 * done/partial default to the linked decision's prescribed intervention,
 * the athlete may then correct it if reality differed. `replaced` NEVER
 * prefills from the prescription (the athlete must explicitly record what
 * actually happened instead) and `skipped` has no performed intervention
 * at all — but when a decision IS linked, its coarse projection
 * (mapTrainingInterventionToSessionType — the same canonical mapping
 * Planning already uses, no second load-policy map) prefills
 * `skipped_session_type`: the athlete shouldn't have to re-enter "what was
 * skipped" when the app already knows what was prescribed. Returns the
 * unselected state whenever prefill doesn't apply — callers apply this on
 * every completion_status change and on every decision-selection change,
 * never only once, so switching TO `replaced` always clears a stale
 * prefilled value rather than silently keeping it.
 */
export function prefillFromPrescription(
  completionStatus: CompletionStatus,
  finalSession: TrainingIntervention | null
): { performed_kind: TrainingInterventionKind | ""; performed_load: LoadProfile | null; skipped_session_type: SessionType | "" } {
  if ((completionStatus === "done" || completionStatus === "partial") && finalSession !== null) {
    return { performed_kind: finalSession.kind, performed_load: finalSession.load_profile ?? null, skipped_session_type: "" };
  }
  if (completionStatus === "skipped" && finalSession !== null) {
    return { performed_kind: "", performed_load: null, skipped_session_type: mapTrainingInterventionToSessionType(finalSession) };
  }
  return { performed_kind: "", performed_load: null, skipped_session_type: "" };
}

const DECISION_TIME_FORMAT = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });

/**
 * "10:05 — DH performance · charge lourde" — reuses the exact same kind/
 * load label pair as everywhere else in the app (no second vocabulary).
 * Never a UUID, never a raw rule id, never engine enum strings.
 */
export function formatLinkableDecisionOption(decision: LinkableDecision): string {
  const time = DECISION_TIME_FORMAT.format(new Date(decision.createdAt));
  const kindLabel = TRAINING_KIND_LABELS[decision.finalSession.kind] ?? decision.finalSession.kind;
  const loadLabel = decision.finalSession.load_profile ? LOAD_PROFILE_LABELS[decision.finalSession.load_profile] : undefined;
  return loadLabel ? `${time} — ${kindLabel} · ${loadLabel}` : `${time} — ${kindLabel}`;
}
