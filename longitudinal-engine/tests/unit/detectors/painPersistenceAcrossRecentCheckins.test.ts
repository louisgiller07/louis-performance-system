import { beforeEach, describe, expect, it } from "vitest";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import type { AthleteTimeline } from "../../../src/timeline/types.js";
import { formatUtcMs, MS_PER_DAY, parseCanonicalDateUtc } from "../../../src/timeline/range.js";
import {
  detectPainPersistenceAcrossRecentCheckins,
  PAIN_PERSISTENCE_RULE_ID,
  PAIN_PERSISTENCE_RULE_VERSION,
  InconsistentPainStateError,
  CheckinNotFoundInTimelineError,
  InsufficientTimelineCoverageError,
  DuplicateCheckinDateError,
} from "../../../src/detectors/index.js";
import type { PainPersistenceEvidence, PainPersistenceNoEvidence } from "../../../src/detectors/index.js";
import { ATHLETE_A, checkin, emptySources, resetIdSequence } from "../timeline/fixtures.js";
import type { DailyCheckinSource } from "../../../src/types/sources.js";

beforeEach(() => resetIdSequence());

const CANDIDATE_DATE = "2026-06-15";
const RANGE = { fromDate: "2025-12-01", toDate: "2026-07-15" };

function offsetDate(days: number): string {
  return formatUtcMs(parseCanonicalDateUtc(CANDIDATE_DATE, "x") + days * MS_PER_DAY);
}

function buildScenarioTimeline(checkins: DailyCheckinSource[], range = RANGE): AthleteTimeline {
  return buildTimeline({
    athleteId: ATHLETE_A,
    range,
    sources: { ...emptySources(), checkins },
  });
}

function painCheckin(overrides: Partial<DailyCheckinSource> = {}): DailyCheckinSource {
  return checkin({ pain: true, painIntensity: 5, painLocationCode: "knee_L", painNew: false, ...overrides });
}

function noPainCheckin(overrides: Partial<DailyCheckinSource> = {}): DailyCheckinSource {
  return checkin({ pain: false, painIntensity: null, painLocationCode: null, painNew: null, ...overrides });
}

function candidateCheckin(overrides: Partial<DailyCheckinSource> = {}): DailyCheckinSource {
  return painCheckin({ checkinDate: CANDIDATE_DATE, ...overrides });
}

function detect(timeline: AthleteTimeline, evaluationCheckinId: string) {
  return detectPainPersistenceAcrossRecentCheckins({ timeline, evaluationCheckinId });
}

describe("detectPainPersistenceAcrossRecentCheckins", () => {
  describe("identity", () => {
    it("frozen rule id/version", () => {
      expect(PAIN_PERSISTENCE_RULE_ID).toBe("pain_persistence_across_recent_checkins");
      expect(PAIN_PERSISTENCE_RULE_VERSION).toBe("1.0.0");
    });
  });

  describe("timeline coverage", () => {
    it("exact C-3 coverage is accepted", () => {
      const c = candidateCheckin();
      const p = painCheckin({ checkinDate: offsetDate(-3) });
      const timeline = buildScenarioTimeline([p, c], { fromDate: offsetDate(-3), toDate: CANDIDATE_DATE });
      expect(() => detect(timeline, c.id)).not.toThrow();
    });

    it("undercoverage on fromDate (only C-2 available) fails loud with InsufficientTimelineCoverageError, never no_evidence", () => {
      const c = candidateCheckin();
      const timeline = buildScenarioTimeline([c], { fromDate: offsetDate(-2), toDate: CANDIDATE_DATE });
      expect(() => detect(timeline, c.id)).toThrow(InsufficientTimelineCoverageError);
    });

    it("undercoverage on toDate fails loud (hand-malformed timeline, mirrors sleep-energy's own precedent)", () => {
      const c = candidateCheckin();
      const real = buildScenarioTimeline([c], { fromDate: offsetDate(-3), toDate: CANDIDATE_DATE });
      const malformed = { ...real, range: { ...real.range, toDate: offsetDate(-1) } };
      expect(() => detect(malformed, c.id)).toThrow(InsufficientTimelineCoverageError);
    });
  });

  describe("duplicate-date invariant", () => {
    it("duplicate candidate date fails loud", () => {
      const c1 = candidateCheckin();
      const c2 = checkin({ checkinDate: CANDIDATE_DATE, pain: false, painIntensity: null });
      const timeline = buildScenarioTimeline([c1, c2]);
      expect(() => detect(timeline, c1.id)).toThrow(DuplicateCheckinDateError);
    });

    it("duplicate date within the C-3..C-1 window fails loud", () => {
      const c = candidateCheckin();
      const p1 = painCheckin({ checkinDate: offsetDate(-1) });
      const p2 = painCheckin({ checkinDate: offsetDate(-1) });
      const timeline = buildScenarioTimeline([c, p1, p2]);
      expect(() => detect(timeline, c.id)).toThrow(DuplicateCheckinDateError);
    });
  });

  describe("checkin not found", () => {
    it("throws CheckinNotFoundInTimelineError for an unknown id", () => {
      const timeline = buildScenarioTimeline([candidateCheckin()]);
      expect(() => detect(timeline, "does-not-exist")).toThrow(CheckinNotFoundInTimelineError);
    });
  });

  describe("previous-checkin selection ordering", () => {
    it("prefers C-1 over C-2 and C-3 when all three are present", () => {
      const c = candidateCheckin();
      const p1 = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "hip_L" });
      const p2 = painCheckin({ checkinDate: offsetDate(-2), painLocationCode: "hip_R" });
      const p3 = painCheckin({ checkinDate: offsetDate(-3), painLocationCode: "neck" });
      const timeline = buildScenarioTimeline([c, p1, p2, p3]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.observedValue.previousCheckinId).toBe(p1.id);
      expect(result.observedValue.gapDays).toBe(1);
    });

    it("falls back to C-2 when C-1 is absent", () => {
      const c = candidateCheckin();
      const p2 = painCheckin({ checkinDate: offsetDate(-2) });
      const timeline = buildScenarioTimeline([c, p2]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.observedValue.previousCheckinId).toBe(p2.id);
      expect(result.observedValue.gapDays).toBe(2);
    });

    it("falls back to C-3 when C-1 and C-2 are both absent", () => {
      const c = candidateCheckin();
      const p3 = painCheckin({ checkinDate: offsetDate(-3) });
      const timeline = buildScenarioTimeline([c, p3]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.observedValue.previousCheckinId).toBe(p3.id);
      expect(result.observedValue.gapDays).toBe(3);
    });

    it("never consumes a checkin older than C-3, even if present", () => {
      const c = candidateCheckin();
      const tooOld = painCheckin({ checkinDate: offsetDate(-4) });
      const timeline = buildScenarioTimeline([c, tooOld], { fromDate: offsetDate(-4), toDate: CANDIDATE_DATE });
      const result = detect(timeline, c.id) as PainPersistenceNoEvidence;
      expect(result.kind).toBe("no_evidence");
      expect(result.reason).toBe("no_recent_prior_checkin");
    });
  });

  describe("no prior anchor (B7 lock)", () => {
    it("no P at all -> no_evidence/no_recent_prior_checkin, null previous fields", () => {
      const c = candidateCheckin();
      const timeline = buildScenarioTimeline([c]);
      const result = detect(timeline, c.id) as PainPersistenceNoEvidence;
      expect(result.kind).toBe("no_evidence");
      expect(result.reason).toBe("no_recent_prior_checkin");
      expect(result.previousCheckinId).toBeNull();
      expect(result.previousCheckinDate).toBeNull();
    });

    it("P has no pain, C has no pain -> no_evidence/prior_checkin_has_no_pain", () => {
      const c = candidateCheckin({ pain: false, painIntensity: null, painLocationCode: null, painNew: null });
      const p = noPainCheckin({ checkinDate: offsetDate(-1) });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceNoEvidence;
      expect(result.reason).toBe("prior_checkin_has_no_pain");
      expect(result.previousCheckinId).toBe(p.id);
      expect(result.previousCheckinDate).toBe(p.checkinDate);
    });

    it("P has no pain, C HAS pain (new onset) -> STILL no_evidence/prior_checkin_has_no_pain — new onset is not contradiction", () => {
      const c = candidateCheckin();
      const p = noPainCheckin({ checkinDate: offsetDate(-1) });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceNoEvidence;
      expect(result.kind).toBe("no_evidence");
      expect(result.reason).toBe("prior_checkin_has_no_pain");
    });
  });

  describe("classification — supporting / resolved / neutral", () => {
    it("same location, painNew=false -> supporting/same_location_continuation, no ambiguity", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const c = candidateCheckin({ painLocationCode: "knee_L", painNew: false });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("supporting");
      expect(result.observedValue.transitionKind).toBe("same_location_continuation");
      expect(result.observedValue.ambiguityReasons).toEqual([]);
    });

    it("resolved: P had pain, C has none -> contradicting/resolved, no ambiguity", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1) });
      const c = candidateCheckin({ pain: false, painIntensity: null, painLocationCode: null, painNew: null });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("contradicting");
      expect(result.observedValue.transitionKind).toBe("resolved");
      expect(result.observedValue.ambiguityReasons).toEqual([]);
    });

    it("same location, painNew=true -> neutral/same_location_continuation/[current_marked_new]", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const c = candidateCheckin({ painLocationCode: "knee_L", painNew: true });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("neutral");
      expect(result.observedValue.transitionKind).toBe("same_location_continuation");
      expect(result.observedValue.ambiguityReasons).toEqual(["current_marked_new"]);
    });

    it("same location, painNew=null -> neutral/same_location_continuation/[current_pain_new_unknown]", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const c = candidateCheckin({ painLocationCode: "knee_L", painNew: null });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("neutral");
      expect(result.observedValue.transitionKind).toBe("same_location_continuation");
      expect(result.observedValue.ambiguityReasons).toEqual(["current_pain_new_unknown"]);
    });

    it("different location (both non-null, differing) -> neutral/different_location, never infers P resolved", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const c = candidateCheckin({ painLocationCode: "shoulder_R" });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("neutral");
      expect(result.observedValue.transitionKind).toBe("different_location");
      expect(result.observedValue.ambiguityReasons).toEqual([]);
    });

    it("location unknown: P location null, C location set -> neutral/location_unknown", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: null });
      const c = candidateCheckin({ painLocationCode: "knee_L" });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("neutral");
      expect(result.observedValue.transitionKind).toBe("location_unknown");
    });

    it("location unknown: P location set, C location null -> neutral/location_unknown", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const c = candidateCheckin({ painLocationCode: null });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("neutral");
      expect(result.observedValue.transitionKind).toBe("location_unknown");
    });

    it("location unknown: both null -> neutral/location_unknown", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: null });
      const c = candidateCheckin({ painLocationCode: null });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("neutral");
      expect(result.observedValue.transitionKind).toBe("location_unknown");
    });
  });

  describe("intensity — never classifying (B9 lock)", () => {
    it("rising intensity does not change eventType", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L", painIntensity: 2 });
      const c = candidateCheckin({ painLocationCode: "knee_L", painIntensity: 9, painNew: false });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("supporting");
      expect(result.observedValue.intensityDelta).toBe(7);
    });

    it("falling intensity does not change eventType", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L", painIntensity: 9 });
      const c = candidateCheckin({ painLocationCode: "knee_L", painIntensity: 2, painNew: false });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.eventType).toBe("supporting");
      expect(result.observedValue.intensityDelta).toBe(-7);
    });

    it("unchanged intensity -> delta 0", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L", painIntensity: 5 });
      const c = candidateCheckin({ painLocationCode: "knee_L", painIntensity: 5, painNew: false });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.observedValue.intensityDelta).toBe(0);
    });

    it("resolved: evaluationPainIntensity and intensityDelta are both null", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painIntensity: 6 });
      const c = candidateCheckin({ pain: false, painIntensity: null, painLocationCode: null, painNew: null });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(result.observedValue.evaluationPainIntensity).toBeNull();
      expect(result.observedValue.intensityDelta).toBeNull();
      expect(result.observedValue.previousPainIntensity).toBe(6);
    });
  });

  describe("structural invariant — InconsistentPainStateError (B6 lock)", () => {
    it("candidate: pain=false with non-null intensity throws", () => {
      const bad = { ...candidateCheckin(), pain: false, painIntensity: 4 } as DailyCheckinSource;
      const timeline = buildScenarioTimeline([bad]);
      expect(() => detect(timeline, bad.id)).toThrow(InconsistentPainStateError);
    });

    it("candidate: pain=true with null intensity throws", () => {
      const bad = { ...candidateCheckin(), pain: true, painIntensity: null } as DailyCheckinSource;
      const timeline = buildScenarioTimeline([bad]);
      expect(() => detect(timeline, bad.id)).toThrow(InconsistentPainStateError);
    });

    it("candidate: pain=true with out-of-range intensity throws", () => {
      const bad = { ...candidateCheckin(), pain: true, painIntensity: 11 } as DailyCheckinSource;
      const timeline = buildScenarioTimeline([bad]);
      expect(() => detect(timeline, bad.id)).toThrow(InconsistentPainStateError);
    });

    it("previous checkin: pain=true with null intensity throws (P is validated too)", () => {
      const c = candidateCheckin();
      const badP = { ...painCheckin({ checkinDate: offsetDate(-1) }), painIntensity: null } as DailyCheckinSource;
      const timeline = buildScenarioTimeline([c, badP]);
      expect(() => detect(timeline, c.id)).toThrow(InconsistentPainStateError);
    });

    it("never normalizes pain=false + null intensity to 0 — a valid no-pain row is accepted as-is", () => {
      const c = candidateCheckin();
      const p = noPainCheckin({ checkinDate: offsetDate(-1) });
      const timeline = buildScenarioTimeline([c, p]);
      expect(() => detect(timeline, c.id)).not.toThrow();
    });
  });

  describe("non-consumption of safety/context fields", () => {
    it("painTraumatic/painFunctionLoss/painGettingWorse/suspectedConcussion/feverOrIllness never affect the result", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const cA = candidateCheckin({ painLocationCode: "knee_L", painNew: false, painTraumatic: false, painFunctionLoss: false, painGettingWorse: false, suspectedConcussion: false, feverOrIllness: false });
      const cB = { ...cA, painTraumatic: true, painFunctionLoss: true, painGettingWorse: true, suspectedConcussion: true, feverOrIllness: true };
      const timelineA = buildScenarioTimeline([cA, p]);
      const timelineB = buildScenarioTimeline([cB, p]);
      expect(detect(timelineA, cA.id)).toEqual(detect(timelineB, cB.id));
    });

    it("sleepHours/sleepQuality/energy/workStress/motivation/legFatigue/gripFatigue never affect the result", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const cA = candidateCheckin({ painLocationCode: "knee_L", painNew: false, sleepHours: 4, sleepQuality: 2, energy: 1, workStress: 9, motivation: 1, legFatigue: 9, gripFatigue: 9 });
      const cB = { ...cA, sleepHours: 9, sleepQuality: 9, energy: 9, workStress: 1, motivation: 9, legFatigue: 1, gripFatigue: 1 };
      const timelineA = buildScenarioTimeline([cA, p]);
      const timelineB = buildScenarioTimeline([cB, p]);
      expect(detect(timelineA, cA.id)).toEqual(detect(timelineB, cB.id));
    });
  });

  describe("observedValue exact shape (15 fields)", () => {
    it("exactly 15 fields, no more, no fewer", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const c = candidateCheckin({ painLocationCode: "knee_L", painNew: false });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(Object.keys(result.observedValue).sort()).toEqual(
        [
          "evaluationCheckinId",
          "evaluationCheckinDate",
          "previousCheckinId",
          "previousCheckinDate",
          "gapDays",
          "previousPain",
          "evaluationPain",
          "previousPainLocationCode",
          "evaluationPainLocationCode",
          "previousPainIntensity",
          "evaluationPainIntensity",
          "intensityDelta",
          "evaluationPainNew",
          "transitionKind",
          "ambiguityReasons",
        ].sort()
      );
    });
  });

  describe("sourceRefs — exactly 2 fields", () => {
    it("exactly evaluationCheckinId + previousCheckinId", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const c = candidateCheckin({ painLocationCode: "knee_L", painNew: false });
      const timeline = buildScenarioTimeline([c, p]);
      const result = detect(timeline, c.id) as PainPersistenceEvidence;
      expect(Object.keys(result.sourceRefs).sort()).toEqual(["evaluationCheckinId", "previousCheckinId"]);
      expect(result.sourceRefs.evaluationCheckinId).toBe(c.id);
      expect(result.sourceRefs.previousCheckinId).toBe(p.id);
    });
  });

  describe("NoEvidence exact shape (10 fields)", () => {
    it("no_recent_prior_checkin carries all 10 fields, null previous fields", () => {
      const c = candidateCheckin();
      const timeline = buildScenarioTimeline([c]);
      const result = detect(timeline, c.id) as PainPersistenceNoEvidence;
      expect(Object.keys(result).sort()).toEqual(
        ["kind", "detectorRuleId", "detectorRuleVersion", "evaluationKey", "evidenceKey", "eventDate", "evaluationCheckinId", "previousCheckinId", "previousCheckinDate", "reason"].sort()
      );
    });
  });

  describe("keys (B5 lock)", () => {
    it("evaluationKey === evidenceKey === checkin:<id>:pain-persistence, on Evidence AND NoEvidence", () => {
      const p = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const cEvidence = candidateCheckin({ painLocationCode: "knee_L", painNew: false });
      const timelineEvidence = buildScenarioTimeline([cEvidence, p]);
      const evidence = detect(timelineEvidence, cEvidence.id) as PainPersistenceEvidence;
      expect(evidence.evaluationKey).toBe(`checkin:${cEvidence.id}:pain-persistence`);
      expect(evidence.evidenceKey).toBe(`checkin:${cEvidence.id}:pain-persistence`);

      const cNoEvidence = candidateCheckin();
      const timelineNoEvidence = buildScenarioTimeline([cNoEvidence]);
      const noEvidence = detect(timelineNoEvidence, cNoEvidence.id) as PainPersistenceNoEvidence;
      expect(noEvidence.evaluationKey).toBe(`checkin:${cNoEvidence.id}:pain-persistence`);
      expect(noEvidence.evidenceKey).toBe(`checkin:${cNoEvidence.id}:pain-persistence`);
    });

    it("keys are stable across a source backfill that changes which checkin is P", () => {
      const c = candidateCheckin({ painLocationCode: "knee_L", painNew: false });
      const p3 = painCheckin({ checkinDate: offsetDate(-3), painLocationCode: "knee_L" });
      const before = detect(buildScenarioTimeline([c, p3]), c.id);

      const p1 = painCheckin({ id: "backfilled-p1", checkinDate: offsetDate(-1), painLocationCode: "knee_L" });
      const after = detect(buildScenarioTimeline([c, p3, p1]), c.id);

      expect(after.evaluationKey).toBe(before.evaluationKey);
      expect(after.evidenceKey).toBe(before.evidenceKey);
    });
  });

  describe("input-order invariance", () => {
    it("shuffling the checkins array does not change the result", () => {
      const p1 = painCheckin({ checkinDate: offsetDate(-1), painLocationCode: "hip_L" });
      const p2 = painCheckin({ checkinDate: offsetDate(-2), painLocationCode: "hip_R" });
      const c = candidateCheckin({ painLocationCode: "hip_L", painNew: false });
      const forward = buildScenarioTimeline([c, p1, p2]);
      const reversed = buildScenarioTimeline([p2, p1, c]);
      expect(detect(reversed, c.id)).toEqual(detect(forward, c.id));
    });
  });
});
