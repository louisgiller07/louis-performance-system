// V0.5_045 — Availability windows, athlete-facing RLS-direct repository.
// Same discipline as performanceSetupRepo.ts: the authenticated user's own
// Supabase client only, RLS (athlete_availability_windows_own_data,
// V0.4_004b) is the sole security boundary — never a service/secret key,
// never an Edge Function. head-coach-engine's athleteAvailabilityWindowsRepo.ts
// already has insertAvailabilityWindow()/getAvailabilityWindowsFor(), but
// those run under the privileged admin client and have zero real caller
// today (fixture/admin population only) — this file is the athlete-facing
// equivalent, the same split already established between web/ repos and
// head-coach-engine/ repos (web never imports head-coach-engine).
//
// Scope lock (V0.5_044): only `athlete_availability_windows`. Exceptions
// (`athlete_availability_exceptions`) and locked dates
// (`athlete_locked_dates`) are explicitly out of scope for this file.
import { supabase } from "../../lib/supabase";

export type AvailabilityDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AvailabilityWindow {
  id: string;
  dayOfWeek: AvailabilityDayOfWeek;
  /** "HH:MM", always normalized — see normalizeTime(). */
  startTime: string;
  endTime: string;
  label: string | null;
}

export class AvailabilityError extends Error {
  constructor() {
    super("Impossible d'enregistrer tes disponibilités. Réessaie dans un instant.");
    this.name = "AvailabilityError";
  }
}

interface AvailabilityWindowRawRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  label: string | null;
}

const WINDOW_COLUMNS = "id, day_of_week, start_time, end_time, label";

/**
 * PostgREST round-trips a `time` column as `"HH:MM:SS"` (confirmed
 * V0.5_044 audit); the `<input type="time">` this data feeds expects
 * `"HH:MM"`. A plain prefix slice — never a timezone-aware parse, these are
 * wall-clock values, no `Date`/`Intl` involved (V0.5_044 lock: no athlete
 * timezone concept exists anywhere in this schema, so none is invented
 * here either).
 */
function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

function mapRow(row: AvailabilityWindowRawRow): AvailabilityWindow {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week as AvailabilityDayOfWeek,
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    label: row.label,
  };
}

/**
 * Reads back whatever has already been saved. No `athleteId` parameter and
 * no `.eq(...)` filter — same RLS-only-scoping idiom as
 * performanceSetupRepo.loadPerformanceSetupAnswers(): RLS already restricts
 * `athlete_availability_windows` to at most the caller's own rows. A
 * brand-new athlete with no rows yet resolves to an empty array, never an
 * error — `missing_availability` is a legitimate, expected state, decided
 * by the backend (buildPlanInputSnapshot), never re-implemented here.
 */
export async function loadAvailabilityWindows(): Promise<AvailabilityWindow[]> {
  const { data, error } = await supabase.from("athlete_availability_windows").select(WINDOW_COLUMNS);

  if (error) {
    console.error("availabilityRepo.loadAvailabilityWindows failed", error.code);
    throw new AvailabilityError();
  }

  return ((data ?? []) as AvailabilityWindowRawRow[]).map(mapRow);
}

export interface AvailabilityFormDay {
  dayOfWeek: AvailabilityDayOfWeek;
  available: boolean;
  /** "" when `available` is false, or when no time has been entered yet — never a fabricated default. */
  startTime: string;
  endTime: string;
}

const ALL_DAYS: readonly AvailabilityDayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * Collapses however many DB rows exist per day into exactly one form entry
 * per day of week — the V0.5 UI's own "at most one window per day" model.
 * This is a faithful simplification, not a data-losing one (V0.5_044
 * audit): the Planning Engine only ever reads `dayOfWeek` presence from
 * `availability.windows`, never a specific window's `startTime`/`endTime`,
 * so multiple rows on the same day carry no additional meaning to it today.
 * When several rows exist for the same day, the one with the earliest
 * `startTime` is shown — deterministic, never arbitrary. Pure, no I/O.
 */
export function deriveAvailabilityForm(windows: readonly AvailabilityWindow[]): AvailabilityFormDay[] {
  return ALL_DAYS.map((dayOfWeek) => {
    const windowsForDay = windows.filter((w) => w.dayOfWeek === dayOfWeek).slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
    const chosen = windowsForDay[0];
    return chosen
      ? { dayOfWeek, available: true, startTime: chosen.startTime, endTime: chosen.endTime }
      : { dayOfWeek, available: false, startTime: "", endTime: "" };
  });
}

export interface SaveAvailabilityWindowInput {
  dayOfWeek: AvailabilityDayOfWeek;
  startTime: string;
  endTime: string;
}

/**
 * Replaces the athlete's entire visible set of availability windows.
 * `athlete_availability_windows` has no unique key identifying "the same"
 * window to upsert against (V0.5_044 lock) — so this is an explicit
 * insert-then-delete-by-id replacement, never a delete-then-insert:
 *
 *   1. Insert the new rows (one multi-row insert call) — if this fails,
 *      nothing else happens: no old row is ever touched.
 *   2. Only once the insert has succeeded, delete the old rows by the
 *      exact ids the caller loaded before this save started — NEVER by
 *      `athlete_id`, which would also delete the rows just inserted.
 *
 * This ordering is deliberately fail-safe rather than atomic: Supabase-js
 * issues these as two separate HTTP requests with no cross-request
 * transaction, so a failure between steps 1 and 2 can leave old and new
 * rows coexisting — strictly MORE availability than intended, never zero.
 * A save that left the athlete with zero windows on a partial failure
 * would silently re-trigger `missing_availability`; this ordering can
 * never produce that outcome. The residual (non-atomic) risk is accepted
 * (V0.5_044 lock) rather than justifying an Edge Function for this alone —
 * any leftover duplicate is corrected by the athlete's next save, which
 * always treats every currently-existing row as replaceable.
 *
 * `newWindows.length === 0` (the athlete unchecked every day) is not a
 * special case to prevent — it is a legitimate save whose only effect is
 * deleting the old rows, correctly leaving zero windows. The backend
 * (`missing_availability`) is the sole judge of whether that is enough to
 * generate a plan; this function never second-guesses it.
 */
export async function saveAvailabilityWindows(
  athleteId: string,
  newWindows: readonly SaveAvailabilityWindowInput[],
  existingIds: readonly string[]
): Promise<AvailabilityWindow[]> {
  let inserted: AvailabilityWindow[] = [];

  if (newWindows.length > 0) {
    const { data, error } = await supabase
      .from("athlete_availability_windows")
      .insert(
        newWindows.map((w) => ({
          athlete_id: athleteId,
          day_of_week: w.dayOfWeek,
          start_time: w.startTime,
          end_time: w.endTime,
        }))
      )
      .select(WINDOW_COLUMNS);

    if (error) {
      console.error("availabilityRepo.saveAvailabilityWindows: insert failed", error.code);
      throw new AvailabilityError();
    }

    // Prefer the rows the insert itself returns (one round trip, real
    // server-generated ids, never a fabricated frontend id) — fall back to
    // a fresh read only if Supabase ever hands back no data despite no
    // error (defensive; not expected in practice).
    inserted = data ? (data as AvailabilityWindowRawRow[]).map(mapRow) : await loadAvailabilityWindows();
  }

  if (existingIds.length > 0) {
    const { error } = await supabase.from("athlete_availability_windows").delete().in("id", existingIds);

    if (error) {
      console.error("availabilityRepo.saveAvailabilityWindows: delete of replaced rows failed", error.code);
      throw new AvailabilityError();
    }
  }

  return inserted;
}
