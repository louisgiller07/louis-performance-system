// NAL-007 — read-only access to public.race_calendar for the Planning
// overlay. RLS policy race_calendar_own_data (baseline migration) is the
// sole security boundary — the authenticated caller's own Supabase client
// only, never a service/secret key. This module never writes to
// race_calendar or planned_sessions, never invokes daily-run, and never
// creates a decision — read-only context, exactly like TodayPlanningSummary
// reading planned_sessions for /today.
import { supabase } from "../../lib/supabase";

export type RacePriority = "A_PLUS" | "A" | "B" | "C";

export interface RaceOverlayEvent {
  eventName: string;
  startDate: string;
  endDate: string;
  priority: RacePriority;
}

export class RaceOverlayLoadError extends Error {
  constructor() {
    super("Impossible de charger les événements du calendrier de courses.");
    this.name = "RaceOverlayLoadError";
  }
}

const RACE_COLUMNS = "event_name, start_date, end_date, priority";

// The schema's own existing canonical definition of an "upcoming/active"
// race — see supabase/migrations/20260814095000_baseline_v0_2.sql's
// idx_race_calendar_upcoming partial index (status IN planned/registered/
// confirmed). Reused verbatim here rather than inventing a second
// definition of "relevant race" — a cancelled/skipped race must never
// appear as if the athlete still has to plan around it.
const ACTIVE_STATUSES = ["planned", "registered", "confirmed"] as const;

interface RaceCalendarRow {
  event_name: string;
  start_date: string;
  end_date: string;
  priority: RacePriority;
}

/**
 * Races for the caller's own athlete whose [start_date, end_date] window
 * overlaps [fromDate, toDate] (both inclusive, "YYYY-MM-DD"). Intended for
 * exactly the current Planning horizon (today -> J+6) — a pure
 * `start_date <= toDate AND end_date >= fromDate` overlap query, mirroring
 * head-coach-engine's own getRacesInWindow.ts overlap logic. Read-only:
 * never writes to race_calendar or planned_sessions.
 */
export async function loadRacesInRange(athleteId: string, fromDate: string, toDate: string): Promise<RaceOverlayEvent[]> {
  const { data, error } = await supabase
    .from("race_calendar")
    .select(RACE_COLUMNS)
    .eq("athlete_id", athleteId)
    .in("status", ACTIVE_STATUSES)
    .lte("start_date", toDate)
    .gte("end_date", fromDate);

  if (error) {
    console.error("raceOverlayRepo.loadRacesInRange failed", error.code);
    throw new RaceOverlayLoadError();
  }

  return ((data ?? []) as RaceCalendarRow[]).map((row) => ({
    eventName: row.event_name,
    startDate: row.start_date,
    endDate: row.end_date,
    priority: row.priority,
  }));
}

/**
 * Groups already-loaded races by every date in `dates` they cover (a
 * multi-day race appears under each date in its [startDate, endDate] range
 * that is also in `dates`) — pure date-string comparison, "YYYY-MM-DD"
 * sorts and compares correctly as plain strings, exactly like
 * planningRepo's own gte/lte usage.
 */
export function groupRacesByDate(races: RaceOverlayEvent[], dates: readonly string[]): Record<string, RaceOverlayEvent[]> {
  const byDate: Record<string, RaceOverlayEvent[]> = {};
  for (const date of dates) {
    byDate[date] = races.filter((race) => race.startDate <= date && date <= race.endDate);
  }
  return byDate;
}
