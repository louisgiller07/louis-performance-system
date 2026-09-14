/**
 * Read-only access to `completed_sessions`, windowed to the recent-load
 * lookback. See docs/05_DATA_MODEL.md §completed_sessions.
 *
 * Window bound reuses M1's own `PROVISIONAL_THRESHOLDS.recentLoad.windowDays`
 * (read-only import from the frozen engine) — `computeRecentLoad`
 * (src/engine/recentLoad.ts) re-filters by age itself, so this is a
 * query-efficiency superset, not a re-decided business rule.
 *
 * V0.3_008A — `post_leg_fatigue`/`post_grip_fatigue`/`change_reason` added
 * to the select for `mapRecentRecoveryContext` (src/supabase/mapping/
 * recentRecoveryContext.ts), which reuses these SAME rows (D-1 is always
 * inside a 7-day window) — deliberately NOT a second query. `recentLoad`'s
 * own consumer (`mapCompletedSessionRow`) simply ignores the extra columns.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROVISIONAL_THRESHOLDS } from "../../engine/provisionalThresholds.js";
import { assertNoSupabaseError } from "./supabaseError.js";

export type CompletedSessionRawRow = Record<string, unknown>;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches `completed_sessions` rows for `athleteId` with
 * `session_date` in [today - windowDays, today].
 */
export async function getRecentSessions(
  client: SupabaseClient,
  athleteId: string,
  today: string
): Promise<CompletedSessionRawRow[]> {
  const windowStart = addDays(today, -PROVISIONAL_THRESHOLDS.recentLoad.windowDays);

  const { data, error } = await client
    .from("completed_sessions")
    .select("session_date, session_type, intervention, completion_status, post_leg_fatigue, post_grip_fatigue, change_reason")
    .eq("athlete_id", athleteId)
    .gte("session_date", windowStart)
    .lte("session_date", today);

  assertNoSupabaseError(error, "completed_sessions");
  return (data ?? []) as CompletedSessionRawRow[];
}

/**
 * V0.3_008B — bounded technical-continuity candidates: `athlete_id`,
 * `decision_id`/`technical_outcome` both non-null, strictly inter-day
 * window `D-14 <= session_date < D` (today D itself and any future date
 * excluded — no same-day feedback loop, see docs/11_DECISION_LOG.md
 * V0.3_008B). Ordered newest-first so the caller can resolve the newest
 * VALID candidate without a second sort. `LIMIT candidateLimit` is the
 * exact mathematical maximum possible in this window, derived from
 * `unique_completed_per_day UNIQUE (athlete_id, session_date)` — never an
 * arbitrary ceiling, never a truncation risk for V1's window.
 *
 * `completion_status` is included so the resolver can defensively re-verify
 * DONE/PARTIAL — the normal V0.3_007C write contract already guarantees
 * `technical_outcome` is non-null only for those two statuses, but this
 * query reads via the privileged admin client (no RLS), so a malformed
 * historical row (e.g. REPLACED with a stray non-null `technical_outcome`)
 * must never be silently accepted as technical history on the strength of
 * the DB-level filters above alone.
 */
export async function getRecentTechnicalCandidates(
  client: SupabaseClient,
  athleteId: string,
  today: string
): Promise<CompletedSessionRawRow[]> {
  const { windowDays, candidateLimit } = PROVISIONAL_THRESHOLDS.recentTechnicalContext;
  const windowStart = addDays(today, -windowDays);

  const { data, error } = await client
    .from("completed_sessions")
    .select("session_date, decision_id, completion_status, technical_outcome, intervention")
    .eq("athlete_id", athleteId)
    .not("decision_id", "is", null)
    .not("technical_outcome", "is", null)
    .gte("session_date", windowStart)
    .lt("session_date", today)
    .order("session_date", { ascending: false })
    .limit(candidateLimit);

  assertNoSupabaseError(error, "completed_sessions (technical candidates)");
  return (data ?? []) as CompletedSessionRawRow[];
}
