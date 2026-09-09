import type { TrainingIntervention, TrainingInterventionKind } from "./planningTypes";
import { isLoadProfile, isPlannableFixedLoadKind, isPlannableLoadVariableKind } from "./planningTypes";
import { isDhFamilyPlannableKind, isPlannedDurationPreset } from "./plannedDurationPolicy";

export type ValidatePlannedInterventionResult =
  | { ok: true; intervention: TrainingIntervention }
  | { ok: false; error: string };

type DurationFieldsResult = { ok: true; fields: { duration_min?: number } } | { ok: false; error: string };

/**
 * V0.3_006C2 — resolves the optional `duration_min` field to merge into the
 * constructed `intervention`. `rawDurationMin === null` (no selection, or
 * the athlete explicitly cleared it) always succeeds with no field —
 * `intervention` then carries no `duration_min` key at all, never a
 * `duration_min: null` representation (parseTrainingIntervention does not
 * support that shape). A non-null value must be one of the closed preset
 * minutes AND the kind must be DH-family — the ONE authoritative source is
 * `intervention.duration_min`, DH-only in this slice (see
 * plannedDurationPolicy.ts). Rejected (not silently dropped) so a caller
 * outside the normal UI flow can never persist a stale/invalid value —
 * same code-level-guard philosophy as the kind/load_profile checks below.
 */
function resolvePlannedDurationMinFields(kind: TrainingInterventionKind, rawDurationMin: string | null): DurationFieldsResult {
  if (rawDurationMin === null) return { ok: true, fields: {} };

  const parsed = Number(rawDurationMin);
  if (!Number.isFinite(parsed) || !isPlannedDurationPreset(parsed)) {
    return { ok: false, error: `Durée prévue invalide : ${rawDurationMin}.` };
  }
  if (!isDhFamilyPlannableKind(kind)) {
    return { ok: false, error: `${kind} n'accepte pas de durée prévue (V0.3_006C2 est DH uniquement).` };
  }
  return { ok: true, fields: { duration_min: parsed } };
}

/**
 * Validates a raw (kind, load_profile, duration_min) triple against the real
 * TrainingIntervention discriminant contract
 * (head-coach-engine/src/types/trainingIntervention.ts,
 * parseTrainingIntervention.ts): a LoadVariableKind requires a valid
 * load_profile, a FixedLoadKind forbids one, and RACE_ACTIVITY is never
 * athlete-plannable (docs/11_DECISION_LOG.md V0.3_003A — exclusively
 * race-protocol-derived). Inputs are treated as raw strings (not trusted
 * literal types) since they originate from user-facing form state.
 * `rawDurationMin` defaults to `null` (no duration) — see
 * resolvePlannedDurationMinFields above for its own contract.
 */
export function validatePlannedIntervention(
  rawKind: string,
  rawLoadProfile: string | null,
  rawDurationMin: string | null = null
): ValidatePlannedInterventionResult {
  if (rawKind === "RACE_ACTIVITY") {
    return { ok: false, error: "RACE_ACTIVITY ne peut pas être planifié — dérivé uniquement du protocole de course." };
  }

  if (isPlannableFixedLoadKind(rawKind)) {
    if (rawLoadProfile !== null) {
      return { ok: false, error: `${rawKind} n'accepte pas d'intensité (load_profile).` };
    }
    const duration = resolvePlannedDurationMinFields(rawKind as TrainingInterventionKind, rawDurationMin);
    if (!duration.ok) return duration;
    return { ok: true, intervention: { kind: rawKind, ...duration.fields } as TrainingIntervention };
  }

  if (isPlannableLoadVariableKind(rawKind)) {
    if (rawLoadProfile === null) {
      return { ok: false, error: `${rawKind} requiert une intensité (load_profile).` };
    }
    if (!isLoadProfile(rawLoadProfile)) {
      return { ok: false, error: `Intensité invalide : ${rawLoadProfile}.` };
    }
    const duration = resolvePlannedDurationMinFields(rawKind as TrainingInterventionKind, rawDurationMin);
    if (!duration.ok) return duration;
    return { ok: true, intervention: { kind: rawKind, load_profile: rawLoadProfile, ...duration.fields } as TrainingIntervention };
  }

  return { ok: false, error: `Type de séance invalide : ${rawKind}.` };
}
