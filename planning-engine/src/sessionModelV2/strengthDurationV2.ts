/**
 * PHYS-01 — how long a Force prescription really takes, computed from its
 * content (never the planner's 45 / 60-minute slot).
 *
 * Conservative by construction (STRENGTH_TIMING_V2, strengthDailyCatalogV2): every range is read
 * at its upper bound. For each exercise item: sets × (setup + work), the rests
 * between its sets, one transition after it; the principal movement's ramp-up
 * sets with their own short rest. Rounded up to the minute. Blocks without
 * exercise items (instructions only) count for nothing: a Force session has
 * none.
 *
 * Pure and deterministic. Used by the rider's-time adaptation (A10): a Force
 * session is offered only when this estimate fits the rider's time.
 */
import { STRENGTH_TIMING_V2 } from "../catalog/strengthDailyCatalogV2.js";
import type { ExerciseMeasureV2, PrescriptionItemV2Content } from "./prescriptionV2.js";

const T = STRENGTH_TIMING_V2;

/** Work time of ONE set (seconds), at the measure's upper bound. */
function setWorkSeconds(measure: ExerciseMeasureV2): number {
  switch (measure.type) {
    case "reps":
      return measure.max * T.repSeconds * (measure.perSide ? 2 : 1);
    case "duration":
      return measure.maxSeconds * (measure.perSide ? 2 : 1);
    case "distance":
      return Math.ceil(measure.maxMeters / T.metersPerSecond);
  }
}

/** Seconds of one exercise item, transition included (a drill is not a Force item: 0). */
export function strengthItemSecondsV2(item: PrescriptionItemV2Content): number {
  if (item.kind !== "exercise") return 0;
  const rest = item.restSeconds?.max ?? 0;
  const rampUp = item.rampUp ? item.rampUp.sets.max * (T.rampUpSetSeconds + T.rampUpRestSeconds) : 0;
  return item.sets * (T.setSetupSeconds + setWorkSeconds(item.measure)) + (item.sets - 1) * rest + T.transitionSeconds + rampUp;
}

/** Estimated minutes of a Force prescription (content or identified structure), rounded up. */
export function estimateStrengthDurationMinutesV2(prescription: { blocks: readonly { items: readonly PrescriptionItemV2Content[] }[] }): number {
  const seconds = prescription.blocks.reduce((sum, block) => sum + block.items.reduce((s, item) => s + strengthItemSecondsV2(item), 0), 0);
  return Math.ceil(seconds / 60);
}
