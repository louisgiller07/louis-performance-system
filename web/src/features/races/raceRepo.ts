// A09 — the rider's own race_calendar rows. RLS race_calendar_own_data
// (baseline migration, FOR ALL with WITH CHECK) is the only security
// boundary: the caller's own Supabase client, never a service key. No
// migration: every column written here already exists. A new race is
// "planned"; an existing status is never changed here.
import { supabase } from "../../lib/supabase";
import type { RaceDraft } from "./raceForm";
import type { RacePriority } from "./racePresentation";

export interface Race {
  id: string;
  eventName: string;
  startDate: string;
  endDate: string;
  priority: RacePriority;
  raceFormat: string | null;
}

export class RaceRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RaceRepoError";
  }
}

const COLUMNS = "id, event_name, start_date, end_date, priority, race_format";
/** Cancelled / skipped races are never shown as races to plan around (same rule as the engine). */
const HIDDEN_STATUSES = "(cancelled,skipped)";

interface RaceRow {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  priority: RacePriority;
  race_format: string | null;
}

const toRace = (row: RaceRow): Race => ({
  id: row.id,
  eventName: row.event_name,
  startDate: row.start_date,
  endDate: row.end_date,
  priority: row.priority,
  raceFormat: row.race_format,
});

/** The columns a draft writes (event, dates, priority, format), exactly as the engine maps them (mapRaceCalendarRow). */
export function raceColumnsFromDraft(draft: RaceDraft) {
  return {
    event_name: draft.eventName.trim(),
    start_date: draft.startDate,
    end_date: draft.endDate,
    priority: draft.priority,
    race_format: draft.raceFormat,
  };
}

/** Races ending on or after `fromDate`, oldest first. */
export async function loadRaces(athleteId: string, fromDate: string): Promise<Race[]> {
  const { data, error } = await supabase
    .from("race_calendar")
    .select(COLUMNS)
    .eq("athlete_id", athleteId)
    .gte("end_date", fromDate)
    .not("status", "in", HIDDEN_STATUSES)
    .order("start_date", { ascending: true });
  if (error) throw new RaceRepoError("load failed");
  return ((data ?? []) as RaceRow[]).map(toRace);
}

export async function createRace(athleteId: string, draft: RaceDraft): Promise<Race> {
  const { data, error } = await supabase
    .from("race_calendar")
    .insert({ athlete_id: athleteId, status: "planned", ...raceColumnsFromDraft(draft) })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new RaceRepoError("create failed");
  return toRace(data as RaceRow);
}

export async function updateRace(id: string, draft: RaceDraft): Promise<Race> {
  const { data, error } = await supabase.from("race_calendar").update(raceColumnsFromDraft(draft)).eq("id", id).select(COLUMNS).single();
  if (error || !data) throw new RaceRepoError("update failed");
  return toRace(data as RaceRow);
}

export async function deleteRace(id: string): Promise<void> {
  const { error } = await supabase.from("race_calendar").delete().eq("id", id);
  if (error) throw new RaceRepoError("delete failed");
}
