/**
 * Vocabulary deliberately DUPLICATED from head-coach-engine's frozen
 * `src/types/context.ts` (TrainingMode) and `src/types/trainingIntervention.ts`
 * (TrainingInterventionKind values, LoadProfile) rather than imported.
 *
 * This package must never depend on head-coach-engine internals (M0
 * Architecture Lock, enforced by tests/unit/boundaries.test.ts) — the same
 * cross-package duplication precedent already used by
 * `supabase/functions/completed-session/validation.ts` and
 * `head-coach-engine/src/supabase/repositories/athleteCoachingContextRepo.ts`'s
 * own discipline-options list. Kept in sync by hand; a drift here is a
 * projection-compatibility bug, not a type error, so any change to the
 * frozen vocabulary must be mirrored here deliberately.
 */

/** Mirrors head-coach-engine's TrainingMode (src/types/context.ts) — the vocabulary training_blocks.mode ultimately consumes via the projection contract (M0 Issue 1). */
export type TrainingMode =
  | "RACE_WEEK"
  | "RACE_CLUSTER"
  | "OFF_SEASON_RECOVERY"
  | "OFF_SEASON_DEVELOPMENT"
  | "PRE_SEASON"
  | "IN_SEASON"
  | "INJURY_RECOVERY"
  | "OTHER"
  | "UNSPECIFIED";

/** Mirrors head-coach-engine's TrainingInterventionKind (src/types/trainingIntervention.ts) — the vocabulary planned_sessions.intervention.kind ultimately consumes. */
export type SessionKind =
  | "STRENGTH_LOWER"
  | "STRENGTH_UPPER"
  | "STRENGTH_FULL_LIGHT"
  | "POWER"
  | "GRIP_WORK"
  | "AEROBIC_BASE"
  | "AEROBIC_INTERVALS"
  | "DH_TECHNICAL"
  | "DH_PERFORMANCE"
  | "DH_LIGHT"
  | "PUMPTRACK"
  | "MOBILITY"
  | "RECOVERY_ACTIVE"
  | "REST"
  | "BIKE_MAINTENANCE"
  | "RACE_ACTIVITY";

/** Mirrors head-coach-engine's LoadProfile — only meaningful for load-variable SessionKinds. */
export type LoadProfile = "HEAVY" | "MODERATE" | "LIGHT";

export const LOAD_VARIABLE_SESSION_KINDS: ReadonlySet<SessionKind> = new Set([
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
