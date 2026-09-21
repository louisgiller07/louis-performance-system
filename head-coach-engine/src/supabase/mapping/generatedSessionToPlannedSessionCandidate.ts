/**
 * `training_plan_generated_sessions` raw row → planned_sessions projection
 * candidate. Pure translation only — no coaching logic, no I/O.
 *
 * Reuses the frozen `TrainingIntervention -> DbSessionType` mapping
 * (`../../mapping/trainingInterventionToDbSessionType.js`) verbatim rather
 * than reimplementing it: that function is exhaustive over
 * `TrainingInterventionKind`'s 16 values and is the single source of truth
 * for this translation across the whole engine (M2.6/M2.7, ADR V0.4_012).
 * Never duplicated here, never edited.
 */
import { isFixedLoadKind } from "../../types/trainingIntervention.js";
import type { TrainingIntervention, TrainingInterventionKind, LoadProfile } from "../../types/trainingIntervention.js";
import type { DbSessionType } from "../../types/dbSessionType.js";
import { mapTrainingInterventionToDbSessionType } from "../../mapping/trainingInterventionToDbSessionType.js";
import type { GeneratedSessionRawRow } from "../repositories/trainingPlanGeneratedSessionsRepo.js";

export class InvalidGeneratedSessionRowError extends Error {
  constructor(
    public readonly reason: string,
    public readonly value: unknown
  ) {
    super(`Invalid training_plan_generated_sessions row: ${reason}`);
    this.name = "InvalidGeneratedSessionRowError";
  }
}

export interface PlannedSessionCandidate {
  date: string;
  sessionType: DbSessionType;
  intervention: TrainingIntervention;
  sourceGeneratedSessionId: string;
}

/**
 * Builds one projection candidate from a raw generated-session row.
 * `session_type` is derived, never carried by the row itself — the
 * canonical tree only ever speaks the rich `SessionKind` vocabulary
 * (M0/M1); the coarse legacy column is entirely a `planned_sessions`
 * concern, resolved here at projection time.
 */
export function mapGeneratedSessionToPlannedSessionCandidate(row: GeneratedSessionRawRow): PlannedSessionCandidate {
  const kind = row.kind as TrainingInterventionKind;

  const intervention: TrainingIntervention = isFixedLoadKind(kind)
    ? {
        kind,
        ...(row.duration_min !== null ? { duration_min: row.duration_min } : {}),
        ...(row.focus !== null ? { focus: row.focus } : {}),
      }
    : {
        kind,
        // Guaranteed non-null for a load-variable kind by the canonical
        // schema's own CHECK (training_plan_generated_sessions_load_profile_
        // matches_kind) — this branch is otherwise unreachable, kept as an
        // explicit rejection rather than a silent `as LoadProfile` cast.
        load_profile: requireLoadProfile(row),
        ...(row.duration_min !== null ? { duration_min: row.duration_min } : {}),
        ...(row.focus !== null ? { focus: row.focus } : {}),
      };

  return {
    date: row.date,
    sessionType: mapTrainingInterventionToDbSessionType(intervention),
    intervention,
    sourceGeneratedSessionId: row.id,
  };
}

function requireLoadProfile(row: GeneratedSessionRawRow): LoadProfile {
  if (row.load_profile === null) {
    throw new InvalidGeneratedSessionRowError(
      `kind "${row.kind}" is load-variable but load_profile is null — should be unreachable given the canonical schema's own CHECK constraint`,
      row
    );
  }
  return row.load_profile as LoadProfile;
}
