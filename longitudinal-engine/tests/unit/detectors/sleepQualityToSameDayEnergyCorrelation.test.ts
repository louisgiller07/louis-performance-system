import { beforeEach, describe, expect, it } from "vitest";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import type { AthleteTimeline } from "../../../src/timeline/types.js";
import { formatUtcMs, MS_PER_DAY, parseCanonicalDateUtc } from "../../../src/timeline/range.js";
import {
  detectSleepQualityToSameDayEnergyCorrelation,
  SLEEP_ENERGY_RULE_ID,
  SLEEP_ENERGY_RULE_VERSION,
  SLEEP_ENERGY_RANKING_METHOD,
  CheckinNotFoundInTimelineError,
  InsufficientTimelineCoverageError,
  DuplicateCheckinDateError,
} from "../../../src/detectors/index.js";
import type { SleepEnergyBucket, SleepEnergyEvidence, SleepEnergyNoEvidence } from "../../../src/detectors/index.js";
import { ATHLETE_A, checkin, emptySources, resetIdSequence } from "../timeline/fixtures.js";
import type { DailyCheckinSource } from "../../../src/types/sources.js";

beforeEach(() => resetIdSequence());

const CANDIDATE_DATE = "2026-06-15";
const RANGE = { fromDate: "2025-12-01", toDate: "2026-07-15" }; // wide enough to cover [C-60, C] with margin

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

/**
 * 55 baseline rows over the 60-day window ([C-60..C-6], leaving [C-5..C-1]
 * empty — "absent" days, never an error): 5 rows per rating 0..10 on both
 * sleepQuality and energy (same value on both fields per row). N=55,
 * min=21 satisfied, 11 distinct values satisfied. Empirical-midrank
 * percentiles for each candidate rating v: (5v + 2.5) / 55 — deterministic,
 * spread across all 5 buckets: 0,1->Q1; 2,3->Q2; 4,5,6->Q3; 7,8->Q4; 9,10->Q5.
 */
function uniformBaselineCheckins(): DailyCheckinSource[] {
  const rows: DailyCheckinSource[] = [];
  let dayOffset = -60;
  for (let rating = 0; rating <= 10; rating++) {
    for (let i = 0; i < 5; i++) {
      rows.push(checkin({ checkinDate: offsetDate(dayOffset), sleepQuality: rating, energy: rating }));
      dayOffset++;
    }
  }
  return rows;
}

function candidateCheckin(overrides: Partial<DailyCheckinSource> = {}): DailyCheckinSource {
  return checkin({ checkinDate: CANDIDATE_DATE, sleepQuality: 7, energy: 7, ...overrides });
}

function detect(timeline: AthleteTimeline, evaluationCheckinId: string) {
  return detectSleepQualityToSameDayEnergyCorrelation({ timeline, evaluationCheckinId });
}

describe("detectSleepQualityToSameDayEnergyCorrelation", () => {
  describe("identity", () => {
    it("frozen rule id/version", () => {
      expect(SLEEP_ENERGY_RULE_ID).toBe("sleep_quality_to_same_day_energy_correlation");
      expect(SLEEP_ENERGY_RULE_VERSION).toBe("1.0.0");
      expect(SLEEP_ENERGY_RANKING_METHOD).toBe("empirical_midrank_v1");
    });
  });

  describe("same-day temporal semantics", () => {
    it("uses the candidate's OWN sleepQuality/energy — never a next-day or previous-day checkin", () => {
      const c = candidateCheckin({ sleepQuality: 9, energy: 9 });
      const nextDay = checkin({ checkinDate: offsetDate(1), sleepQuality: 0, energy: 0 });
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c, nextDay]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(result.observedValue.sleepQuality).toBe(9);
      expect(result.observedValue.energy).toBe(9);
      expect(result.eventDate).toBe(CANDIDATE_DATE);
    });

    it("changing the NEXT day's checkin does not affect the output at all", () => {
      const c = candidateCheckin();
      const baseline = uniformBaselineCheckins();
      const nextDayA = checkin({ checkinDate: offsetDate(1), sleepQuality: 0, energy: 0, feverOrIllness: false });
      const nextDayB = checkin({ id: nextDayA.id, checkinDate: offsetDate(1), sleepQuality: 10, energy: 10, feverOrIllness: true });
      const timelineA = buildScenarioTimeline([...baseline, c, nextDayA]);
      const timelineB = buildScenarioTimeline([...baseline, c, nextDayB]);
      expect(detect(timelineA, c.id)).toEqual(detect(timelineB, c.id));
    });
  });

  describe("timeline coverage", () => {
    it("exact 60-day coverage ([C-60, C]) is accepted", () => {
      const c = candidateCheckin();
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c], { fromDate: offsetDate(-60), toDate: CANDIDATE_DATE });
      expect(() => detect(timeline, c.id)).not.toThrow();
    });

    it("underloaded timeline (missing one day of required coverage) fails loud with InsufficientTimelineCoverageError, never no_evidence", () => {
      const c = candidateCheckin();
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c], { fromDate: offsetDate(-59), toDate: CANDIDATE_DATE });
      expect(() => detect(timeline, c.id)).toThrow(InsufficientTimelineCoverageError);
    });

    it("underloaded on the toDate side also fails loud", () => {
      // buildTimeline itself would silently drop a checkin dated outside `range` entirely (see
      // buildTimeline.ts's range-scoping doc) — so a real caller could never end up with C both
      // present in timeline.days AND range.toDate < C.checkinDate via a normal buildTimeline call.
      // This exercises the detector's own defensive check against a hand-malformed timeline (a
      // caller-side range/days inconsistency), same pattern as this package's other "malformed
      // timeline" tests (e.g. executionRelationship.test.ts).
      const c = candidateCheckin();
      const real = buildScenarioTimeline([...uniformBaselineCheckins(), c], { fromDate: offsetDate(-60), toDate: CANDIDATE_DATE });
      const malformed = { ...real, range: { ...real.range, toDate: offsetDate(-1) } };
      expect(() => detect(malformed, c.id)).toThrow(InsufficientTimelineCoverageError);
    });
  });

  describe("duplicate-date invariant", () => {
    it("duplicate candidate date (two checkins same day) fails loud", () => {
      const c1 = candidateCheckin();
      const c2 = checkin({ checkinDate: CANDIDATE_DATE, sleepQuality: 3, energy: 3 });
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c1, c2]);
      expect(() => detect(timeline, c1.id)).toThrow(DuplicateCheckinDateError);
    });

    it("duplicate baseline date fails loud", () => {
      const c = candidateCheckin();
      const dup = checkin({ checkinDate: offsetDate(-60), sleepQuality: 5, energy: 5 });
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c, dup]);
      expect(() => detect(timeline, c.id)).toThrow(DuplicateCheckinDateError);
    });
  });

  describe("checkin not found", () => {
    it("throws CheckinNotFoundInTimelineError for an unknown id", () => {
      const timeline = buildScenarioTimeline(uniformBaselineCheckins());
      expect(() => detect(timeline, "does-not-exist")).toThrow(CheckinNotFoundInTimelineError);
    });
  });

  describe("baseline density (B6)", () => {
    it("20 observations (below minimum 21) -> no_evidence/insufficient_baseline_data", () => {
      const c = candidateCheckin();
      const rows: DailyCheckinSource[] = [];
      for (let i = 0; i < 20; i++) {
        rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: i % 2 === 0 ? 5 : 6, energy: i % 2 === 0 ? 5 : 6 }));
      }
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyNoEvidence;
      expect(result.kind).toBe("no_evidence");
      expect(result.reason).toBe("insufficient_baseline_data");
    });

    it("exactly 21 observations (the minimum) is accepted", () => {
      const c = candidateCheckin();
      const rows: DailyCheckinSource[] = [];
      for (let i = 0; i < 21; i++) {
        rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: i % 2 === 0 ? 5 : 6, energy: i % 2 === 0 ? 5 : 6 }));
      }
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id);
      expect(result.kind).toBe("evidence");
    });

    it("independent sleep/energy counts — sleep has 21, energy has only 20 -> insufficient_baseline_data", () => {
      const c = candidateCheckin();
      const rows: DailyCheckinSource[] = [];
      for (let i = 0; i < 21; i++) {
        // energy null on the last row -> energy count = 20, sleep count = 21
        rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: i % 2 === 0 ? 5 : 6, energy: i === 20 ? null : i % 2 === 0 ? 5 : 6 }));
      }
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyNoEvidence;
      expect(result.reason).toBe("insufficient_baseline_data");
    });

    it("null baseline fields are excluded from BOTH counting and variance — a row with sleepQuality=null contributes 0 to the sleep distribution but can still contribute to energy", () => {
      const c = candidateCheckin();
      const rows: DailyCheckinSource[] = [];
      // 21 rows with energy set; only 20 also carry sleepQuality (1 has sleepQuality=null).
      for (let i = 0; i < 21; i++) {
        rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: i === 0 ? null : i % 2 === 0 ? 5 : 6, energy: i % 2 === 0 ? 5 : 6 }));
      }
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyNoEvidence;
      expect(result.reason).toBe("insufficient_baseline_data"); // sleep count drops to 20
    });
  });

  describe("baseline variance (B6)", () => {
    it("all-equal baseline (1 distinct value) -> no_evidence/baseline_variance_insufficient", () => {
      const c = candidateCheckin();
      const rows: DailyCheckinSource[] = [];
      for (let i = 0; i < 25; i++) {
        rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: 5, energy: 5 }));
      }
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyNoEvidence;
      expect(result.kind).toBe("no_evidence");
      expect(result.reason).toBe("baseline_variance_insufficient");
    });

    it("exactly 2 distinct values is accepted", () => {
      const c = candidateCheckin();
      const rows: DailyCheckinSource[] = [];
      for (let i = 0; i < 25; i++) {
        rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: i % 5 === 0 ? 6 : 5, energy: i % 5 === 0 ? 6 : 5 }));
      }
      const timeline = buildScenarioTimeline([...rows, c]);
      expect(detect(timeline, c.id).kind).toBe("evidence");
    });
  });

  describe("empirical midrank ranking (B7)", () => {
    it("locked regression example: baseline 15x7 + 6x8, candidate 7 -> Q2 (never Q4 under a collapsed R7 boundary)", () => {
      const c = candidateCheckin({ sleepQuality: 7, energy: 7 });
      const rows: DailyCheckinSource[] = [];
      let offset = -60;
      for (let i = 0; i < 15; i++) rows.push(checkin({ checkinDate: offsetDate(offset++), sleepQuality: 7, energy: 7 }));
      for (let i = 0; i < 6; i++) rows.push(checkin({ checkinDate: offsetDate(offset++), sleepQuality: 8, energy: 8 }));
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(result.observedValue.sleepPercentile).toBeCloseTo(7.5 / 21, 10);
      expect(result.observedValue.sleepBucket).toBe("Q2");
      expect(result.observedValue.energyBucket).toBe("Q2");
    });

    it("candidate strictly below every baseline value -> percentile exactly 0 -> Q1", () => {
      const c = candidateCheckin({ sleepQuality: 0, energy: 0 });
      const rows: DailyCheckinSource[] = [];
      for (let i = 0; i < 25; i++) {
        rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: i % 5 === 0 ? 8 : 5, energy: i % 5 === 0 ? 8 : 5 }));
      }
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(result.observedValue.sleepPercentile).toBe(0);
      expect(result.observedValue.sleepBucket).toBe("Q1");
    });

    it("candidate strictly above every baseline value -> percentile exactly 1 -> Q5", () => {
      const c = candidateCheckin({ sleepQuality: 10, energy: 10 });
      const rows: DailyCheckinSource[] = [];
      for (let i = 0; i < 25; i++) {
        rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: i % 5 === 0 ? 4 : 2, energy: i % 5 === 0 ? 4 : 2 }));
      }
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(result.observedValue.sleepPercentile).toBe(1);
      expect(result.observedValue.sleepBucket).toBe("Q5");
    });

    it("tie case: candidate exactly at baseline median with symmetric ties -> percentile 0.5 -> Q3", () => {
      const c = candidateCheckin({ sleepQuality: 5, energy: 5 });
      const rows: DailyCheckinSource[] = [];
      // 10 below (0-4 spread), 1 equal (5), 10 above (6-10 spread) style — use uniform baseline shape scaled down.
      for (let i = 0; i < 10; i++) rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: 2, energy: 2 }));
      rows.push(checkin({ checkinDate: offsetDate(-50), sleepQuality: 5, energy: 5 }));
      for (let i = 0; i < 10; i++) rows.push(checkin({ checkinDate: offsetDate(-49 + i), sleepQuality: 8, energy: 8 }));
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      // L=10, E=1, N=21 -> p = (10+0.5)/21 = 0.5
      expect(result.observedValue.sleepPercentile).toBeCloseTo(0.5, 10);
      expect(result.observedValue.sleepBucket).toBe("Q3");
    });
  });

  describe("classification — all 25 Q x Q cells (B8)", () => {
    // Representative candidate values per bucket, from the uniform baseline's own table.
    const byBucket: Record<SleepEnergyBucket, number> = { Q1: 0, Q2: 2, Q3: 4, Q4: 7, Q5: 9 };
    const buckets: readonly SleepEnergyBucket[] = ["Q1", "Q2", "Q3", "Q4", "Q5"];

    function expectedEventType(sleep: SleepEnergyBucket, energy: SleepEnergyBucket): "supporting" | "contradicting" | "neutral" {
      const cat = (b: SleepEnergyBucket) => (b === "Q1" || b === "Q2" ? "bottom" : b === "Q3" ? "middle" : "top");
      const sc = cat(sleep);
      const ec = cat(energy);
      if (sc === "middle" || ec === "middle") return "neutral";
      return sc === ec ? "supporting" : "contradicting";
    }

    for (const sleepBucket of buckets) {
      for (const energyBucket of buckets) {
        it(`sleep=${sleepBucket} x energy=${energyBucket} -> ${expectedEventType(sleepBucket, energyBucket)}`, () => {
          const c = candidateCheckin({ sleepQuality: byBucket[sleepBucket], energy: byBucket[energyBucket] });
          const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
          const result = detect(timeline, c.id) as SleepEnergyEvidence;
          expect(result.observedValue.sleepBucket).toBe(sleepBucket);
          expect(result.observedValue.energyBucket).toBe(energyBucket);
          expect(result.eventType).toBe(expectedEventType(sleepBucket, energyBucket));
        });
      }
    }
  });

  describe("confounders (B9)", () => {
    it("fever/illness forces eventType=neutral regardless of the underlying classification, and adds the reason", () => {
      const c = candidateCheckin({ sleepQuality: 0, energy: 0, feverOrIllness: true }); // would otherwise be bottom+bottom=supporting
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(result.eventType).toBe("neutral");
      expect(result.observedValue.confounderReasons).toEqual(["fever_or_illness"]);
    });

    it("suspected concussion forces eventType=neutral and adds the reason", () => {
      const c = candidateCheckin({ sleepQuality: 9, energy: 9, suspectedConcussion: true }); // would otherwise be top+top=supporting
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(result.eventType).toBe("neutral");
      expect(result.observedValue.confounderReasons).toEqual(["suspected_concussion"]);
    });

    it("both confounders present -> deterministic order [fever_or_illness, suspected_concussion]", () => {
      const c = candidateCheckin({ sleepQuality: 9, energy: 9, feverOrIllness: true, suspectedConcussion: true });
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(result.observedValue.confounderReasons).toEqual(["fever_or_illness", "suspected_concussion"]);
    });

    it("no confounders -> empty confounderReasons, real classification stands", () => {
      const c = candidateCheckin({ sleepQuality: 0, energy: 0 });
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(result.observedValue.confounderReasons).toEqual([]);
      expect(result.eventType).toBe("supporting");
    });

    it("missing/insufficient baseline data still yields NoEvidence even with a confounder present — confounders never override a no_evidence gate", () => {
      const c = candidateCheckin({ sleepQuality: 5, energy: 5, feverOrIllness: true });
      const rows: DailyCheckinSource[] = [];
      for (let i = 0; i < 10; i++) rows.push(checkin({ checkinDate: offsetDate(-60 + i), sleepQuality: 5, energy: 6 }));
      const timeline = buildScenarioTimeline([...rows, c]);
      const result = detect(timeline, c.id) as SleepEnergyNoEvidence;
      expect(result.kind).toBe("no_evidence");
      expect(result.reason).toBe("insufficient_baseline_data");
    });
  });

  describe("workStress non-consumption", () => {
    it("workStress is never read — identical results regardless of its value", () => {
      const rows = uniformBaselineCheckins();
      const cA = candidateCheckin({ workStress: 0 });
      const cB = checkin({ id: cA.id, checkinDate: CANDIDATE_DATE, sleepQuality: 7, energy: 7, workStress: 10 });
      const timelineA = buildScenarioTimeline([...rows, cA]);
      const timelineB = buildScenarioTimeline([...rows, cB]);
      expect(detect(timelineA, cA.id)).toEqual(detect(timelineB, cB.id));
    });
  });

  describe("observedValue exact shape (B10)", () => {
    it("exactly 18 fields, exact histogram/count/rankingMethod invariants", () => {
      const c = candidateCheckin();
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      const ov = result.observedValue;
      expect(Object.keys(ov).sort()).toEqual(
        [
          "evaluationCheckinId",
          "evaluationCheckinDate",
          "sleepQuality",
          "energy",
          "sleepPercentile",
          "energyPercentile",
          "sleepBucket",
          "energyBucket",
          "baselineWindowStartDate",
          "baselineWindowEndDate",
          "sleepBaselineObservationCount",
          "energyBaselineObservationCount",
          "sleepBaselineDistinctValueCount",
          "energyBaselineDistinctValueCount",
          "sleepBaselineHistogram",
          "energyBaselineHistogram",
          "rankingMethod",
          "confounderReasons",
        ].sort()
      );
      expect(ov.rankingMethod).toBe("empirical_midrank_v1");
      expect(ov.baselineWindowStartDate).toBe(offsetDate(-60));
      expect(ov.baselineWindowEndDate).toBe(offsetDate(-1));
      expect(ov.sleepBaselineHistogram.reduce((a, b) => a + b, 0)).toBe(ov.sleepBaselineObservationCount);
      expect(ov.energyBaselineHistogram.reduce((a, b) => a + b, 0)).toBe(ov.energyBaselineObservationCount);
      expect(ov.sleepBaselineHistogram.filter((n) => n > 0).length).toBe(ov.sleepBaselineDistinctValueCount);
      expect(ov.energyBaselineHistogram.filter((n) => n > 0).length).toBe(ov.energyBaselineDistinctValueCount);
      expect(ov.sleepBaselineHistogram).toHaveLength(11);
      expect(ov.energyBaselineHistogram).toHaveLength(11);
    });
  });

  describe("sourceRefs / provenance (B11)", () => {
    it("exactly evaluationCheckinId + baselineCheckinIds, distinct, sorted ascending, no duplicates", () => {
      const c = candidateCheckin();
      const baseline = uniformBaselineCheckins();
      const timeline = buildScenarioTimeline([...baseline, c]);
      const result = detect(timeline, c.id) as SleepEnergyEvidence;
      expect(Object.keys(result.sourceRefs).sort()).toEqual(["baselineCheckinIds", "evaluationCheckinId"]);
      expect(result.sourceRefs.evaluationCheckinId).toBe(c.id);
      const ids = result.sourceRefs.baselineCheckinIds;
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
      expect([...ids].sort()).toEqual([...ids]); // already ascending
      expect(ids).not.toContain(c.id);
      expect(ids).toHaveLength(baseline.length); // every baseline row contributed sleepQuality AND energy here
    });
  });

  describe("NoEvidence exact shape (B12)", () => {
    it("evaluation_checkin_missing_sleep_quality carries all 8 required fields including evidenceKey", () => {
      const c = candidateCheckin({ sleepQuality: null });
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
      const result = detect(timeline, c.id) as SleepEnergyNoEvidence;
      expect(Object.keys(result).sort()).toEqual(
        ["kind", "detectorRuleId", "detectorRuleVersion", "evaluationKey", "evidenceKey", "eventDate", "evaluationCheckinId", "reason"].sort()
      );
      expect(result.reason).toBe("evaluation_checkin_missing_sleep_quality");
      expect(result.evidenceKey).toBe(`checkin:${c.id}:sleep-energy`);
    });

    it("evaluation_checkin_missing_energy", () => {
      const c = candidateCheckin({ energy: null });
      const timeline = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
      const result = detect(timeline, c.id) as SleepEnergyNoEvidence;
      expect(result.reason).toBe("evaluation_checkin_missing_energy");
    });
  });

  describe("keys (B3)", () => {
    it("evaluationKey and evidenceKey are both checkin:<id>:sleep-energy, on both Evidence and NoEvidence", () => {
      const cEvidence = candidateCheckin();
      const timelineEvidence = buildScenarioTimeline([...uniformBaselineCheckins(), cEvidence]);
      const evidence = detect(timelineEvidence, cEvidence.id) as SleepEnergyEvidence;
      expect(evidence.evaluationKey).toBe(`checkin:${cEvidence.id}:sleep-energy`);
      expect(evidence.evidenceKey).toBe(`checkin:${cEvidence.id}:sleep-energy`);

      const cNoEvidence = candidateCheckin({ sleepQuality: null });
      const timelineNoEvidence = buildScenarioTimeline([...uniformBaselineCheckins(), cNoEvidence]);
      const noEvidence = detect(timelineNoEvidence, cNoEvidence.id) as SleepEnergyNoEvidence;
      expect(noEvidence.evaluationKey).toBe(`checkin:${cNoEvidence.id}:sleep-energy`);
      expect(noEvidence.evidenceKey).toBe(`checkin:${cNoEvidence.id}:sleep-energy`);
    });

    it("keys remain stable after editing non-key candidate fields (e.g. workStress)", () => {
      const c = candidateCheckin({ workStress: 3 });
      const timeline1 = buildScenarioTimeline([...uniformBaselineCheckins(), c]);
      const before = detect(timeline1, c.id);

      const cEdited = { ...c, workStress: 8 };
      const timeline2 = buildScenarioTimeline([...uniformBaselineCheckins(), cEdited]);
      const after = detect(timeline2, cEdited.id);

      expect(after.evaluationKey).toBe(before.evaluationKey);
      expect(after.evidenceKey).toBe(before.evidenceKey);
    });

    it("keys remain stable after a baseline backfill (a previously-empty day gains a checkin)", () => {
      const c = candidateCheckin();
      const partialBaseline = uniformBaselineCheckins().slice(0, 21);
      const timelineBefore = buildScenarioTimeline([...partialBaseline, c]);
      const before = detect(timelineBefore, c.id);

      const fullBaseline = uniformBaselineCheckins();
      const timelineAfter = buildScenarioTimeline([...fullBaseline, c]);
      const after = detect(timelineAfter, c.id);

      expect(after.evaluationKey).toBe(before.evaluationKey);
      expect(after.evidenceKey).toBe(before.evidenceKey);
    });
  });

  describe("input-order invariance", () => {
    it("shuffling the checkins array does not change the result", () => {
      const c = candidateCheckin();
      const baseline = uniformBaselineCheckins();
      const timelineForward = buildScenarioTimeline([...baseline, c]);
      const timelineReversed = buildScenarioTimeline([c, ...[...baseline].reverse()]);
      expect(detect(timelineReversed, c.id)).toEqual(detect(timelineForward, c.id));
    });
  });
});
