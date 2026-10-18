/**
 * V2-L2-01a (HPM 2026-10-18, canon docs/05 « Historique de la génération V2 ») — the facts of the generation's recent
 * history window [today − windowDays, today], one grouped read per table, under the generation's service-role client
 * (explicit `athlete_id` filter on every read). Pure reads: nothing is written.
 *
 * Fail closed: a failed read, or a result reaching the row cap, throws — the generation is refused, never fed a
 * silently empty or truncated history.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlanHistoryActivityRowV2,
  PlanHistoryCheckinRowV2,
  PlanHistoryDebriefRowV2,
  PlanHistoryDecisionRowV2,
  PlanHistoryExecutionRowV2,
  PlanHistoryFactsV2,
  PlanHistoryHealthFlagRowV2,
  PlanHistorySetRowV2,
} from "../mapping/planHistoryV2.js";
import { recentLoadWindowStart } from "./completedSessionsRepo.js";
import { assertNoSupabaseError } from "./supabaseError.js";

/** Rows per read; reaching it means the read may be truncated → refused. */
export const PLAN_HISTORY_V2_ROW_CAP = 1000;

export class PlanHistoryV2ReadError extends Error {
  constructor(context: string) {
    super(`Plan history V2 read refused (${context}): row cap ${PLAN_HISTORY_V2_ROW_CAP} reached`);
    this.name = "PlanHistoryV2ReadError";
  }
}

function rowsOf<T>(result: { data: unknown; error: { message: string } | null }, context: string): T[] {
  assertNoSupabaseError(result.error, context);
  const rows = (result.data ?? []) as T[];
  if (rows.length >= PLAN_HISTORY_V2_ROW_CAP) throw new PlanHistoryV2ReadError(context);
  return rows;
}

type DecisionProjection = { id: string; decision_date: string; created_at: string; decision: unknown; final_session: unknown; triggered_rules: unknown };
const DECISION_COLUMNS = "id, decision_date, created_at, decision:daily_plan->decision, final_session:daily_plan->final_session, triggered_rules:daily_plan->triggered_rules";
/** Only the three daily_plan fields the history needs; a decision without daily_plan (pre-M2) keeps `daily_plan: null`. */
const decisionRow = (r: DecisionProjection): PlanHistoryDecisionRowV2 => ({
  id: r.id,
  decision_date: r.decision_date,
  created_at: r.created_at,
  daily_plan: r.decision === null ? null : { decision: r.decision, final_session: r.final_session, triggered_rules: r.triggered_rules },
});

export async function readPlanHistoryFactsV2(client: SupabaseClient, athleteId: string, today: string): Promise<PlanHistoryFactsV2> {
  const windowStart = recentLoadWindowStart(today);
  const cap = PLAN_HISTORY_V2_ROW_CAP;

  const [debriefs, executionRows, decisionRows, checkins, healthFlags] = await Promise.all([
    client
      .from("completed_sessions")
      .select("session_date, completion_status, actual_duration_min, change_reason, new_pain")
      .eq("athlete_id", athleteId)
      .gte("session_date", windowStart)
      .lte("session_date", today)
      .order("session_date", { ascending: true })
      .limit(cap)
      .then((r) => rowsOf<PlanHistoryDebriefRowV2>(r, "completed_sessions")),
    client
      .from("session_executions")
      .select("id, session_date, decision_id, final_prescription_id, started_at, execution_events(event_type)")
      .eq("athlete_id", athleteId)
      .gte("session_date", windowStart)
      .lte("session_date", today)
      .order("session_date", { ascending: true })
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(cap)
      .then((r) =>
        rowsOf<{ id: string; session_date: string; decision_id: string | null; final_prescription_id: string | null; started_at: string; execution_events: Array<{ event_type: string }> | null }>(r, "session_executions")
      ),
    client
      .from("decisions")
      .select(DECISION_COLUMNS)
      .eq("athlete_id", athleteId)
      .gte("decision_date", windowStart)
      .lte("decision_date", today)
      .order("decision_date", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(cap)
      .then((r) => rowsOf<DecisionProjection>(r, "decisions")),
    client
      .from("daily_checkins")
      .select("checkin_date, pain, fever_or_illness, suspected_concussion")
      .eq("athlete_id", athleteId)
      .gte("checkin_date", windowStart)
      .lte("checkin_date", today)
      .order("checkin_date", { ascending: true })
      .limit(cap)
      .then((r) => rowsOf<PlanHistoryCheckinRowV2>(r, "daily_checkins")),
    // Every signal up to today, whatever its age: a closed signal without resolution day, or with inconsistent dates,
    // covers the whole window (canon), which no date filter could tell in advance.
    client
      .from("health_flags")
      .select("flag_date, status, resolved_at")
      .eq("athlete_id", athleteId)
      .lte("flag_date", today)
      .order("flag_date", { ascending: true })
      .order("id", { ascending: true })
      .limit(cap)
      .then((r) => rowsOf<PlanHistoryHealthFlagRowV2>(r, "health_flags")),
  ]);

  const executions: PlanHistoryExecutionRowV2[] = executionRows.map((e) => ({
    id: e.id,
    session_date: e.session_date,
    decision_id: e.decision_id,
    final_prescription_id: e.final_prescription_id,
    started_at: e.started_at,
    events: (e.execution_events ?? []).map((ev) => ev.event_type),
  }));
  const completed = executions.filter((e) => e.events.includes("completed"));
  const decisions = decisionRows.map(decisionRow);
  const known = new Set(decisions.map((d) => d.id));
  const missingDecisionIds = [...new Set(completed.map((e) => e.decision_id).filter((id): id is string => id !== null && !known.has(id)))].sort();
  const prescriptionIds = [...new Set(completed.map((e) => e.final_prescription_id).filter((id): id is string => id !== null))].sort();
  const executionIds = completed.map((e) => e.id);

  const [ownDecisions, prescriptions, sets, activities] = await Promise.all([
    missingDecisionIds.length === 0
      ? Promise.resolve([] as PlanHistoryDecisionRowV2[])
      : client
          .from("decisions")
          .select(DECISION_COLUMNS)
          .eq("athlete_id", athleteId)
          .in("id", missingDecisionIds)
          .order("id", { ascending: true })
          .limit(cap)
          .then((r) => rowsOf<DecisionProjection>(r, "decisions (executions)").map(decisionRow)),
    prescriptionIds.length === 0
      ? Promise.resolve([] as { id: string; structure: unknown }[])
      : client
          .from("decision_final_prescriptions")
          .select("id, structure")
          .eq("athlete_id", athleteId)
          .in("id", prescriptionIds)
          .order("id", { ascending: true })
          .limit(cap)
          .then((r) => rowsOf<{ id: string; structure: unknown }>(r, "decision_final_prescriptions")),
    executionIds.length === 0
      ? Promise.resolve([] as PlanHistorySetRowV2[])
      : client
          .from("exercise_set_results")
          .select("id, execution_id, prescription_item_id, set_number, done, supersedes_id")
          .eq("athlete_id", athleteId)
          .in("execution_id", executionIds)
          .order("execution_id", { ascending: true })
          .order("id", { ascending: true })
          .limit(cap)
          .then((r) => rowsOf<PlanHistorySetRowV2>(r, "exercise_set_results")),
    executionIds.length === 0
      ? Promise.resolve([] as PlanHistoryActivityRowV2[])
      : client
          .from("session_activity_results")
          .select("id, execution_id, duration_seconds, supersedes_id")
          .eq("athlete_id", athleteId)
          .in("execution_id", executionIds)
          .order("execution_id", { ascending: true })
          .order("id", { ascending: true })
          .limit(cap)
          .then((r) => rowsOf<PlanHistoryActivityRowV2>(r, "session_activity_results")),
  ]);

  return { debriefs, executions, decisions: [...decisions, ...ownDecisions], prescriptions, sets, activities, checkins, healthFlags };
}
