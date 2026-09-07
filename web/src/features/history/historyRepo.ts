// Read-only access to public.decisions for the authenticated user's own
// athlete — the RLS policy decisions_own_data (baseline migration) is the
// sole security boundary, exactly as for daily_checkins in checkinRepo.ts.
// Never a service/secret key. This module never calls daily-run, never
// recomputes a plan, and never writes to decisions.
import { supabase } from "../../lib/supabase";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
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
