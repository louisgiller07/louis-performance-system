// V0.3_007D — classifies the exact relationship between one persisted
// decision and the (at most one, per completed_sessions' own
// UNIQUE(athlete_id, session_date)) same-day completed_sessions row. Exact
// FK truth only (completed_sessions.decision_id === decision.id) — never
// "latest decision of the day", never proximity/heuristic matching. See
// docs/11_DECISION_LOG.md V0.3_007D.
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";

export type PerformedMatch =
  | { kind: "linked"; session: CompletedSessionRecord }
  | { kind: "same_day_unassociated" }
  | { kind: "none" };

// Locked athlete-facing copy (French, straight apostrophes — matches the
// rest of the app's convention) for the two non-linked cases. CASE C is
// never "skipped" — no completed row is a distinct fact from a genuinely
// recorded skipped session.
export const NO_COMPLETED_SESSION_COPY = "Pas de séance enregistrée.";
export const SAME_DAY_UNASSOCIATED_COPY = "Une séance a été enregistrée ce jour-là, mais elle n'est pas associée à ce plan.";

/**
 * `sessions` should be every completed_sessions row already loaded for the
 * relevant date range (see historyRepo.ts#loadCompletedSessionsForDates) —
 * this function does the exact-date + exact-FK narrowing itself, so callers
 * never need to pre-filter. Because of the UNIQUE(athlete_id, session_date)
 * constraint, at most one row can match `decisionDate`; if more than one
 * were ever somehow present (defensive only, should never happen), the
 * first exact decision_id match wins deterministically over "same day but
 * unassociated".
 */
export function matchPerformedSession(decisionId: string, decisionDate: string, sessions: CompletedSessionRecord[]): PerformedMatch {
  const sameDay = sessions.filter((session) => session.session_date === decisionDate);
  if (sameDay.length === 0) return { kind: "none" };

  const linked = sameDay.find((session) => session.decision_id === decisionId);
  if (linked) return { kind: "linked", session: linked };

  return { kind: "same_day_unassociated" };
}

/**
 * List-indicator support (§15) — a decisionId -> CompletedSessionRecord map
 * containing ONLY exact `decision_id` matches (never a same-day-but-
 * unassociated row). A decision with no entry in this map must render no
 * indicator at all, even if another same-day decision does.
 */
export function buildLinkedSessionsByDecisionId(sessions: CompletedSessionRecord[]): Map<string, CompletedSessionRecord> {
  const map = new Map<string, CompletedSessionRecord>();
  for (const session of sessions) {
    if (session.decision_id !== null) {
      map.set(session.decision_id, session);
    }
  }
  return map;
}
