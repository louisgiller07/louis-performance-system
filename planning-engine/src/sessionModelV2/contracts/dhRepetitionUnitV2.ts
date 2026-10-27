/**
 * SPORT-PLAN-03 V2 contracts (HPM 2026-10-25) — the unit of a DH repetition. NON-PRESCRIPTIVE: pure functions; plan
 * generation reads every stored count through them (sessionContractChecksV2, V2-CONTRACTS-INTEGRATION-01); the
 * `pass` measure stays what every builder emits.
 *
 * - A repetition is a SECTION (a defined section of a track), a FULL_RUN (a complete descent) or UNKNOWN.
 * - A NEW repetition count needs a known unit: UNKNOWN blocks the count (budget and drill are kept); a FULL_RUN needs
 *   the descent's duration (track data) — no universal number of runs exists.
 * - An old `pass` count is read as UNKNOWN: kept, readable, never turned into full runs, never given a unit.
 * - V2-DH-UNIT-01: a stored count states its unit only from its drill's signed attribution (readPassMeasureV2); a
 *   stated unit the drill does not have, or a malformed one, is not trusted (UNKNOWN).
 * - Counts of different units are never added together, nor converted into one another.
 * - Every part of a session (brief, warm-up, rides, climbs, pauses, free descents, end) fits in its budget; a plan
 *   over the budget is NON CONFORME with its overflow, one with an unknown part NON VÉRIFIABLE — never trimmed.
 */
import type { PassMeasureV2 } from "../prescriptionV2.js";
import { dhRepetitionUnitAttributionV2 } from "../dhSportGateV2.js";

export const DH_REPETITION_UNITS_V2 = ["SECTION", "FULL_RUN", "UNKNOWN"] as const;
export type DhRepetitionUnitV2 = (typeof DH_REPETITION_UNITS_V2)[number];

export interface DhDoseContractV2 {
  unit: DhRepetitionUnitV2;
  /** Null when the count cannot be prescribed (unit unknown, or a full run without track data). */
  repetitions: number | null;
  /** Total time on site, every part included. */
  sessionBudgetMin: number;
}

export type DhCountBlockReasonV2 = "unit_unknown" | "full_run_needs_track_data";

export type DhRepetitionCountResultV2 = { status: "prescribed"; dose: DhDoseContractV2 } | { status: "count_blocked"; reason: DhCountBlockReasonV2; dose: DhDoseContractV2 };

/** Whether a new repetition count may be prescribed for this unit. The input count is never altered, only withheld. */
export function dhRepetitionCountV2(input: { unit: DhRepetitionUnitV2; repetitions: number; sessionBudgetMin: number; descentMinPerRepetition?: number | null }): DhRepetitionCountResultV2 {
  const blocked = (reason: DhCountBlockReasonV2): DhRepetitionCountResultV2 => ({ status: "count_blocked", reason, dose: { unit: input.unit, repetitions: null, sessionBudgetMin: input.sessionBudgetMin } });
  if (input.unit === "UNKNOWN") return blocked("unit_unknown");
  if (input.unit === "FULL_RUN" && (input.descentMinPerRepetition ?? null) === null) return blocked("full_run_needs_track_data");
  return { status: "prescribed", dose: { unit: input.unit, repetitions: input.repetitions, sessionBudgetMin: input.sessionBudgetMin } };
}

/** An existing `pass` measure, read as it is: its count kept for reading, its unit UNKNOWN (never assumed). */
export function readLegacyPassMeasureV2(measure: PassMeasureV2): { unit: "UNKNOWN"; count: number } {
  return { unit: "UNKNOWN", count: measure.count };
}

const isPositiveInteger = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * V2-DH-UNIT-01 — a stored `pass` measure as far as it can be trusted. A stated unit counts only when it is well formed
 * and the drill's signed attribution states the same unit (a FULL_RUN with its descent time, a SECTION without one);
 * no unit, an unknown value or a unit the drill does not have reads UNKNOWN. The count is kept; nothing is converted.
 */
export function readPassMeasureV2(measure: PassMeasureV2, drillId: string): { unit: DhRepetitionUnitV2; count: number; descentMinutes: number | null } {
  const stated = measure as { unit?: unknown; descentMinutes?: unknown };
  const attributed = dhRepetitionUnitAttributionV2(drillId)?.unit;
  if (stated.unit === "SECTION" && attributed === "SECTION" && stated.descentMinutes === undefined) return { unit: "SECTION", count: measure.count, descentMinutes: null };
  if (stated.unit === "FULL_RUN" && attributed === "FULL_RUN" && isPositiveInteger(stated.descentMinutes)) return { unit: "FULL_RUN", count: measure.count, descentMinutes: stated.descentMinutes };
  return { ...readLegacyPassMeasureV2(measure), descentMinutes: null };
}

export interface DhHistoryRecordV2 {
  date: string;
  unit: DhRepetitionUnitV2;
  done: number;
  prescribed: number;
}

/** History by unit: every record kept on its own line; totals per unit, never added across units. */
export function dhHistoryByUnitV2(records: readonly DhHistoryRecordV2[]): { lines: readonly DhHistoryRecordV2[]; doneByUnit: Readonly<Record<DhRepetitionUnitV2, number>> } {
  const doneByUnit: Record<DhRepetitionUnitV2, number> = { SECTION: 0, FULL_RUN: 0, UNKNOWN: 0 };
  for (const r of records) doneByUnit[r.unit] += r.done;
  return { lines: [...records], doneByUnit };
}

/** Adds two counts only when they share a KNOWN unit; anything else is refused (null), never converted. */
export function addDhRepetitionsV2(a: { unit: DhRepetitionUnitV2; count: number }, b: { unit: DhRepetitionUnitV2; count: number }): { unit: DhRepetitionUnitV2; count: number } | null {
  if (a.unit === "UNKNOWN" || a.unit !== b.unit) return null;
  return { unit: a.unit, count: a.count + b.count };
}

/** The planned time of a DH session; null = not known (the plan cannot be checked). */
export interface DhSessionTimePlanV2 {
  briefMin: number | null;
  warmUpMin: number | null;
  rideMinPerRepetition: number | null;
  climbMinPerRepetition: number | null;
  pauseMinPerRepetition: number | null;
  freeDescentsMin: number | null;
  endMin: number | null;
}

export type DhSessionPlanCheckV2 =
  | { verdict: "CONFORME"; plannedMin: number; overflowMin: 0 }
  | { verdict: "NON CONFORME"; plannedMin: number; overflowMin: number }
  | { verdict: "NON VÉRIFIABLE"; unknown: readonly (keyof DhSessionTimePlanV2)[] };

/** Every part of the session against its budget; free descents count inside it, never beyond. */
export function checkDhSessionPlanV2(dose: DhDoseContractV2, plan: DhSessionTimePlanV2): DhSessionPlanCheckV2 {
  const unknown = (Object.keys(plan) as (keyof DhSessionTimePlanV2)[]).filter((k) => plan[k] === null);
  if (unknown.length > 0 || dose.repetitions === null) return { verdict: "NON VÉRIFIABLE", unknown };
  const perRepetition = plan.rideMinPerRepetition! + plan.climbMinPerRepetition! + plan.pauseMinPerRepetition!;
  const plannedMin = plan.briefMin! + plan.warmUpMin! + dose.repetitions * perRepetition + plan.freeDescentsMin! + plan.endMin!;
  const overflowMin = Math.max(0, plannedMin - dose.sessionBudgetMin);
  return overflowMin === 0 ? { verdict: "CONFORME", plannedMin, overflowMin: 0 } : { verdict: "NON CONFORME", plannedMin, overflowMin };
}
