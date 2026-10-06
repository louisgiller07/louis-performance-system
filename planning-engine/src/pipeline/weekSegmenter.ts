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
 *
 * BUG-V2-1 — each window hosts "physical", "riding" or both (legacy windows,
 * no `activity`). A DH session needs a riding window, a strength session a
 * physical one, an aerobic session either. Strength is steered away from
 * riding days so they stay for riding; with only legacy windows every date
 * serves both, so placement is exactly the previous one.
 */
import type { PlanInputAvailability, PlanInputLockedDate } from "../types/planInputSnapshot.js";
import type { WeekTemplateCatalogEntry } from "../catalog/weekTemplateCatalog.js";
import { availabilityByDate, dayOfWeekFor, type ActivityCapacity, type AvailabilityActivity, type DateAvailability } from "./availabilityActivity.js";

export { windowCapacityMinutes, InvalidAvailabilityWindowError } from "./availabilityActivity.js";

export type SessionDomain = "strength" | "dh_technical" | "aerobic";

/** BUG-V2-1 — the availability kinds a session of each domain can use (any one of them). */
export const DOMAIN_ACTIVITIES: Readonly<Record<SessionDomain, readonly AvailabilityActivity[]>> = {
  dh_technical: ["riding"],
  strength: ["physical"],
  aerobic: ["physical", "riding"],
};

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

/** The only terrain tag any golden scenario treats as weekend-only (Scenario F) — not generalized to any other tag (V0.4_105 decision). */
const WEEKEND_ONLY_TERRAIN_TAG = "bike_park_jump_line";

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

function isWeekend(date: string): boolean {
  const dow = dayOfWeekFor(date);
  return dow === 0 || dow === 6;
}

/**
 * What a session of `domain` can use on a date: `undefined` = none of its
 * activities is available; `null` = available without a known time limit
 * (an `available: true` exception on a day without a compatible window);
 * else the longest compatible window, in minutes.
 */
function domainCapacity(day: DateAvailability, domain: SessionDomain): ActivityCapacity {
  const capacities = DOMAIN_ACTIVITIES[domain].map((activity) => day[activity]).filter((c) => c !== undefined);
  if (capacities.length === 0) return undefined;
  if (capacities.some((c) => c === null)) return null;
  return Math.max(...(capacities as number[]));
}

const byDate = (a: DateAvailability, b: DateAvailability): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function segmentWeek(input: WeekSegmentationInput): WeekSegmentationResult {
  if (input.weekEndDate < input.weekStartDate) {
    throw new InvalidWeekRangeError(input.weekStartDate, input.weekEndDate);
  }

  const days = availabilityByDate(enumerateDates(input.weekStartDate, input.weekEndDate), input.availability, input.lockedDates);
  const claimed = new Set<string>();

  const placedSlots: PlacedSlot[] = [];
  const unplaceable: UnplaceableSlot[] = [];

  // First free candidate (in the domain's preference order) whose window
  // holds the session; if free candidates remain but none is long enough,
  // the shortfall is reported as a time problem, not a missing-date one.
  const placeSlot = (domain: SessionDomain, candidates: readonly DateAvailability[], noDateReason: UnplaceableReason): void => {
    const durationMin = input.sessionDurationMinByDomain[domain];
    const free = candidates.filter((d) => !claimed.has(d.date));
    const day = free.find((d) => {
      const capacity = domainCapacity(d, domain);
      return capacity === null || (capacity !== undefined && durationMin <= capacity);
    });
    if (day === undefined) {
      unplaceable.push({ domain, reason: free.length > 0 ? "insufficient_available_time" : noDateReason });
      return;
    }
    claimed.add(day.date);
    placedSlots.push({ date: day.date, domain });
  };

  const candidatesFor = (domain: SessionDomain): DateAvailability[] => days.filter((d) => domainCapacity(d, domain) !== undefined);

  // dh_technical placed first: it may draw from a strictly smaller pool
  // (riding days, terrain-restricted) than strength/aerobic — processing the
  // most-constrained domain first avoids the others incidentally claiming the
  // only dates dh_technical could have used.
  const dhWeekendOnly = input.terrainAccess.length > 0 && input.terrainAccess.every((tag) => tag === WEEKEND_ONLY_TERRAIN_TAG);
  const dhCandidates = candidatesFor("dh_technical").filter((d) => !dhWeekendOnly || isWeekend(d.date));
  for (let i = 0; i < input.template.dhTechnicalSlotCount; i++) {
    placeSlot("dh_technical", dhCandidates, dhWeekendOnly ? "terrain_incompatible" : "insufficient_available_dates");
  }

  // Strength prefers days WITHOUT riding availability, so riding days stay
  // for riding (date order within each group). With legacy windows every
  // available date also serves riding: a single group, the previous order.
  const strengthCandidates = [...candidatesFor("strength")].sort(
    (a, b) => Number(a.riding !== undefined) - Number(b.riding !== undefined) || byDate(a, b)
  );
  for (let i = 0; i < input.template.strengthSlotCount; i++) {
    placeSlot("strength", strengthCandidates, "insufficient_available_dates");
  }

  const aerobicCandidates = candidatesFor("aerobic");
  for (let i = 0; i < input.template.aerobicSlotCount; i++) {
    placeSlot("aerobic", aerobicCandidates, "insufficient_available_dates");
  }

  return { placedSlots, unplaceable };
}
