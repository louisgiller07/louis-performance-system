/**
 * `daily_checkins` row → M1 `DailyCheckin` — the full current-checkin
 * mapper for the M2 read path. See docs/05_DATA_MODEL.md §daily_checkins
 * and docs/11_DECISION_LOG.md (M2 read-path review — pain_intensity
 * boundary normalization, race_format/race_phase).
 *
 * `daily_checkins` has several scalar columns (`sleep_hours`,
 * `sleep_quality`, `sleep_wake_ups`, `energy`, `work_stress`, `motivation`,
 * `leg_fatigue`, `grip_fatigue`, `pain_new`) that are nullable in the DB
 * (no `DEFAULT`, no `NOT NULL`) but are required (non-optional) fields on
 * M1's frozen `DailyCheckin` type. `pain_new` in particular directly gates
 * SAFETY A2 (`checkin.pain && checkin.pain_intensity >= 6 && checkin.pain_new`,
 * src/rules/safety.ts) — silently coercing a missing value to `false`
 * there would risk masking a real SAFETY trigger, exactly the failure mode
 * M2_001 already rejects for `pain_traumatic`/`pain_function_loss`/
 * `pain_getting_worse`. This mapper extends the *same* non-coercion
 * doctrine (identical mechanism: reject rather than default) to every
 * scalar column M1 requires as non-optional, not just the three M2_001
 * added — a current checkin missing any of them is treated as incomplete
 * and rejected, never silently completed.
 *
 * `pain_intensity` is the one deliberate exception, decided and recorded
 * in docs/11_DECISION_LOG.md — a *representation normalization at the M2
 * boundary*, not an invented clinical value:
 *   - SQL imposes `pain = false ⟺ pain_intensity IS NULL`
 *     (`pain_intensity_requires_pain` CHECK constraint) — when there is no
 *     pain, "intensity" is not a fact that exists to record, not an
 *     unknown fact that was omitted.
 *   - M1's frozen `DailyCheckin.pain_intensity` type is `number`
 *     (non-optional) regardless of `pain` — the type itself cannot
 *     represent "not applicable".
 *   - Every M1 read site (src/rules/safety.ts,
 *     src/engine/computeDimensions.ts, src/rules/painNonSafety.ts) only
 *     ever dereferences `pain_intensity` behind a `checkin.pain` guard —
 *     the value is provably never read when `pain = false`.
 * Given those three facts together, mapping the SQL NULL to the numeric
 * scale's own zero point (`0`) when `pain = false` is the boundary
 * reconciliation between "not applicable" (SQL) and "must be a number"
 * (M1's frozen type), not a guess at unknown clinical data. `pain = true`
 * with `pain_intensity` NULL/non-number remains rejected unconditionally
 * (see `missingFields` check below) — this normalization applies only to
 * the one state SQL itself declares as "intensity does not apply".
 */
import type { DailyCheckin } from "../../types/index.js";
import { mapDailyCheckinPainCriteria, type DailyCheckinPainCriteriaRow } from "./dailyCheckinPainCriteria.js";
import type { DailyCheckinRow } from "../repositories/dailyCheckinsRepo.js";

export class IncompleteDailyCheckinError extends Error {
  constructor(public readonly missingFields: readonly string[]) {
    super(
      `Incomplete current checkin: fields [${missingFields.join(", ")}] are missing or not of the ` +
        "expected type. A current M2 checkin must explicitly provide every value M1 requires — see " +
        "src/supabase/mapping/dailyCheckinRow.ts for the exact contract."
    );
    this.name = "IncompleteDailyCheckinError";
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

const REQUIRED_NUMBER_FIELDS = [
  "sleep_hours",
  "sleep_quality",
  "sleep_wake_ups",
  "energy",
  "work_stress",
  "motivation",
  "leg_fatigue",
  "grip_fatigue",
] as const;

const REQUIRED_BOOLEAN_FIELDS = ["pain", "pain_new", "suspected_concussion", "fever_or_illness"] as const;

/**
 * Maps a `daily_checkins` row (already selected for `checkin_date = today`
 * by the repository) to M1's `DailyCheckin`. Throws
 * {@link IncompleteDailyCheckinError} if any required field is missing or
 * not of the expected runtime type — never coerces. Reuses
 * {@link mapDailyCheckinPainCriteria} (M2_001) for the three enriched pain
 * criteria rather than re-validating them here.
 */
export function mapDailyCheckinRow(row: DailyCheckinRow): DailyCheckin {
  const missingFields: string[] = [];

  if (typeof row.checkin_date !== "string") missingFields.push("checkin_date");

  for (const field of REQUIRED_NUMBER_FIELDS) {
    if (!isNumber(row[field])) missingFields.push(field);
  }
  for (const field of REQUIRED_BOOLEAN_FIELDS) {
    if (!isBoolean(row[field])) missingFields.push(field);
  }

  // pain_intensity is required only when pain === true (see module doc).
  const painIsTrue = row.pain === true;
  if (painIsTrue && !isNumber(row.pain_intensity)) missingFields.push("pain_intensity");

  if (missingFields.length > 0) {
    throw new IncompleteDailyCheckinError(missingFields);
  }

  // mapDailyCheckinPainCriteria throws its own IncompleteCheckinPainCriteriaError
  // if any of the three enriched pain criteria is missing/NULL/non-boolean.
  const painCriteria = mapDailyCheckinPainCriteria(row as DailyCheckinPainCriteriaRow);

  return {
    date: row.checkin_date as string,
    sleep_hours: row.sleep_hours as number,
    sleep_quality: row.sleep_quality as number,
    sleep_wake_ups: row.sleep_wake_ups as number,
    energy: row.energy as number,
    work_stress: row.work_stress as number,
    motivation: row.motivation as number,
    leg_fatigue: row.leg_fatigue as number,
    grip_fatigue: row.grip_fatigue as number,
    pain: row.pain as boolean,
    // Boundary normalization decided in docs/11_DECISION_LOG.md: SQL NULL
    // ("not applicable" when pain = false) → 0 (the scale's own zero
    // point). Never reached when pain = true — that case is rejected above.
    pain_intensity: painIsTrue ? (row.pain_intensity as number) : 0,
    pain_new: row.pain_new as boolean,
    pain_location_code: typeof row.pain_location_code === "string" ? row.pain_location_code : undefined,
    pain_traumatic: painCriteria.pain_traumatic,
    pain_function_loss: painCriteria.pain_function_loss,
    pain_getting_worse: painCriteria.pain_getting_worse,
    suspected_concussion: row.suspected_concussion as boolean,
    fever_or_illness: row.fever_or_illness as boolean,
    free_comment: typeof row.free_comment === "string" ? row.free_comment : undefined,
  };
}
