// V0.3_007B — the rich, athlete-facing "what did you actually do" vocabulary
// for a performed session (done/partial/replaced). Reuses Planning's own
// TrainingIntervention/LoadProfile types and its 11 load-variable kinds
// directly (identical vocabulary, identical validity rules) — the ONE
// deliberate difference from planningTypes.ts's own PLANNABLE_FIXED_LOAD_KINDS
// is RACE_ACTIVITY: never a valid *plan* (planning is intent, and racing is
// never planned as such — docs/11_DECISION_LOG.md V0.3_003A), but a
// perfectly valid *performed reality* (an athlete can honestly report "I
// raced today"). This is a small, deliberate divergence, not a duplicated
// vocabulary — everything else is shared verbatim.
import type { TrainingIntervention, TrainingInterventionKind, LoadProfile } from "../dailyPlan/dailyPlanTypes";
import { PLANNABLE_LOAD_VARIABLE_KINDS, isLoadProfile } from "../planning/planningTypes";

export type { TrainingIntervention, TrainingInterventionKind, LoadProfile };
export { isLoadProfile };

export const PERFORMED_FIXED_LOAD_KINDS = ["MOBILITY", "RECOVERY_ACTIVE", "REST", "BIKE_MAINTENANCE", "RACE_ACTIVITY"] as const;
export const PERFORMED_LOAD_VARIABLE_KINDS = PLANNABLE_LOAD_VARIABLE_KINDS;

export function isPerformedFixedLoadKind(kind: string): boolean {
  return (PERFORMED_FIXED_LOAD_KINDS as readonly string[]).includes(kind);
}

export function isPerformedLoadVariableKind(kind: string): boolean {
  return (PERFORMED_LOAD_VARIABLE_KINDS as readonly string[]).includes(kind);
}

export type ValidatePerformedInterventionResult =
  | { ok: true; intervention: TrainingIntervention }
  | { ok: false; error: string };

/**
 * Validates a raw (kind, load_profile) pair for a PERFORMED activity —
 * mirrors planning/planningValidation.ts#validatePlannedIntervention's
 * discriminant rules exactly, except RACE_ACTIVITY is accepted here (see
 * module doc). A code-level guard, not a form display path: the UI's own
 * kind/load picker already prevents most invalid combinations, this is the
 * same belt-and-suspenders precedent used throughout this codebase.
 */
export function validatePerformedIntervention(rawKind: string, rawLoadProfile: string | null): ValidatePerformedInterventionResult {
  if (isPerformedFixedLoadKind(rawKind)) {
    if (rawLoadProfile !== null) {
      return { ok: false, error: `${rawKind} n'accepte pas d'intensité (load_profile).` };
    }
    return { ok: true, intervention: { kind: rawKind } as TrainingIntervention };
  }

  if (isPerformedLoadVariableKind(rawKind)) {
    if (rawLoadProfile === null) {
      return { ok: false, error: `${rawKind} requiert une intensité (load_profile).` };
    }
    if (!isLoadProfile(rawLoadProfile)) {
      return { ok: false, error: `Intensité invalide : ${rawLoadProfile}.` };
    }
    return { ok: true, intervention: { kind: rawKind, load_profile: rawLoadProfile } as TrainingIntervention };
  }

  return { ok: false, error: `Type de séance invalide : ${rawKind}.` };
}
