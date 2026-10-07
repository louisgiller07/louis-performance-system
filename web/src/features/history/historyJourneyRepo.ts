import { addDays } from "../../lib/date";
import { loadCheckinsForDates } from "../checkin/checkinRepo";
import { loadObjective, loadRaces } from "../today/todayContextRepo";
import type { TodayRace } from "../today/todayContext";
import { loadCompletedSessionsForDates, loadDecisionHistory, loadExecutionsForDates } from "./historyRepo";
import { buildHistoryDays, type HistoryDay } from "./historyDays";

// UX-07 — every read behind History's journey, all RLS-scoped, existing
// tables and columns, no write:
// - decisions and the recorded sessions of those days: required (a failure
//   is the page's error state, as before UX-07);
// - check-ins, races and the declared objective: best-effort (a failure
//   only hides "Ton état du jour" / the race line / the hero context).
// The window is a number of decisions; `before` / filters by month or race
// can later narrow the same pipeline without changing the day model.

/** Decisions read for the journey (append-only: a few per day at most). */
export const HISTORY_DECISION_LIMIT = 120;
/** Races are also read ahead of today, for the hero's next race. */
const RACE_LOOKAHEAD_DAYS = 366;

export interface HistoryJourney {
  days: HistoryDay[];
  races: TodayRace[];
  objective: string | null;
}

function valueOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

export async function loadHistoryJourney(athleteId: string, today: string, limit: number = HISTORY_DECISION_LIMIT): Promise<HistoryJourney> {
  const rows = await loadDecisionHistory(athleteId, limit);
  const dates = [...new Set(rows.map((row) => row.decisionDate))];
  const firstDate = dates.slice().sort()[0] ?? today;
  // A07 — every V2 execution of those days (open, completed, abandoned): the effective-session read model.
  const [completed, executions, checkins, races, objective] = await Promise.allSettled([
    loadCompletedSessionsForDates(athleteId, dates),
    loadExecutionsForDates(athleteId, dates),
    loadCheckinsForDates(athleteId, dates),
    loadRaces(athleteId, firstDate, addDays(today, RACE_LOOKAHEAD_DAYS)),
    loadObjective(),
  ]);
  if (completed.status === "rejected") throw completed.reason;
  // UX-11R.9 — same failure policy as completed_sessions: a missing source would show a done day as not recorded.
  if (executions.status === "rejected") throw executions.reason;
  const guided = executions.value
    .filter((e) => e.events.includes("completed") && e.decisionId !== null)
    .map((e) => ({ executionId: e.executionId, sessionDate: e.sessionDate, decisionId: e.decisionId!, finalPrescriptionId: e.finalPrescriptionId }));
  const raceList = valueOr(races, []);
  return {
    days: buildHistoryDays(rows, valueOr(checkins, []), completed.value, raceList, guided, executions.value),
    races: raceList,
    objective: valueOr(objective, null),
  };
}
