/**
 * M5_006C pain_persistence_across_recent_checkins detector result shapes.
 * Pure facts, same philosophy as sleepEnergyTypes.ts/detectors/types.ts:
 * this answers only "is the same-location pain still reported at the next
 * observed checkin, at most 3 calendar days later" — never continuous
 * pain across missing dates, never a coaching recommendation, never a
 * pattern/aggregate (reserved for M5_006D).
 */
import type { PainLocationCode } from "../types/sources.js";

/** The one and only rule identity this module ever produces — literal, not `string`. */
export type PainPersistenceRuleId = "pain_persistence_across_recent_checkins";

export type DetectorEventType = "supporting" | "contradicting" | "neutral";

export type PainPersistenceTransitionKind = "same_location_continuation" | "resolved" | "different_location" | "location_unknown";

export type PainPersistenceAmbiguityReason = "current_marked_new" | "current_pain_new_unknown";

/** Exactly 2 fields (M5_006C lock) — no other IDs. */
export interface PainPersistenceSourceRefs {
  readonly evaluationCheckinId: string;
  readonly previousCheckinId: string;
}

/** Exactly 15 fields (M5_006C lock) — never more, never fewer. */
export interface PainPersistenceObservedValue {
  readonly evaluationCheckinId: string;
  readonly evaluationCheckinDate: string;
  readonly previousCheckinId: string;
  readonly previousCheckinDate: string;
  readonly gapDays: number;
  readonly previousPain: boolean;
  readonly evaluationPain: boolean;
  readonly previousPainLocationCode: PainLocationCode | null;
  readonly evaluationPainLocationCode: PainLocationCode | null;
  readonly previousPainIntensity: number | null;
  readonly evaluationPainIntensity: number | null;
  readonly intensityDelta: number | null;
  readonly evaluationPainNew: boolean | null;
  readonly transitionKind: PainPersistenceTransitionKind;
  readonly ambiguityReasons: readonly PainPersistenceAmbiguityReason[];
}

export interface PainPersistenceEvidence {
  readonly kind: "evidence";
  readonly detectorRuleId: PainPersistenceRuleId;
  readonly detectorRuleVersion: string;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventType: DetectorEventType;
  readonly eventDate: string;
  readonly observedValue: PainPersistenceObservedValue;
  readonly sourceRefs: PainPersistenceSourceRefs;
}

export type PainPersistenceNoEvidenceReason = "no_recent_prior_checkin" | "prior_checkin_has_no_pain";

/** Exactly 10 fields (M5_006C lock) — including evidenceKey (both Evidence AND NoEvidence carry stable keys, same discipline as M5_006B). */
export interface PainPersistenceNoEvidence {
  readonly kind: "no_evidence";
  readonly detectorRuleId: PainPersistenceRuleId;
  readonly detectorRuleVersion: string;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventDate: string;
  readonly evaluationCheckinId: string;
  readonly previousCheckinId: string | null;
  readonly previousCheckinDate: string | null;
  readonly reason: PainPersistenceNoEvidenceReason;
}

/** Canonical public result type — the one name every consumer imports. */
export type PainPersistenceDetection = PainPersistenceEvidence | PainPersistenceNoEvidence;
