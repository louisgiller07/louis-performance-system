/**
 * Structural error taxonomy owned by M5_006D's effective-evidence
 * aggregation. Every class here represents a contract violation the
 * caller's own `pattern_evidence_current_effective` read should already
 * guarantee never happens — surfaced loudly rather than silently filtered
 * or deduplicated, same philosophy as every other structural error in this
 * package (see e.g. detectors/sleepEnergyErrors.ts).
 */

/** A supplied row's `athleteId` disagrees with the aggregation's own scope — never silently discarded. */
export class AggregationAthleteScopeMismatchError extends Error {
  constructor(evidenceKey: string, rowAthleteId: string, expectedAthleteId: string) {
    super(
      `AggregationAthleteScopeMismatchError: evidence "${evidenceKey}" belongs to athlete "${rowAthleteId}", but this aggregation call is scoped to athlete "${expectedAthleteId}"`
    );
    this.name = "AggregationAthleteScopeMismatchError";
  }
}

/** A supplied row's `eventDate` falls outside the caller's own `[range.fromDate, range.toDate]` — never silently filtered out. */
export class EvidenceOutsideAggregationRangeError extends Error {
  constructor(evidenceKey: string, eventDate: string, fromDate: string, toDate: string) {
    super(`EvidenceOutsideAggregationRangeError: evidence "${evidenceKey}" has eventDate "${eventDate}" outside the aggregation range [${fromDate}, ${toDate}]`);
    this.name = "EvidenceOutsideAggregationRangeError";
  }
}

/**
 * The same `identityId` appears more than once in the supplied evidence.
 * `pattern_evidence_current_effective` guarantees at most one row per
 * identity (see its own view definition, M5_006B) — a genuine duplicate
 * here means the caller assembled the input incorrectly (e.g. concatenated
 * two overlapping reads), never something to silently deduplicate.
 */
export class DuplicateEffectiveEvidenceIdentityError extends Error {
  constructor(identityId: string) {
    super(
      `DuplicateEffectiveEvidenceIdentityError: identity "${identityId}" appears more than once in the supplied effective evidence — pattern_evidence_current_effective guarantees at most one row per identity`
    );
    this.name = "DuplicateEffectiveEvidenceIdentityError";
  }
}

/**
 * The same `evidenceKey` appears more than once within the same
 * (athleteId, detectorRuleId, detectorRuleVersion) group. Distinct from
 * `DuplicateEffectiveEvidenceIdentityError`: a genuinely malformed input
 * could carry two different identities that happen to share an
 * `evidenceKey` string within the same detector/version scope — never
 * silently deduplicated.
 */
export class DuplicateEffectiveEvidenceKeyError extends Error {
  constructor(evidenceKey: string, detectorRuleId: string, detectorRuleVersion: string) {
    super(
      `DuplicateEffectiveEvidenceKeyError: evidenceKey "${evidenceKey}" appears more than once within (detectorRuleId="${detectorRuleId}", detectorRuleVersion="${detectorRuleVersion}")`
    );
    this.name = "DuplicateEffectiveEvidenceKeyError";
  }
}
