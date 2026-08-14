/**
 * M2_001 — daily_checkins pain criteria (SAFETY A4).
 *
 * See docs/05_DATA_MODEL.md §daily_checkins and docs/11_DECISION_LOG.md
 * (2026-08-13 — M2: Option A retained for enriched pain fields).
 *
 * NULL at the DB level means "unknown" (legacy row, or criterion never
 * collected) — never "false". A *current* checkin consumed by M2 must
 * provide all three criteria explicitly. This module enforces that
 * boundary at runtime: a value is only accepted if it is actually of
 * type `boolean`. `null`, `undefined` (missing key) and any other
 * runtime value are all rejected — never coerced to `false` (no
 * `?? false`, no `Boolean(x)`).
 */
import type { DailyCheckin } from "../../types/checkin.js";

/**
 * Raw shape of the three pain-criteria columns as read from `daily_checkins`.
 *
 * Typed as `unknown` and optional: this honestly represents a runtime row
 * that may be missing a key entirely (`undefined`), carry `null`, or —
 * coming from an untyped SQL/JSON boundary — carry any other value. The
 * only way to obtain a `DailyCheckinPainCriteria` is to pass runtime
 * validation in {@link mapDailyCheckinPainCriteria}.
 */
export interface DailyCheckinPainCriteriaRow {
  pain_traumatic?: unknown;
  pain_function_loss?: unknown;
  pain_getting_worse?: unknown;
}

/** Validated subset of the M1 `DailyCheckin` domain type — reused, not duplicated. */
export type DailyCheckinPainCriteria = Pick<
  DailyCheckin,
  "pain_traumatic" | "pain_function_loss" | "pain_getting_worse"
>;

const PAIN_CRITERIA_FIELDS: readonly (keyof DailyCheckinPainCriteriaRow)[] = [
  "pain_traumatic",
  "pain_function_loss",
  "pain_getting_worse",
];

export class IncompleteCheckinPainCriteriaError extends Error {
  constructor(public readonly missingFields: readonly string[]) {
    super(
      `Incomplete current checkin: pain criteria [${missingFields.join(", ")}] are missing, ` +
        "NULL, or not a boolean (unknown). A current M2 checkin must explicitly provide true or " +
        "false for pain_traumatic, pain_function_loss and pain_getting_worse — see " +
        "docs/05_DATA_MODEL.md §daily_checkins. An unknown value is never silently treated as false."
    );
    this.name = "IncompleteCheckinPainCriteriaError";
  }
}

function assertPainCriteriaComplete(
  row: DailyCheckinPainCriteriaRow
): asserts row is DailyCheckinPainCriteria {
  const missingFields = PAIN_CRITERIA_FIELDS.filter((field) => typeof row[field] !== "boolean");

  if (missingFields.length > 0) {
    throw new IncompleteCheckinPainCriteriaError(missingFields);
  }
}

/**
 * Maps the raw pain-criteria columns of a *current* `daily_checkins` row
 * to the corresponding M1 `DailyCheckin` fields.
 *
 * Throws {@link IncompleteCheckinPainCriteriaError} if any of the three
 * criteria is missing, `null`, or not a `boolean` — never converts an
 * unknown value to `false`.
 */
export function mapDailyCheckinPainCriteria(
  row: DailyCheckinPainCriteriaRow
): DailyCheckinPainCriteria {
  assertPainCriteriaComplete(row);

  return {
    pain_traumatic: row.pain_traumatic,
    pain_function_loss: row.pain_function_loss,
    pain_getting_worse: row.pain_getting_worse,
  };
}
