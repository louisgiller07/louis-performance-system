/** M5_007 — thrown by buildPatternInsightCandidates for an aggregate whose (detectorRuleId, detectorRuleVersion) has no registered insight projector. Never a generic fallback. */
export class UnsupportedPatternInsightProjectorError extends Error {
  constructor(detectorRuleId: string, detectorRuleVersion: string) {
    super(`No insight projector is registered for detector rule "${detectorRuleId}@${detectorRuleVersion}".`);
    this.name = "UnsupportedPatternInsightProjectorError";
  }
}
