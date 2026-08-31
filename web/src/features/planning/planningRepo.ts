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
// checkinRepo.ts's CHECKIN_COLUMNS.
const PLANNED_SESSION_COLUMNS = "planned_date, session_type, intervention, planned_intent";

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
 * present since the baseline migration). Validates (kind, load_profile)
 * before touching the network — RACE_ACTIVITY and any malformed pair are
 * rejected deterministically in code, not only by UI restriction.
 *
 * `planned_intent` is always saved as `null` and `source` always as
 * `"manual"` (docs/11_DECISION_LOG.md V0.3_003A — planned_intent deferred,
 * athlete-authored rows are never `"rule"`/`"template"`). The five
 * engine-inert columns are omitted entirely from the payload (never set to
 * null) so a pre-existing value on any of them survives untouched — proven
 * OMIT AND PRESERVE upsert semantics, see planningRepo.integration.test.ts.
 */
export async function savePlannedSession(
  athleteId: string,
  date: string,
  rawKind: string,
  rawLoadProfile: string | null
): Promise<PlannedSessionRow> {
  const validated = validatePlannedIntervention(rawKind, rawLoadProfile);
  if (!validated.ok) {
    throw new InvalidPlannedInterventionError(validated.error);
  }
  const intervention: TrainingIntervention = validated.intervention;
  const session_type = mapTrainingInterventionToSessionType(intervention);

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
