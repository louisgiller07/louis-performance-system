// V1-WARN-01 (HPM 2026-10-20, architecture approved) — a heavy lower-body Force the rider planned by hand
// one or two days before a known DH day. Canon heuristic C3.1 (docs/03) is implemented neither by M1 nor by the
// planners, and M1 never sees tomorrow's planned session: this is a planning-screen warning only.
//
// What it never does: block, remove or change the session; run on a coach-generated session (the generators never
// produce HEAVY, and a generated row is the coach's prescription); guess from a legacy row without an intervention
// (the coarse STRENGTH_A / DH_TECHNICAL session types are ambiguous); look beyond the dates the planning screen has
// loaded (the displayed days plus the two lookahead days PlanPage reads with its existing queries). Pure functions.
import type { PlannedSessionRow } from "./planningTypes";
import type { PlanDaySession } from "./weekPresentation";
import type { RaceOverlayEvent } from "./raceOverlayRepo";

/** The DH riding kinds that make a day a DH day. PUMPTRACK and BIKE_MAINTENANCE are not DH. */
export const DH_DAY_KINDS: ReadonlySet<string> = new Set(["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT"]);

/** The known DH day (or race day) one or two days after a date. */
export interface UpcomingDh {
  daysBefore: 1 | 2;
  date: string;
  what: "dh" | "race";
}

export interface UpcomingDhInput {
  /** The dates the planning screen loaded, ascending. Nothing outside them is ever assumed. */
  dates: readonly string[];
  /** The persisted planned_sessions row of each loaded date (null = none). */
  rows: Readonly<Record<string, PlannedSessionRow | null>>;
  /** The active plan's session of each loaded date, only meaningful when `planKnown`. */
  planByDate: Readonly<Record<string, PlanDaySession>>;
  planKnown: boolean;
  /** Races overlapping each loaded date, only meaningful when `racesKnown`. */
  racesByDate: Readonly<Record<string, readonly RaceOverlayEvent[]>>;
  racesKnown: boolean;
}

/** Heavy lower-body Force: exactly STRENGTH_LOWER at load HEAVY (other kinds are out of this warning's scope). */
export function isHeavyLowerBodyForce(kind: string | null | undefined, load: string | null | undefined): boolean {
  return kind === "STRENGTH_LOWER" && load === "HEAVY";
}

/** A row the rider planned by hand with an explicit heavy lower-body Force (never a generated or legacy row). */
export function isManualHeavyLowerBodyForce(row: PlannedSessionRow | null): boolean {
  return row !== null && row.source === "manual" && row.intervention !== null && isHeavyLowerBodyForce(row.intervention.kind, row.intervention.load_profile);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What is known to happen on a loaded date: a race, a DH session, or nothing known. */
function dhOn(date: string, input: UpcomingDhInput): UpcomingDh["what"] | null {
  if (input.racesKnown && (input.racesByDate[date]?.length ?? 0) > 0) return "race";
  const row = input.rows[date] ?? null;
  // The persisted row is what the day really holds: a DH only from an explicit intervention, never from a coarse type.
  if (row !== null) return row.intervention !== null && DH_DAY_KINDS.has(row.intervention.kind) ? "dh" : null;
  const plan = input.planKnown ? input.planByDate[date] : undefined;
  return plan !== undefined && DH_DAY_KINDS.has(plan.kind) ? "dh" : null;
}

/** The nearest known DH or race day at J+1, else J+2, of `date`, among the loaded dates only; null otherwise. */
export function upcomingDhFor(date: string, input: UpcomingDhInput): UpcomingDh | null {
  const loaded = new Set(input.dates);
  for (const daysBefore of [1, 2] as const) {
    const target = addDays(date, daysBefore);
    if (!loaded.has(target)) continue;
    const what = dhOn(target, input);
    if (what !== null) return { daysBefore, date: target, what };
  }
  return null;
}
