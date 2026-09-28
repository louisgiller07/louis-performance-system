/**
 * WeekSegmenter (V0.4_105) — pure function placing an already-selected
 * WeekTemplateCatalogEntry's domain slot counts onto real dates within one
 * already-bounded week. Structural placement only: availability, a single
 * terrain rule demonstrated by the golden scenarios, and locked dates.
 * Never decides SessionKind, loadProfile, durationMin, doseTarget, or any
 * relaxation policy for a slot it could not place — those stay downstream
 * (LoadDerivation / Prescription Engine / a future ConstraintResolver).
 *
 * Does NOT segment a plan's full horizon into weeks — it receives one
 * already-defined week (weekStartDate/weekEndDate) and places within it.
 * Who owns horizon-into-weeks segmentation remains explicitly undecided
 * (V0.4_105 decision) — not this module's responsibility.
 *
 * Does NOT receive or consult races/weekType — those belong exclusively to
 * TemplateSelector (V0.4_104), already resolved into `template` by the time
 * this function is called.
 *
 * V06-03 — a slot is only placed on a date whose availability window can
 * hold the session's duration (`sessionDurationMinByDomain`, supplied by the
 * orchestrator from LoadDerivation's own reference figures — never decided
 * here). A slot that fits no remaining date is reported unplaceable, never
 * shortened: this module still never decides or changes a duration.
 */
import type { PlanInputAvailability, PlanInputAvailabilityWindow, PlanInputLockedDate } from "../types/planInputSnapshot.js";
import type { WeekTemplateCatalogEntry } from "../catalog/weekTemplateCatalog.js";

export type SessionDomain = "strength" | "dh_technical" | "aerobic";

export interface PlacedSlot {
  date: string; // ISO date
  domain: SessionDomain;
}

/**
 * `insufficient_available_time` (V06-03): at least one free, terrain-
 * compatible date remained, but none of their availability windows is long
 * enough for the session's duration.
 */
export type UnplaceableReason = "insufficient_available_dates" | "terrain_incompatible" | "insufficient_available_time";

export interface UnplaceableSlot {
  domain: SessionDomain;
  reason: UnplaceableReason;
}

export interface WeekSegmentationInput {
  weekStartDate: string; // ISO date
  weekEndDate: string; // ISO date
  template: WeekTemplateCatalogEntry;
  availability: PlanInputAvailability;
  terrainAccess: readonly string[];
  lockedDates: readonly PlanInputLockedDate[];
  /** V06-03 — duration (minutes) a session of each domain will have this week; a slot needs a window at least this long. */
  sessionDurationMinByDomain: Readonly<Record<SessionDomain, number>>;
}

export interface WeekSegmentationResult {
  placedSlots: PlacedSlot[];
  unplaceable: UnplaceableSlot[];
}

export class InvalidWeekRangeError extends Error {
  constructor(
    public readonly weekStartDate: string,
    public readonly weekEndDate: string
  ) {
    super(`weekEndDate (${weekEndDate}) must not be before weekStartDate (${weekStartDate})`);
    this.name = "InvalidWeekRangeError";
  }
}

/** A window time that is not "HH:mm" / "HH:mm:ss", or a window that does not end after it starts — never guessed around. */
export class InvalidAvailabilityWindowError extends Error {
  constructor(public readonly window: PlanInputAvailabilityWindow) {
    super(`Invalid availability window on dayOfWeek ${window.dayOfWeek}: "${window.startTime}"-"${window.endTime}"`);
    this.name = "InvalidAvailabilityWindowError";
  }
}

// "HH:mm" (snapshot contract) or "HH:mm:ss" (what Postgres `time` returns
// through PostgREST, passed through unchanged by buildPlanInputSnapshot).
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

function parseTimeSeconds(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (match === null) return null;
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
  if (hours > 24 || minutes > 59 || seconds > 59 || (hours === 24 && (minutes > 0 || seconds > 0))) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Whole minutes between a window's start and end ("18:00"-"19:00" -> 60). Throws InvalidAvailabilityWindowError for a malformed or non-positive window (the DB itself enforces end_time > start_time). */
export function windowCapacityMinutes(window: PlanInputAvailabilityWindow): number {
  const start = parseTimeSeconds(window.startTime);
  const end = parseTimeSeconds(window.endTime);
  if (start === null || end === null || end <= start) {
    throw new InvalidAvailabilityWindowError(window);
  }
  return Math.floor((end - start) / 60);
}

/** The only terrain tag any golden scenario treats as weekend-only (Scenario F) — not generalized to any other tag (V0.4_105 decision). */
const WEEKEND_ONLY_TERRAIN_TAG = "bike_park_jump_line";

/** Manual UTC parsing, never `new Date(isoString)` — same discipline as runDailyFor.ts's own addDays, for the same local-timezone-ambiguity reason. */
function dayOfWeekFor(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year as number, (month as number) - 1, day as number)).getUTCDay();
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year as number, (month as number) - 1, (day as number) + days));
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function enumerateDates(weekStartDate: string, weekEndDate: string): string[] {
  const dates: string[] = [];
  let cursor = weekStartDate;
  while (cursor <= weekEndDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/**
 * A date is available iff: an exception exists for it (its `available`
 * value wins outright, in either direction — an exception can grant
 * availability on a day with no recurring window, or revoke it on one that
 * has one) — otherwise, available iff its day-of-week has at least one
 * `availability.windows` entry. Locked dates are excluded unconditionally
 * afterward, regardless of either of these.
 */
function computeAvailableDates(dates: readonly string[], availability: PlanInputAvailability, lockedDates: readonly PlanInputLockedDate[]): string[] {
  const lockedSet = new Set(lockedDates.map((l) => l.date));
  const exceptionByDate = new Map(availability.exceptions.map((e) => [e.date, e.available]));
  const windowDaysOfWeek = new Set(availability.windows.map((w) => w.dayOfWeek));

  return dates.filter((date) => {
    if (lockedSet.has(date)) return false;
    if (exceptionByDate.has(date)) return exceptionByDate.get(date)!;
    return windowDaysOfWeek.has(dayOfWeekFor(date) as 0 | 1 | 2 | 3 | 4 | 5 | 6);
  });
}

/**
 * Longest single window on each date's day of week (a session must fit in
 * one window — two short windows on the same day are never added up).
 * `null` = no time information at all: only possible for a date granted by
 * an `available: true` exception on a day with no recurring window
 * (exceptions carry no hours), so no capacity limit can be known — the
 * date keeps its pre-V06-03 behavior rather than being guessed short.
 */
function computeDateCapacities(dates: readonly string[], availability: PlanInputAvailability): Map<string, number | null> {
  const longestByDayOfWeek = new Map<number, number>();
  for (const window of availability.windows) {
    const capacity = windowCapacityMinutes(window);
    longestByDayOfWeek.set(window.dayOfWeek, Math.max(capacity, longestByDayOfWeek.get(window.dayOfWeek) ?? 0));
  }
  return new Map(dates.map((date) => [date, longestByDayOfWeek.get(dayOfWeekFor(date)) ?? null]));
}

function isWeekend(date: string): boolean {
  const dow = dayOfWeekFor(date);
  return dow === 0 || dow === 6;
}

export function segmentWeek(input: WeekSegmentationInput): WeekSegmentationResult {
  if (input.weekEndDate < input.weekStartDate) {
    throw new InvalidWeekRangeError(input.weekStartDate, input.weekEndDate);
  }

  const allDates = enumerateDates(input.weekStartDate, input.weekEndDate);
  const availableDates = computeAvailableDates(allDates, input.availability, input.lockedDates);
  const capacityByDate = computeDateCapacities(availableDates, input.availability);
  const claimed = new Set<string>();

  const placedSlots: PlacedSlot[] = [];
  const unplaceable: UnplaceableSlot[] = [];

  // Earliest free candidate whose window holds the session; if free
  // candidates remain but none is long enough, the shortfall is reported as
  // a time problem, not a missing-date one.
  const placeSlot = (domain: SessionDomain, candidates: readonly string[], noDateReason: UnplaceableReason): void => {
    const durationMin = input.sessionDurationMinByDomain[domain];
    const free = candidates.filter((d) => !claimed.has(d));
    const date = free.find((d) => {
      const capacity = capacityByDate.get(d) ?? null;
      return capacity === null || durationMin <= capacity;
    });
    if (date === undefined) {
      unplaceable.push({ domain, reason: free.length > 0 ? "insufficient_available_time" : noDateReason });
      return;
    }
    claimed.add(date);
    placedSlots.push({ date, domain });
  };

  // dh_technical placed first: it may draw from a strictly smaller pool
  // (terrain-restricted) than strength/aerobic, which share the full pool —
  // processing the most-constrained domain first avoids strength/aerobic
  // incidentally claiming the only dates dh_technical could have used.
  const dhWeekendOnly = input.terrainAccess.length > 0 && input.terrainAccess.every((tag) => tag === WEEKEND_ONLY_TERRAIN_TAG);
  const dhCandidates = availableDates.filter((date) => !dhWeekendOnly || isWeekend(date));
  for (let i = 0; i < input.template.dhTechnicalSlotCount; i++) {
    placeSlot("dh_technical", dhCandidates, dhWeekendOnly ? "terrain_incompatible" : "insufficient_available_dates");
  }

  for (const [domain, count] of [
    ["strength", input.template.strengthSlotCount],
    ["aerobic", input.template.aerobicSlotCount],
  ] as const) {
    for (let i = 0; i < count; i++) {
      placeSlot(domain, availableDates, "insufficient_available_dates");
    }
  }

  return { placedSlots, unplaceable };
}
