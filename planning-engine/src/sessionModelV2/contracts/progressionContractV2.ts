/**
 * SPORT-PLAN-03 V2 contracts (HPM 2026-10-25, corrected V2-CONTRACTS-REVIEW-01) — three doses kept apart.
 * NON-PRESCRIPTIVE and DORMANT: imported by no generator, no daily engine, no reader; its evidence is an INPUT, never
 * read from a history (no PARTIAL-01-L2 / HISTORY-READ-01 wiring, ADR A11 not active).
 *
 * - Tolerated dose reference (ToleratedDoseReferenceV2): a HISTORICAL fact, the highest dose known to have been
 *   tolerated. It is never lowered automatically (a taper, a fatigue day or an unfavourable result keeps it) and it
 *   NEVER sets a floor: nothing obliges a later session to prescribe it again.
 * - Candidate progression (CandidateProgressionV2): what the cycle proposes for a session.
 * - Effective prescription (EffectivePrescriptionV2): decided by the DAILY ENGINE (Safety, fatigue, today's time,
 *   PHYS rules), which may lower, replace or suspend the session. This contract only checks it against an upper bound.
 *
 * Generic mechanism (technical): assessProgressionCandidateV2 returns an admissible MAXIMUM, never a minimum. A rise
 * above the reference is admissible only when the given policy allows it AND the previous session of the same
 * family gave a reliable result; an absent result is not a failure; an unfavourable result asks for a review. Doses
 * of different families, measures or DH units are never compared (a SECTION reference says nothing of FULL_RUN).
 * Sports parameters (configurable, not validated): how many steps a reliable result admits, the excluded steps, the
 * cap without any reference. The default policy admits NO rise. Ladders are the catalogue's; no new dose.
 */
import { PLAN_PROGRESSION_CAPS_V2, PLAN_ROLE_DOSES_V2 } from "../../catalog/planDosePolicyV2.js";
import { STRENGTH_DOSE_STEPS_V2, type StrengthDoseStepV2 } from "../../catalog/strengthDoseCatalogV2.js";
import type { DhRepetitionUnitV2 } from "./dhRepetitionUnitV2.js";

export type DoseQuantityV2 =
  | { family: "force"; measure: "dose_step"; step: StrengthDoseStepV2 }
  | { family: "force"; measure: "work_sets"; sets: number }
  | { family: "endurance"; measure: "minutes"; minutes: number }
  | { family: "dh"; measure: "repetitions"; repetitions: number; unit: DhRepetitionUnitV2 };

export interface ToleratedDoseReferenceV2 {
  dose: DoseQuantityV2;
  date: string;
  source: "declared" | "recorded";
}

export interface CandidateProgressionV2 {
  dose: DoseQuantityV2;
  date: string;
}

/** What is known of the previous session of the same family. `absent`: nothing recorded — never a failure. */
export type ProgressionEvidenceV2 = { kind: "absent" } | { kind: "result"; outcome: "complete" | "partial" | "missed"; targetMet: boolean; healthSignal: boolean };

/** Sports parameters. `autonomous: false` — no policy here ever raises a dose by itself. */
export interface ProgressionPolicyV2 {
  id: string;
  status: "TECHNICAL_DEFAULT" | "CANDIDATE_NOT_VALIDATED";
  autonomous: false;
  /** Steps above the reference one reliable result may admit, for the measures with a catalogue step; 0 = none. */
  stepsAboveReference: { dose_step: number; minutes: number };
  /** Steps never admitted by a calendar rise (a written decision is needed). */
  excludedSteps: readonly StrengthDoseStepV2[];
}

/** Default: no rise is ever admissible. */
export const NO_PROGRESSION_POLICY_V2: ProgressionPolicyV2 = { id: "no_progression", status: "TECHNICAL_DEFAULT", autonomous: false, stepsAboveReference: { dose_step: 0, minutes: 0 }, excludedSteps: ["MODERATE_PLUS"] };

/**
 * CANDIDATE, NOT VALIDATED (SPORT_PLAN_03_SPORTS_FINAL_DECISIONS.md § 4.9): one catalogue step per reliable result,
 * Force L → M and endurance by the catalogue's 15 minutes; M+ excluded; no set, load or DH repetition increase (those
 * measures have no step here). Passed explicitly or not at all; never a default.
 */
export const CANDIDATE_ONE_STEP_POLICY_V2: ProgressionPolicyV2 = { id: "candidate_one_step", status: "CANDIDATE_NOT_VALIDATED", autonomous: false, stepsAboveReference: { dose_step: 1, minutes: 1 }, excludedSteps: ["MODERATE_PLUS"] };

export type ProgressionSituationV2 =
  | "dans_la_reference"
  | "sans_reference"
  | "reference_non_comparable"
  | "unite_dh_inconnue"
  | "resultat_absent"
  | "execution_incomplete_ou_non_faite"
  | "resultat_defavorable"
  | "hausse_non_prevue_par_la_politique"
  | "palier_exclu_par_la_politique"
  | "hausse_admissible";

export interface ProgressionAssessmentV2 {
  candidate: DoseQuantityV2;
  /** The reference as given: an assessment never changes it. */
  reference: ToleratedDoseReferenceV2 | null;
  /**
   * The highest dose this candidate may reach — an UPPER BOUND ONLY. The effective prescription may be any lower
   * dose, a replacement or no session. Null: this contract admits no count (DH unit unknown, or no comparable
   * reference for a measure without a catalogue introduction level).
   */
  admissibleMax: DoseQuantityV2 | null;
  riseAdmissible: boolean;
  situation: ProgressionSituationV2;
  /** An unfavourable result: the coach reviews and adapts; nothing is lowered or represcribed automatically. */
  adaptationReview: boolean;
  /** No comparable reference: the starting dose is a sports decision, outside this contract. */
  startingDoseDecisionRequired: boolean;
  policy: { id: string; status: ProgressionPolicyV2["status"] };
}

function sameScale(a: DoseQuantityV2, b: DoseQuantityV2): boolean {
  if (a.family !== b.family || a.measure !== b.measure) return false;
  if (a.family === "dh" && b.family === "dh") return a.unit !== "UNKNOWN" && a.unit === b.unit;
  return true;
}

function magnitude(d: DoseQuantityV2): number {
  switch (d.measure) {
    case "dose_step":
      return STRENGTH_DOSE_STEPS_V2.indexOf(d.step);
    case "work_sets":
      return d.sets;
    case "minutes":
      return d.minutes;
    case "repetitions":
      return d.repetitions;
  }
}

const atMost = (a: DoseQuantityV2, b: DoseQuantityV2) => (magnitude(a) <= magnitude(b) ? a : b);

/** One catalogue step up, or null where the generic mechanism defines no step (sets, DH repetitions). */
function stepAbove(d: DoseQuantityV2, steps: number): DoseQuantityV2 | null {
  if (d.measure === "dose_step") return { ...d, step: STRENGTH_DOSE_STEPS_V2[Math.min(STRENGTH_DOSE_STEPS_V2.length - 1, magnitude(d) + steps)]! };
  if (d.measure === "minutes") return { ...d, minutes: Math.min(PLAN_PROGRESSION_CAPS_V2.aerobicMaxMin, d.minutes + steps * PLAN_PROGRESSION_CAPS_V2.aerobicStepMin) };
  return null;
}

/** The catalogue's introduction level on the candidate's scale, when the catalogue has one (Force step, minutes). */
function introductionOn(candidate: DoseQuantityV2): DoseQuantityV2 | null {
  const intro = PLAN_ROLE_DOSES_V2.introduction;
  if (candidate.measure === "dose_step") return { family: "force", measure: "dose_step", step: intro.forceDoseStep };
  if (candidate.measure === "minutes") return { family: "endurance", measure: "minutes", minutes: intro.aerobicBaseDurationMin };
  return null;
}

export function assessProgressionCandidateV2(input: { candidate: CandidateProgressionV2; reference: ToleratedDoseReferenceV2 | null; evidence: ProgressionEvidenceV2; policy?: ProgressionPolicyV2 }): ProgressionAssessmentV2 {
  const policy = input.policy ?? NO_PROGRESSION_POLICY_V2;
  const candidate = input.candidate.dose;
  const reference = input.reference;
  const assessment = (admissibleMax: DoseQuantityV2 | null, situation: ProgressionSituationV2, extra: { riseAdmissible?: boolean; adaptationReview?: boolean; startingDoseDecisionRequired?: boolean } = {}): ProgressionAssessmentV2 => ({
    candidate,
    reference,
    admissibleMax,
    riseAdmissible: extra.riseAdmissible ?? false,
    situation,
    adaptationReview: extra.adaptationReview ?? false,
    startingDoseDecisionRequired: extra.startingDoseDecisionRequired ?? false,
    policy: { id: policy.id, status: policy.status },
  });

  if (candidate.family === "dh" && candidate.unit === "UNKNOWN") return assessment(null, "unite_dh_inconnue");
  if (reference === null || !sameScale(reference.dose, candidate)) {
    const intro = introductionOn(candidate);
    return assessment(intro === null ? null : atMost(candidate, intro), reference === null ? "sans_reference" : "reference_non_comparable", { startingDoseDecisionRequired: true });
  }
  const ref = reference.dose;
  if (magnitude(candidate) <= magnitude(ref)) return assessment(candidate, "dans_la_reference");

  // The candidate is above the reference: a rise. The admissible maximum stays the reference unless all conditions hold.
  const e = input.evidence;
  if (e.kind === "absent") return assessment(ref, "resultat_absent");
  if (e.outcome !== "complete") return assessment(ref, "execution_incomplete_ou_non_faite");
  if (!e.targetMet || e.healthSignal) return assessment(ref, "resultat_defavorable", { adaptationReview: true });
  const steps = candidate.measure === "dose_step" ? policy.stepsAboveReference.dose_step : candidate.measure === "minutes" ? policy.stepsAboveReference.minutes : 0;
  const above = steps > 0 ? stepAbove(ref, steps) : null;
  if (above === null) return assessment(ref, "hausse_non_prevue_par_la_politique");
  if (above.measure === "dose_step" && policy.excludedSteps.includes(above.step)) return assessment(ref, "palier_exclu_par_la_politique");
  return assessment(atMost(candidate, above), "hausse_admissible", { riseAdmissible: true });
}

/** What the daily engine decided for the session. */
export type EffectivePrescriptionV2 = { kind: "prescribed"; dose: DoseQuantityV2 } | { kind: "replaced"; byFamily: string } | { kind: "suspended" };

export type EffectiveCheckV2 =
  | { ok: true; relation: "at_admissible_max" | "below_admissible_max" | "replaced" | "suspended" }
  | { ok: false; reason: "above_admissible_max" | "not_comparable" | "no_admissible_count" };

/** Checks the daily engine's decision against the UPPER bound only: lower, replaced or suspended is always accepted. */
export function checkEffectivePrescriptionV2(assessment: ProgressionAssessmentV2, effective: EffectivePrescriptionV2): EffectiveCheckV2 {
  if (effective.kind === "suspended") return { ok: true, relation: "suspended" };
  if (effective.kind === "replaced") return { ok: true, relation: "replaced" };
  if (assessment.admissibleMax === null) return { ok: false, reason: "no_admissible_count" };
  if (!sameScale(effective.dose, assessment.admissibleMax)) return { ok: false, reason: "not_comparable" };
  const d = magnitude(effective.dose) - magnitude(assessment.admissibleMax);
  return d > 0 ? { ok: false, reason: "above_admissible_max" } : { ok: true, relation: d === 0 ? "at_admissible_max" : "below_admissible_max" };
}

/**
 * The historical reference after an executed session: only a reliable result on a comparable dose at or above the
 * reference records a new one. Anything else (a lower dose, a taper, a partial, absent or unfavourable result, an
 * unknown DH unit) keeps the reference exactly as it was: never lowered, never erased.
 */
export function nextToleratedReferenceV2(reference: ToleratedDoseReferenceV2 | null, executed: { dose: DoseQuantityV2; date: string; evidence: ProgressionEvidenceV2 }): ToleratedDoseReferenceV2 | null {
  const e = executed.evidence;
  const reliable = e.kind === "result" && e.outcome === "complete" && e.targetMet && !e.healthSignal;
  if (!reliable) return reference;
  if (executed.dose.family === "dh" && executed.dose.unit === "UNKNOWN") return reference;
  if (reference === null) return { dose: executed.dose, date: executed.date, source: "recorded" };
  if (!sameScale(reference.dose, executed.dose) || magnitude(executed.dose) < magnitude(reference.dose)) return reference;
  return { dose: executed.dose, date: executed.date, source: "recorded" };
}
