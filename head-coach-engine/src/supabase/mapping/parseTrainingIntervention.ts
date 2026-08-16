/**
 * M2_003 — runtime validation of `planned_sessions.intervention` JSONB into
 * a M1 `TrainingIntervention`.
 *
 * See docs/05_DATA_MODEL.md §TrainingIntervention (représentation interne)
 * and src/types/trainingIntervention.ts (frozen — not modified here). The
 * kind/load-profile vocabularies below mirror that frozen type; M1 does not
 * export a runtime-checkable list of valid `kind` values, so this M2
 * boundary maintains its own, kept in sync with the canonical table in
 * docs/05_DATA_MODEL.md §Mapping vers DbSessionType.
 *
 * Validation is strict and throws rather than silently coerces: an
 * `intervention` JSONB that does not match the discriminated union shape
 * (unknown `kind`, missing/invalid `load_profile` for a load-variable kind,
 * a `load_profile` present on a fixed-load kind, or a wrong-typed optional
 * field) is rejected, never guessed at.
 */
import type { TrainingIntervention, LoadProfile } from "../../types/index.js";

const LOAD_VARIABLE_KINDS = new Set([
  "STRENGTH_LOWER",
  "STRENGTH_UPPER",
  "STRENGTH_FULL_LIGHT",
  "POWER",
  "GRIP_WORK",
  "AEROBIC_BASE",
  "AEROBIC_INTERVALS",
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "DH_LIGHT",
  "PUMPTRACK",
]);

const FIXED_LOAD_KINDS = new Set([
  "MOBILITY",
  "RECOVERY_ACTIVE",
  "REST",
  "BIKE_MAINTENANCE",
  "RACE_ACTIVITY",
]);

const LOAD_PROFILES = new Set(["HEAVY", "MODERATE", "LIGHT"]);

export class InvalidTrainingInterventionJsonError extends Error {
  constructor(
    public readonly reason: string,
    public readonly value: unknown
  ) {
    super(`Invalid planned_sessions.intervention JSON: ${reason}`);
    this.name = "InvalidTrainingInterventionJsonError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates and narrows an unknown JSON value read from
 * `planned_sessions.intervention` into a M1 `TrainingIntervention`. Throws
 * {@link InvalidTrainingInterventionJsonError} on any mismatch — never
 * coerces a malformed value into a plausible-looking intervention.
 */
export function parseTrainingIntervention(value: unknown): TrainingIntervention {
  if (!isPlainObject(value)) {
    throw new InvalidTrainingInterventionJsonError("expected a JSON object", value);
  }

  const { kind, load_profile, duration_min, focus, cue } = value;

  if (typeof kind !== "string") {
    throw new InvalidTrainingInterventionJsonError("`kind` is missing or not a string", value);
  }

  if (duration_min !== undefined && typeof duration_min !== "number") {
    throw new InvalidTrainingInterventionJsonError("`duration_min` is present but not a number", value);
  }
  if (focus !== undefined && typeof focus !== "string") {
    throw new InvalidTrainingInterventionJsonError("`focus` is present but not a string", value);
  }
  if (cue !== undefined && typeof cue !== "string") {
    throw new InvalidTrainingInterventionJsonError("`cue` is present but not a string", value);
  }

  const common: Pick<TrainingIntervention, "duration_min" | "focus" | "cue"> = {
    ...(duration_min !== undefined ? { duration_min: duration_min as number } : {}),
    ...(focus !== undefined ? { focus: focus as string } : {}),
    ...(cue !== undefined ? { cue: cue as string } : {}),
  };

  if (FIXED_LOAD_KINDS.has(kind)) {
    if (load_profile !== undefined && load_profile !== null) {
      throw new InvalidTrainingInterventionJsonError(
        `fixed-load kind "${kind}" must not carry a load_profile`,
        value
      );
    }
    return { kind, ...common } as TrainingIntervention;
  }

  if (LOAD_VARIABLE_KINDS.has(kind)) {
    if (typeof load_profile !== "string" || !LOAD_PROFILES.has(load_profile)) {
      throw new InvalidTrainingInterventionJsonError(
        `load-variable kind "${kind}" requires load_profile to be HEAVY, MODERATE or LIGHT`,
        value
      );
    }
    return { kind, load_profile: load_profile as LoadProfile, ...common } as TrainingIntervention;
  }

  throw new InvalidTrainingInterventionJsonError(`unknown kind "${kind}"`, value);
}
