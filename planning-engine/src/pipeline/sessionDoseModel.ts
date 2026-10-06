/**
 * UX-11A.5b.5a — optional session dose model of the planning pipeline.
 *
 * Absent (the default): the pipeline is the V1 pipeline, unchanged —
 * placement durations from LoadDerivation.referenceDurationMinFor, session
 * load from LoadDerivation then HistoryAdjuster.
 *
 * Present (a V2 plan): ONE explicit resolver supplies, for each week type,
 * the FINAL session durations used for placement, and the final load of each
 * placed session, replacing HistoryAdjuster for that plan. The pipeline then
 * checks that every session's final duration equals the duration it was
 * placed with (invariant: no duration known only after placement).
 *
 * The pipeline never imports a concrete model: the V2 implementation lives
 * in the Session Model V2 module and is injected by its caller.
 */
import type { SessionKind } from "../types/sharedVocabulary.js";
import type { WeekProgressionSummary, WeekType } from "../types/planWeek.js";
import type { SessionDomain } from "./weekSegmenter.js";
import type { LoadDerivationOutput } from "./loadDerivation.js";
import type { WeekTemplateCatalogEntry } from "../catalog/weekTemplateCatalog.js";
import type {
  PlanInputAvailability,
  PlanInputLockedDate,
  PlanInputRace,
  PlanInputRecentHistory,
  StrengthExperienceTier,
} from "../types/planInputSnapshot.js";

/** BUG-V2-2 — everything a block progression model may read to shape the weeks of a block. */
export interface BlockShapingInput {
  weeks: readonly { weekNumber: number; startDate: string; endDate: string }[];
  races: readonly PlanInputRace[];
  availability: PlanInputAvailability;
  terrainAccess: readonly string[];
  lockedDates: readonly PlanInputLockedDate[];
  strengthExperienceTier: StrengthExperienceTier;
  recentHistory: PlanInputRecentHistory;
}

/** BUG-V2-2 — one shaped week: its type, template, final placement durations and progression targets. */
export interface WeekShape {
  weekType: WeekType;
  template: WeekTemplateCatalogEntry;
  /** Closed English phrases, the first part of the week and session rationales. */
  rationale: string;
  /** null only when the template places no session. */
  placementDurationMinByDomain: Readonly<Record<SessionDomain, number>> | null;
  progression: Omit<WeekProgressionSummary, "sessionCount" | "physicalMinutes" | "ridingMinutes">;
}

export interface SessionDoseModel {
  /** Identifies the model in errors and traces (e.g. the plan dose policy version). */
  readonly modelId: string;
  /**
   * Final placement durations of the week type, or null when the week type
   * places no session at all (its template has zero slots).
   */
  placementDurationMinByDomain(weekType: WeekType): Readonly<Record<SessionDomain, number>> | null;
  /** Final load of one placed session (replaces HistoryAdjuster for this model); `shape` = the week's shape when the model shapes the block. */
  resolveSessionLoad(input: { kind: SessionKind; domain: SessionDomain; weekType: WeekType; baseline: LoadDerivationOutput; shape?: WeekShape }): LoadDerivationOutput;
  /**
   * BUG-V2-2 — optional block progression: one shape per week of the block,
   * in order. Absent: each week is selected alone (TemplateSelector) and
   * dosed by its week type, as before.
   */
  shapeWeeks?(input: BlockShapingInput): readonly WeekShape[];
}

export class SessionDoseModelContractError extends Error {
  constructor(message: string) {
    super(`SessionDoseModel contract error: ${message}`);
    this.name = "SessionDoseModelContractError";
  }
}
