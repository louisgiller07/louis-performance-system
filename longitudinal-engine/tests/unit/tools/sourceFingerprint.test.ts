import { describe, expect, it } from "vitest";
import { computeSourceFingerprint } from "../../../tools/sourceFingerprint.js";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import { ATHLETE_A, checkin, decision, decisionOutcome, emptySources, resetIdSequence } from "../timeline/fixtures.js";

function timelineFixture() {
  resetIdSequence();
  const d = decision({ decisionDate: "2026-08-10" });
  const c = checkin({ checkinDate: "2026-08-10" });
  return buildTimeline({
    athleteId: ATHLETE_A,
    range: { fromDate: "2026-08-01", toDate: "2026-08-10" },
    sources: { ...emptySources(), decisions: [d], checkins: [c] },
  });
}

describe("computeSourceFingerprint", () => {
  it("returns a stable sha256:<hex> string", () => {
    const timeline = timelineFixture();
    const fp = computeSourceFingerprint("2026-08-10", timeline);
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic — identical inputs produce an identical fingerprint", () => {
    const t1 = timelineFixture();
    const t2 = timelineFixture();
    expect(computeSourceFingerprint("2026-08-10", t1)).toBe(computeSourceFingerprint("2026-08-10", t2));
  });

  it("changes when processingDate changes, even with the same timeline content", () => {
    const timeline = timelineFixture();
    const fp1 = computeSourceFingerprint("2026-08-10", timeline);
    const fp2 = computeSourceFingerprint("2026-08-11", timeline);
    expect(fp1).not.toBe(fp2);
  });

  it("changes when a relevant source field value changes (e.g. checkin data)", () => {
    resetIdSequence();
    const d = decision({ decisionDate: "2026-08-10" });
    const c1 = checkin({ checkinDate: "2026-08-10", sleepQuality: 8 });
    const timelineA = buildTimeline({ athleteId: ATHLETE_A, range: { fromDate: "2026-08-01", toDate: "2026-08-10" }, sources: { ...emptySources(), decisions: [d], checkins: [c1] } });

    resetIdSequence();
    const d2 = decision({ decisionDate: "2026-08-10" });
    const c2 = checkin({ checkinDate: "2026-08-10", sleepQuality: 3 });
    const timelineB = buildTimeline({ athleteId: ATHLETE_A, range: { fromDate: "2026-08-01", toDate: "2026-08-10" }, sources: { ...emptySources(), decisions: [d2], checkins: [c2] } });

    expect(computeSourceFingerprint("2026-08-10", timelineA)).not.toBe(computeSourceFingerprint("2026-08-10", timelineB));
  });

  it("does not include athleteId in what changes the fingerprint's sensitivity in an unsafe way, but the digest itself never reveals raw content", () => {
    const timeline = timelineFixture();
    const fp = computeSourceFingerprint("2026-08-10", timeline);
    // The digest is a fixed-length hex string — structurally incapable of echoing back any raw field value.
    expect(fp.replace("sha256:", "")).toHaveLength(64);
  });

  it("V0.3_001B idempotency audit — changes when an existing decision_outcomes row appears in the source pool (via decisionThreads[].outcomesByHorizon), proving a fresh post-backfill preview will naturally report a different fingerprint than the pre-backfill approval", () => {
    resetIdSequence();
    const d = decision({ id: "d1", decisionDate: "2026-08-10" });
    const timelineWithoutOutcome = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-08-01", toDate: "2026-08-10" },
      sources: { ...emptySources(), decisions: [d] },
    });

    resetIdSequence();
    const d2 = decision({ id: "d1", decisionDate: "2026-08-10" });
    const outcome = decisionOutcome({ decisionId: "d1", horizon: "J_PLUS_1" });
    const timelineWithOutcome = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2026-08-01", toDate: "2026-08-10" },
      sources: { ...emptySources(), decisions: [d2], outcomes: [outcome] },
    });

    expect(computeSourceFingerprint("2026-08-10", timelineWithoutOutcome)).not.toBe(computeSourceFingerprint("2026-08-10", timelineWithOutcome));
  });
});
