import type { TrainingIntervention } from "./planningTypes";
import { isLoadProfile, isPlannableFixedLoadKind, isPlannableLoadVariableKind } from "./planningTypes";

export type ValidatePlannedInterventionResult =
  | { ok: true; intervention: TrainingIntervention }
  | { ok: false; error: string };

/**
 * Validates a raw (kind, load_profile) pair against the real
 * TrainingIntervention discriminant contract
 * (head-coach-engine/src/types/trainingIntervention.ts,
 * parseTrainingIntervention.ts): a LoadVariableKind requires a valid
 * load_profile, a FixedLoadKind forbids one, and RACE_ACTIVITY is never
 * athlete-plannable (docs/11_DECISION_LOG.md V0.3_003A — exclusively
 * race-protocol-derived). Inputs are treated as raw strings (not trusted
 * literal types) since they originate from user-facing form state.
 */
export function validatePlannedIntervention(
  rawKind: string,
  rawLoadProfile: string | null
): ValidatePlannedInterventionResult {
  if (rawKind === "RACE_ACTIVITY") {
    return { ok: false, error: "RACE_ACTIVITY ne peut pas être planifié — dérivé uniquement du protocole de course." };
  }

  if (isPlannableFixedLoadKind(rawKind)) {
    if (rawLoadProfile !== null) {
      return { ok: false, error: `${rawKind} n'accepte pas d'intensité (load_profile).` };
    }
    return { ok: true, intervention: { kind: rawKind } as TrainingIntervention };
  }

  if (isPlannableLoadVariableKind(rawKind)) {
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
