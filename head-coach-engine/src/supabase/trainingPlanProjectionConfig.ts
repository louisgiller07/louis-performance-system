/**
 * Resolves the projection window size from the environment (ADR V0.4_015A
 * — Projection Window Policy: environment configuration, skip-if-absent).
 * No database access, no side effects — a pure read of `env` (defaulting
 * to `process.env`, same injectable-default style as
 * client.ts::readSupabaseServerConfigFromEnv).
 *
 * `TRAINING_PLAN_PROJECTION_WINDOW_DAYS`:
 *  - absent -> `{ enabled: false }`, no warning. This is the intended,
 *    deployable-dark default state (V0.4_015A) — projection stays off
 *    until this variable is explicitly set, never a code change.
 *  - a positive integer ("1", "7", "14", "30", ...) -> `{ enabled: true, windowDays }`.
 *  - anything else present but not a positive integer ("0", "-1", "abc",
 *    "1.5") -> `{ enabled: false, warning }`. Present-but-malformed is
 *    treated as a configuration mistake worth surfacing, distinct from
 *    "deliberately not configured" — but still never blocks the daily run,
 *    same discipline as every other best-effort step in this codebase.
 */

export interface TrainingPlanProjectionWindowDisabled {
  enabled: false;
  warning?: string;
}

export interface TrainingPlanProjectionWindowEnabled {
  enabled: true;
  windowDays: number;
}

export type TrainingPlanProjectionWindowConfig =
  | TrainingPlanProjectionWindowDisabled
  | TrainingPlanProjectionWindowEnabled;

const ENV_VAR_NAME = "TRAINING_PLAN_PROJECTION_WINDOW_DAYS";
/** A positive integer, no sign, no decimal point, no leading/trailing characters. */
const POSITIVE_INTEGER = /^\d+$/;

export function resolveTrainingPlanProjectionWindow(
  env: NodeJS.ProcessEnv = process.env
): TrainingPlanProjectionWindowConfig {
  const raw = env[ENV_VAR_NAME];

  if (raw === undefined) {
    return { enabled: false };
  }

  if (!POSITIVE_INTEGER.test(raw)) {
    return {
      enabled: false,
      warning: `${ENV_VAR_NAME} is invalid ("${raw}") — must be a positive integer. Projection is disabled for this run.`,
    };
  }

  const windowDays = Number(raw);
  if (windowDays <= 0) {
    return {
      enabled: false,
      warning: `${ENV_VAR_NAME} must be greater than zero (got "${raw}"). Projection is disabled for this run.`,
    };
  }

  return { enabled: true, windowDays };
}
