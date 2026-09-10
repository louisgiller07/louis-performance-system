// Read-only access to public.decisions for the authenticated user's own
// athlete — the RLS policy decisions_own_data (baseline migration) is the
// sole security boundary, exactly as for daily_checkins in checkinRepo.ts.
// Never a service/secret key. This module never calls daily-run, never
// recomputes a plan, and never writes to decisions.
import { supabase } from "../../lib/supabase";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import type { DecisionHistoryRow } from "./historyTypes";

// Single string literal — see checkinRepo.ts's CHECKIN_COLUMNS for why a
// runtime-concatenated string breaks supabase-js's typed .select().
const DECISION_COLUMNS = "id, decision_date, created_at, final_session, active_mode, confidence_level, daily_plan";

const DEFAULT_LIMIT = 30;

export class HistoryLoadError extends Error {
  constructor() {
    super("Impossible de charger l'historique. Réessaie.");
    this.name = "HistoryLoadError";
  }
}

/** NAL-003 — thrown by loadLatestDecisionForDate on a read failure. Distinct from HistoryLoadError only in wording: a decision-read failure on /today must never be presented as "no decision exists yet". */
export class TodayDecisionLoadError extends Error {
  constructor() {
    super("Impossible de charger ton plan du jour. Réessaie.");
    this.name = "TodayDecisionLoadError";
  }
}

interface DecisionRow {
  id: string;
  decision_date: string;
  created_at: string;
  final_session: string;
  active_mode: string | null;
  confidence_level: string | null;
  daily_plan: unknown;
}

function toHistoryRow(row: DecisionRow): DecisionHistoryRow {
  return {
    id: row.id,
    decisionDate: row.decision_date,
    createdAt: row.created_at,
    finalSessionDb: row.final_session,
    activeModeDb: row.active_mode,
    confidenceLevelDb: row.confidence_level,
    dailyPlan: row.daily_plan,
  };
}

/**
 * Most recent decisions for the given athlete, newest first. Decisions are
 * append-only — several rows can share the same decision_date, and none
 * are deduplicated or collapsed to "latest per day" here; ordering by both
 * decision_date and created_at (both real columns) keeps same-day rows in
 * a stable, meaningful order.
 */
export async function loadDecisionHistory(athleteId: string, limit: number = DEFAULT_LIMIT): Promise<DecisionHistoryRow[]> {
  const { data, error } = await supabase
    .from("decisions")
    .select(DECISION_COLUMNS)
    .eq("athlete_id", athleteId)
    .order("decision_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // Generic + error code only — never the raw PostgREST message in a
    // browser console, which can echo table/column names.
    console.error("historyRepo.loadDecisionHistory failed", error.code);
    throw new HistoryLoadError();
  }

  return ((data ?? []) as DecisionRow[]).map(toHistoryRow);
}

/** A single stored decision by id, for the /history/:decisionId detail view. Null if not found or not owned by this athlete (RLS). */
export async function loadDecisionById(athleteId: string, decisionId: string): Promise<DecisionHistoryRow | null> {
  const { data, error } = await supabase
    .from("decisions")
    .select(DECISION_COLUMNS)
    .eq("athlete_id", athleteId)
    .eq("id", decisionId)
    .maybeSingle();

  if (error) {
    console.error("historyRepo.loadDecisionById failed", error.code);
    throw new HistoryLoadError();
  }

  return data ? toHistoryRow(data as DecisionRow) : null;
}

/**
 * NAL-003 — the most recent *valid* decision for the caller's own athlete
 * on exactly `date` (append-only: several rows can share the same
 * decision_date, e.g. context changed mid-day). "Latest" alone is not
 * enough: a newer row whose daily_plan fails isValidDailyPlan (a
 * legacy/malformed row) must never hide an older, genuinely valid decision
 * from the same day — so every same-day row is fetched, newest first (the
 * same canonical `created_at` ordering loadDecisionHistory already uses),
 * and the first one whose daily_plan passes the existing canonical
 * isValidDailyPlan validator wins. No new validity definition: this is the
 * exact same guard /history's HistoryDetail already trusts.
 *
 * No LIMIT is applied server-side — same-day decision volume for one
 * athlete has no proven canonical bound low enough to risk missing an
 * older valid row behind newer invalid ones.
 *
 * Returns `null` if no decision exists for that date yet, OR if every
 * same-day row is invalid — in both cases the caller (DailyPlanPanel) must
 * treat this as "nothing to restore, show the generation flow", never as
 * an error.
 */
export async function loadLatestDecisionForDate(athleteId: string, date: string): Promise<DecisionHistoryRow | null> {
  const { data, error } = await supabase
    .from("decisions")
    .select(DECISION_COLUMNS)
    .eq("athlete_id", athleteId)
    .eq("decision_date", date)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("historyRepo.loadLatestDecisionForDate failed", error.code);
    throw new TodayDecisionLoadError();
  }

  const rows = ((data ?? []) as DecisionRow[]).map(toHistoryRow);
  return rows.find((row) => isValidDailyPlan(row.dailyPlan)) ?? null;
}

/**
 * V0.3_007B — every VALID persisted decision for `athleteId` on exactly
 * `date`, oldest first (chronological, matches how a "which plan did you
 * follow" list should read). Used by CompletedSessionCard to disambiguate
 * which decision a performed session actually corresponds to when several
 * exist the same day (e.g. the athlete regenerated a plan after already
 * riding) — see docs/11_DECISION_LOG.md V0.3_007B. An invalid/malformed row
 * is silently excluded, same discipline as loadLatestDecisionForDate —
 * never surfaced as a selectable-but-broken option. Same RLS
 * (decisions_own_data), same columns, no new security surface: this is the
 * exact same query as loadLatestDecisionForDate without the "keep only the
 * first valid one" collapse.
 */
export async function loadValidDecisionsForDate(athleteId: string, date: string): Promise<DecisionHistoryRow[]> {
  const { data, error } = await supabase
    .from("decisions")
    .select(DECISION_COLUMNS)
    .eq("athlete_id", athleteId)
    .eq("decision_date", date)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("historyRepo.loadValidDecisionsForDate failed", error.code);
    throw new TodayDecisionLoadError();
  }

  return ((data ?? []) as DecisionRow[]).map(toHistoryRow).filter((row) => isValidDailyPlan(row.dailyPlan));
}

// Single string literal, full canonical CompletedSessionRecord column set —
// see completedSessionTypes.ts. History reads the same columns the
// completed-session Edge Function's own readback exposes, direct RLS
// SELECT (completed_sessions_own_select, SELECT-only for authenticated),
// never the Edge Function itself: that endpoint is single-date GET/PUT
// only, not shaped for a batched historical read, and going through it per
// decision would be N+1. This mirrors decisions' own direct-table-read
// convention in this same file — not a new pattern.
const COMPLETED_SESSION_COLUMNS =
  "id, session_date, decision_id, session_type, completion_status, actual_duration_min, rpe, post_leg_fatigue, post_grip_fatigue, new_pain, new_pain_note, intervention, main_content, session_load, updated_at, technical_outcome, change_reason, change_reason_note";

/**
 * V0.3_007D — every `completed_sessions` row for `athleteId` whose
 * `session_date` is one of `dates` (deduplicated first). ONE query
 * regardless of how many dates are requested (`.in("session_date", ...)`,
 * never a per-date/per-decision query — no N+1). `completed_sessions` has
 * `UNIQUE (athlete_id, session_date)`, so at most one row comes back per
 * requested date. This intentionally does NOT filter by `decision_id`: a
 * row with `decision_id = NULL` or pointing at a *different* same-day
 * decision is still returned, so the caller can distinguish "no session
 * that day" from "a session exists that day but isn't this decision's" —
 * see historyPerformedMatch.ts. Empty input returns `[]` without a query.
 */
export async function loadCompletedSessionsForDates(athleteId: string, dates: string[]): Promise<CompletedSessionRecord[]> {
  const uniqueDates = Array.from(new Set(dates));
  if (uniqueDates.length === 0) return [];

  const { data, error } = await supabase.from("completed_sessions").select(COMPLETED_SESSION_COLUMNS).eq("athlete_id", athleteId).in("session_date", uniqueDates);

  if (error) {
    console.error("historyRepo.loadCompletedSessionsForDates failed", error.code);
    throw new HistoryLoadError();
  }

  return (data ?? []) as unknown as CompletedSessionRecord[];
}
