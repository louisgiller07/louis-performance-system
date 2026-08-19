// Read-only access to public.decisions for the authenticated user's own
// athlete — the RLS policy decisions_own_data (baseline migration) is the
// sole security boundary, exactly as for daily_checkins in checkinRepo.ts.
// Never a service/secret key. This module never calls daily-run, never
// recomputes a plan, and never writes to decisions.
import { supabase } from "../../lib/supabase";
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
