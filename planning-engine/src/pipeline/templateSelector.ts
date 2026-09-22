/**
 * TemplateSelector (V0.4_104) — pure function selecting a
 * WeekTemplateCatalogEntry for one week, given its date range, the next
 * week's date range (if any), and the athlete's declared races. No DB
 * access, no catalogue lookup beyond WEEK_TEMPLATE_CATALOG (already part of
 * this package), no global state, no prescription logic. First file in
 * planning-engine/src/pipeline/ — WeekSegmenter/ConstraintResolver/
 * LoadDerivation/HistoryAdjuster remain unbuilt, deliberately out of this
 * ticket's scope.
 *
 * Priority order (V0.4_104 decision, no other rule may be added without a
 * new decision):
 *   1. A race overlaps this week          -> "race"
 *   2. A race overlaps the next week      -> "taper"
 *   3. candidateWeekType, if supplied     -> that weekType
 *   4. Otherwise                          -> "development"
 *
 * Race priority (A_PLUS/A/B/C) is deliberately NOT consulted for rules 1/2
 * — every race in the window triggers the rule regardless of priority
 * (V0.4_104 decision: no threshold defined today, not invented here).
 *
 * This module never decides WHEN a week should be "recovery"/"deload" —
 * candidateWeekType is consumed exactly as given; that decision belongs to
 * a future caller (WeekSegmenter or a block-planning policy), not this
 * function (V0.4_104 decision).
 */
import type { WeekType } from "../types/planWeek.js";
import type { PlanInputRace } from "../types/planInputSnapshot.js";
import { WEEK_TEMPLATE_CATALOG_ENTRIES, type WeekTemplateCatalogEntry } from "../catalog/weekTemplateCatalog.js";

export type TemplateSelectionReason = "race_in_week" | "race_in_next_week" | "candidate_hint" | "default_development";

export interface TemplateSelectionInput {
  weekStartDate: string; // ISO date
  weekEndDate: string; // ISO date
  /** Both must be present to enable the "race in next week" check — if only one is given, that check is simply skipped, same as if neither were given. */
  nextWeekStartDate?: string;
  nextWeekEndDate?: string;
  /** The full PlanInputSnapshot.races list — never pre-filtered by the caller; this function performs both overlap checks itself. */
  races: readonly PlanInputRace[];
  /** Upstream hint for a week already decided to be recovery/deload — see module doc. */
  candidateWeekType?: "recovery" | "deload";
}

export interface TemplateSelectionResult {
  weekType: WeekType;
  template: WeekTemplateCatalogEntry;
  selectionReason: TemplateSelectionReason;
}

export class TemplateNotFoundError extends Error {
  constructor(public readonly weekType: WeekType) {
    super(`No non-deprecated WeekTemplateCatalogEntry found for weekType "${weekType}"`);
    this.name = "TemplateNotFoundError";
  }
}

export class InvalidCandidateWeekTypeError extends Error {
  constructor(public readonly value: unknown) {
    super(`candidateWeekType must be "recovery" or "deload" when provided (got ${JSON.stringify(value)})`);
    this.name = "InvalidCandidateWeekTypeError";
  }
}

/** Inclusive date-range overlap — a race starting or ending exactly on a range boundary counts as overlapping. */
function overlaps(rangeStart: string, rangeEnd: string, otherStart: string, otherEnd: string): boolean {
  return otherStart <= rangeEnd && otherEnd >= rangeStart;
}

function findTemplate(weekType: WeekType): WeekTemplateCatalogEntry {
  const entry = WEEK_TEMPLATE_CATALOG_ENTRIES.find((e) => e.weekType === weekType && !e.deprecated);
  if (!entry) throw new TemplateNotFoundError(weekType);
  return entry;
}

export function selectWeekTemplate(input: TemplateSelectionInput): TemplateSelectionResult {
  const { weekStartDate, weekEndDate, nextWeekStartDate, nextWeekEndDate, races, candidateWeekType } = input;

  if (candidateWeekType !== undefined && candidateWeekType !== "recovery" && candidateWeekType !== "deload") {
    throw new InvalidCandidateWeekTypeError(candidateWeekType);
  }

  const raceInWeek = races.some((race) => overlaps(weekStartDate, weekEndDate, race.startDate, race.endDate));
  if (raceInWeek) {
    return { weekType: "race", template: findTemplate("race"), selectionReason: "race_in_week" };
  }

  if (nextWeekStartDate !== undefined && nextWeekEndDate !== undefined) {
    const raceInNextWeek = races.some((race) => overlaps(nextWeekStartDate, nextWeekEndDate, race.startDate, race.endDate));
    if (raceInNextWeek) {
      return { weekType: "taper", template: findTemplate("taper"), selectionReason: "race_in_next_week" };
    }
  }

  if (candidateWeekType !== undefined) {
    return { weekType: candidateWeekType, template: findTemplate(candidateWeekType), selectionReason: "candidate_hint" };
  }

  return { weekType: "development", template: findTemplate("development"), selectionReason: "default_development" };
}
