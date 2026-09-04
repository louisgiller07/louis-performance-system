/**
 * Runtime validation of `training_blocks.mode` / `training_mode` enum
 * values into M1's `TrainingMode`. M1 does not export a runtime-checkable
 * list of `TrainingMode` values, so this M2 boundary maintains its own,
 * mirroring `src/types/context.ts` (frozen) and the DB enum
 * `public.training_mode` (docs/05_DATA_MODEL.md §Enums).
 */
import type { TrainingMode } from "../../types/index.js";

const TRAINING_MODES: ReadonlySet<string> = new Set([
  "RACE_WEEK",
  "RACE_CLUSTER",
  "OFF_SEASON_RECOVERY",
  "OFF_SEASON_DEVELOPMENT",
  "PRE_SEASON",
  "IN_SEASON",
  "INJURY_RECOVERY",
  "OTHER",
  "UNSPECIFIED",
]);

export class InvalidTrainingModeError extends Error {
  constructor(public readonly value: unknown) {
    super(`Invalid training_mode value: ${JSON.stringify(value)}`);
    this.name = "InvalidTrainingModeError";
  }
}

/** Throws {@link InvalidTrainingModeError} rather than silently accepting an unknown string. */
export function parseTrainingMode(value: unknown): TrainingMode {
  if (typeof value !== "string" || !TRAINING_MODES.has(value)) {
    throw new InvalidTrainingModeError(value);
  }
  return value as TrainingMode;
}
