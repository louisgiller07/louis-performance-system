// Persistence for planned_sessions — the authenticated user's own Supabase
// client only (RLS policy planned_sessions_own_data is the sole authority on
// which athlete_id a row can belong to). Never a service/secret key. Mirrors
// the checkinRepo.ts pattern exactly.
import { supabase } from "../../lib/supabase";
import { mapTrainingInterventionToSessionType } from "../dailyPlan/trainingInterventionToSessionType";
import { validatePlannedIntervention } from "./planningValidation";
import type { PlannedSessionRow, TrainingIntervention } from "./planningTypes";

// Deliberately omits the five engine-inert columns (primary_objective,
// planned_duration_min, planned_time_of_day, training_block_id, notes) —
// out of scope for V0.3_003B (docs/11_DECISION_LOG.md V0.3_003A). A single
// string literal (not a runtime concatenation), same reason as
// checkinRepo.ts's CHECKIN_COLUMNS. `source` (V06-02) is read for display
// only (Programme / Modifiée par toi badge) — never written from a read row.
const PLANNED_SESSION_COLUMNS = "planned_date, session_type, intervention, planned_intent, is_committed, source";

export class PlanningLoadError extends Error {
  constructor() {
    super("Impossible de charger le planning. Réessaie dans un instant.");
    this.name = "PlanningLoadError";
  }
}

export class PlanningSaveError extends Error {
  constructor() {
    super("Impossible d'enregistrer la séance planifiée. Réessaie dans un instant.");
    this.name = "PlanningSaveError";
  }
}

export class PlanningDeleteError extends Error {
  constructor() {
    super("Impossible de supprimer la séance planifiée. Réessaie dans un instant.");
    this.name = "PlanningDeleteError";
  }
}

/**
 * P0-3 (HPM 2026-10-13) — the day already has a started (not ended) or a completed session: its planned
 * session is never replaced or removed silently. Same rules as record_session_execution (UX-11R.9): a V2
 * execution started and neither completed nor abandoned, a completed V2 execution, or a legacy completed
 * session that is not `skipped`. An abandoned execution (restart allowed) does not lock the day.
 */
export class PlanningDayLockedError extends Error {
  constructor() {
    super("Une séance a déjà été commencée ou terminée ce jour-là : elle ne peut plus être remplacée.");
    this.name = "PlanningDayLockedError";
  }
}

async function assertDayNotLocked(athleteId: string, date: string): Promise<void> {
  const [executions, completed] = await Promise.all([
    supabase.from("session_executions").select("id, execution_events(event_type)").eq("athlete_id", athleteId).eq("session_date", date),
    supabase.from("completed_sessions").select("id").eq("athlete_id", athleteId).eq("session_date", date).neq("completion_status", "skipped").limit(1),
  ]);
  if (executions.error || completed.error) {
    console.error("planningRepo.assertDayNotLocked failed", executions.error?.code ?? completed.error?.code);
    throw new PlanningSaveError();
  }
  const rows = (executions.data ?? []) as { execution_events: { event_type: string }[] | null }[];
  const lockedByExecution = rows.some((e) => {
    const events = (e.execution_events ?? []).map((ev) => ev.event_type);
    return events.includes("completed") || !events.includes("abandoned");
  });
  if (lockedByExecution || (completed.data ?? []).length > 0) throw new PlanningDayLockedError();
}

/** Thrown when the (kind, load_profile) pair fails validatePlannedIntervention — a code-level guard, not a form display path. Never reaches the network. */
export class InvalidPlannedInterventionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidPlannedInterventionError";
  }
}

/** Loads planned sessions in [fromDate, toDate] (inclusive) for the caller's own athlete, ascending by date. */
export async function loadPlannedSessions(
  athleteId: string,
  fromDate: string,
  toDate: string
): Promise<PlannedSessionRow[]> {
  const { data, error } = await supabase
    .from("planned_sessions")
    .select(PLANNED_SESSION_COLUMNS)
    .eq("athlete_id", athleteId)
    .gte("planned_date", fromDate)
    .lte("planned_date", toDate)
    .order("planned_date", { ascending: true });

  if (error) {
    console.error("planningRepo.loadPlannedSessions failed", error.code);
    throw new PlanningLoadError();
  }

  return (data ?? []) as unknown as PlannedSessionRow[];
}

/**
 * Upserts a planned session on the real unique constraint
 * (unique_planned_per_day, `UNIQUE (athlete_id, planned_date)` — already
 * present since the baseline migration). Validates (kind, load_profile,
 * duration_min) before touching the network — RACE_ACTIVITY, any malformed
 * pair, and any duration outside the closed DH-only preset are rejected
 * deterministically in code, not only by UI restriction.
 *
 * `planned_intent` is always saved as `null` and `source` always as
 * `"manual"` (docs/11_DECISION_LOG.md V0.3_003A — planned_intent deferred,
 * athlete-authored rows are never `"rule"`/`"template"`). The five
 * engine-inert columns (primary_objective, planned_duration_min,
 * planned_time_of_day, training_block_id, notes) are omitted entirely from
 * the payload (never set to null) so a pre-existing value on any of them
 * survives untouched — proven OMIT AND PRESERVE upsert semantics, see
 * planningRepo.integration.test.ts. `planned_duration_min` stays
 * deliberately dormant: V0.3_006C2's authoritative duration lives in
 * `intervention.duration_min` instead (see plannedDurationPolicy.ts),
 * never this column. `intervention` itself is
 * always a full, freshly-constructed value (never merged with the previous
 * row's `intervention`) — the JSONB column itself is fully replaced on every
 * save, which is exactly why `rawDurationMin === null` (V0.3_006C2 clear)
 * must be passed explicitly rather than merely omitted by the caller: a
 * caller that wants to preserve an existing duration_min must pass it again.
 *
 * `isCommitted` (V0.3_005A, NAL-001) defaults to `false` — a session is
 * only ever committed by an explicit athlete choice, never silently.
 */
export async function savePlannedSession(
  athleteId: string,
  date: string,
  rawKind: string,
  rawLoadProfile: string | null,
  isCommitted = false,
  rawDurationMin: string | null = null
): Promise<PlannedSessionRow> {
  const validated = validatePlannedIntervention(rawKind, rawLoadProfile, rawDurationMin);
  if (!validated.ok) {
    throw new InvalidPlannedInterventionError(validated.error);
  }
  const intervention: TrainingIntervention = validated.intervention;
  const session_type = mapTrainingInterventionToSessionType(intervention);
  await assertDayNotLocked(athleteId, date);

  const { data, error } = await supabase
    .from("planned_sessions")
    .upsert(
      {
        athlete_id: athleteId,
        planned_date: date,
        session_type,
        intervention,
        planned_intent: null,
        source: "manual",
        is_committed: isCommitted,
        // P0-3 (F3) — a manual session no longer derives from a generated one: the projection lineage it may have
        // replaced is cleared (PILOT_022 already ignored it). Decisions, prescriptions and executions keep their own ids.
        source_plan_version_id: null,
        source_generated_session_id: null,
      },
      { onConflict: "athlete_id,planned_date" }
    )
    .select(PLANNED_SESSION_COLUMNS)
    .single();

  if (error) {
    console.error("planningRepo.savePlannedSession failed", error.code);
    throw new PlanningSaveError();
  }

  return data as unknown as PlannedSessionRow;
}

/** Deletes the planned session for the caller's own athlete on the given date, if any. */
export async function deletePlannedSession(athleteId: string, date: string): Promise<void> {
  await assertDayNotLocked(athleteId, date);
  const { error } = await supabase
    .from("planned_sessions")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("planned_date", date);

  if (error) {
    console.error("planningRepo.deletePlannedSession failed", error.code);
    throw new PlanningDeleteError();
  }
}
