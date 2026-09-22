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
 */
import type { PlanInputAvailability, PlanInputLockedDate } from "../types/planInputSnapshot.js";
import type { WeekTemplateCatalogEntry } from "../catalog/weekTemplateCatalog.js";

export type SessionDomain = "strength" | "dh_technical" | "aerobic";

export interface PlacedSlot {
  date: string; // ISO date
  domain: SessionDomain;
}

export type UnplaceableReason = "insufficient_available_dates" | "terrain_incompatible";

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
  const claimed = new Set<string>();

  const placedSlots: PlacedSlot[] = [];
  const unplaceable: UnplaceableSlot[] = [];

  // dh_technical placed first: it may draw from a strictly smaller pool
  // (terrain-restricted) than strength/aerobic, which share the full pool —
  // processing the most-constrained domain first avoids strength/aerobic
  // incidentally claiming the only dates dh_technical could have used.
  const dhWeekendOnly = input.terrainAccess.length > 0 && input.terrainAccess.every((tag) => tag === WEEKEND_ONLY_TERRAIN_TAG);
  const dhCandidates = availableDates.filter((date) => !claimed.has(date) && (!dhWeekendOnly || isWeekend(date)));
  for (let i = 0; i < input.template.dhTechnicalSlotCount; i++) {
    const date = dhCandidates.find((d) => !claimed.has(d));
    if (date === undefined) {
      unplaceable.push({ domain: "dh_technical", reason: dhWeekendOnly ? "terrain_incompatible" : "insufficient_available_dates" });
      continue;
    }
    claimed.add(date);
    placedSlots.push({ date, domain: "dh_technical" });
  }

  for (const [domain, count] of [
    ["strength", input.template.strengthSlotCount],
    ["aerobic", input.template.aerobicSlotCount],
  ] as const) {
    const candidates = availableDates.filter((date) => !claimed.has(date));
    for (let i = 0; i < count; i++) {
      const date = candidates.find((d) => !claimed.has(d));
      if (date === undefined) {
        unplaceable.push({ domain, reason: "insufficient_available_dates" });
        continue;
      }
      claimed.add(date);
      placedSlots.push({ date, domain });
    }
  }

  return { placedSlots, unplaceable };
}
