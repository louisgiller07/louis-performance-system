import { beforeEach, describe, expect, it } from "vitest";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import { InvalidDateRangeError } from "../../../src/timeline/range.js";
import { TimelineAthleteMismatchError } from "../../../src/timeline/athleteScoping.js";
import { OrphanedDecisionOutcomeError } from "../../../src/timeline/decisionThread.js";
import { TIMELINE_BUILDER_VERSION } from "../../../src/timeline/constants.js";
import {
  ATHLETE_A,
  ATHLETE_B,
  checkin,
  completedSession,
  decision,
  decisionOutcome,
  emptySources,
  healthFlag,
  resetIdSequence,
} from "./fixtures.js";

beforeEach(() => resetIdSequence());

const RANGE = { fromDate: "2026-08-10", toDate: "2026-08-15" };

describe("buildTimeline", () => {
  it("materializes every calendar day in the range, even with fully empty sources", () => {
    const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources: emptySources() });
    expect(timeline.days.map((d) => d.date)).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
    expect(timeline.decisionThreads).toEqual([]);
    expect(timeline.healthFlagThreads).toEqual([]);
  });

  it("propagates InvalidDateRangeError for a reversed range at the buildTimeline boundary", () => {
    expect(() =>
      buildTimeline({
        athleteId: ATHLETE_A,
        range: { fromDate: "2026-08-15", toDate: "2026-08-10" },
        sources: emptySources(),
      })
    ).toThrow(InvalidDateRangeError);
  });

  it("propagates InvalidDateRangeError for an impossible calendar date", () => {
    expect(() =>
      buildTimeline({
        athleteId: ATHLETE_A,
        range: { fromDate: "2026-02-30", toDate: "2026-03-01" },
        sources: emptySources(),
      })
    ).toThrow(InvalidDateRangeError);
  });

  describe("athlete scoping", () => {
    it("succeeds when every row belongs to the declared athlete", () => {
      const sources = { ...emptySources(), checkins: [checkin({ athleteId: ATHLETE_A, checkinDate: "2026-08-10" })] };
      expect(() => buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources })).not.toThrow();
    });

    it("throws TimelineAthleteMismatchError when a row belongs to a different athlete", () => {
      const sources = { ...emptySources(), checkins: [checkin({ athleteId: ATHLETE_B, checkinDate: "2026-08-10" })] };
      expect(() => buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources })).toThrow(TimelineAthleteMismatchError);
    });

    it("rejects a mixed-athlete decisions array even if only one row is wrong", () => {
      const sources = {
        ...emptySources(),
        decisions: [decision({ athleteId: ATHLETE_A }), decision({ athleteId: ATHLETE_B })],
      };
      expect(() => buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources })).toThrow(TimelineAthleteMismatchError);
    });
  });

  describe("primary range exclusion vs. health lifecycle overlap exception", () => {
    it("excludes a checkin/decision/session outside the requested range from the days array", () => {
      const outsideCheckin = checkin({ checkinDate: "2026-08-01" });
      const outsideDecision = decision({ decisionDate: "2026-08-01" });
      const outsideSession = completedSession({ sessionDate: "2026-08-01" });
      const sources = {
        ...emptySources(),
        checkins: [outsideCheckin],
        decisions: [outsideDecision],
        completedSessions: [outsideSession],
      };
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      // No day in the materialized range carries these out-of-range facts.
      for (const day of timeline.days) {
        expect(day.checkins).toEqual([]);
        expect(day.decisions).toEqual([]);
        expect(day.completedSessions).toEqual([]);
      }
    });

    it("an out-of-range decision gets no DecisionThread, even though it still counts in provenance.sourceCounts", () => {
      const outsideDecision = decision({ id: "d-outside", decisionDate: "2026-08-01" });
      const sources = { ...emptySources(), decisions: [outsideDecision] };
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      expect(timeline.decisionThreads).toEqual([]);
      expect(timeline.provenance.sourceCounts.decisions).toBe(1);
    });

    it("a health flag opened before the range still appears as activeHealthContext on in-range days — the documented exception", () => {
      const flag = healthFlag({ flagDate: "2026-08-01", resolvedAt: null });
      const sources = { ...emptySources(), healthFlags: [flag] };
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      for (const day of timeline.days) {
        expect(day.activeHealthContext).toEqual([flag]);
        expect(day.healthEventsCreated).toEqual([]);
      }
    });
  });

  describe("range-scoped relationship resolution", () => {
    it("an in-range completed session pointing at an out-of-range decision resolves as absent/source_missing_in_pool", () => {
      const outOfRangeDecision = decision({ id: "d-outside", decisionDate: "2026-08-01" });
      const inRangeSession = completedSession({ id: "s1", sessionDate: "2026-08-12", decisionId: "d-outside" });
      const sources = { ...emptySources(), decisions: [outOfRangeDecision], completedSessions: [inRangeSession] };
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      const day = timeline.days.find((d) => d.date === "2026-08-12");
      expect(day?.completedSessions[0]?.linkedDecision).toEqual({ kind: "absent", reason: "source_missing_in_pool" });
    });

    it("an in-range decision pointing at an out-of-range source checkin resolves as absent/source_missing_in_pool", () => {
      const outOfRangeCheckin = checkin({ id: "c-outside", checkinDate: "2026-08-01" });
      const inRangeDecision = decision({ id: "d1", decisionDate: "2026-08-12", sourceCheckinId: "c-outside" });
      const sources = { ...emptySources(), checkins: [outOfRangeCheckin], decisions: [inRangeDecision] };
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      expect(timeline.decisionThreads[0]?.linkedSourceCheckin).toEqual({ kind: "absent", reason: "source_missing_in_pool" });
    });

    it("an out-of-range completed session pointing at an in-range decision never appears in linkedCompletedSessions", () => {
      const inRangeDecision = decision({ id: "d1", decisionDate: "2026-08-12" });
      const outOfRangeSession = completedSession({ id: "s-outside", sessionDate: "2026-08-01", decisionId: "d1" });
      const sources = { ...emptySources(), decisions: [inRangeDecision], completedSessions: [outOfRangeSession] };
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      expect(timeline.decisionThreads[0]?.linkedCompletedSessions).toEqual([]);
    });

    it("an outcome referencing a decision whose decisionDate is outside range fails loud, even though that decision is present in raw sources.decisions", () => {
      const outOfRangeDecision = decision({ id: "d-outside", decisionDate: "2026-08-01" });
      const outcome = decisionOutcome({ id: "o1", decisionId: "d-outside" });
      const sources = { ...emptySources(), decisions: [outOfRangeDecision], outcomes: [outcome] };
      expect(() => buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources })).toThrow(OrphanedDecisionOutcomeError);
    });

    it("an in-range decision with a valid outcome buckets it normally", () => {
      const inRangeDecision = decision({ id: "d1", decisionDate: "2026-08-12" });
      const outcome = decisionOutcome({ id: "o1", decisionId: "d1", horizon: "J_PLUS_1" });
      const sources = { ...emptySources(), decisions: [inRangeDecision], outcomes: [outcome] };
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      expect(timeline.decisionThreads[0]?.outcomesByHorizon.J_PLUS_1).toEqual([outcome]);
    });
  });

  it("propagates OrphanedDecisionOutcomeError for an outcome with no matching decision at all", () => {
    const orphan = decisionOutcome({ decisionId: "does-not-exist" });
    const sources = { ...emptySources(), outcomes: [orphan] };
    expect(() => buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources })).toThrow(OrphanedDecisionOutcomeError);
  });

  describe("determinism", () => {
    function scenarioSources() {
      const c1 = checkin({ id: "c1", checkinDate: "2026-08-10", submittedAt: "2026-08-10T07:00:00.000Z" });
      const d1 = decision({ id: "d1", decisionDate: "2026-08-10", sourceCheckinId: "c1" });
      const d2 = decision({ id: "d2", decisionDate: "2026-08-12" });
      const s1 = completedSession({ id: "s1", sessionDate: "2026-08-12", decisionId: "d2" });
      const o1 = decisionOutcome({ id: "o1", decisionId: "d1", horizon: "J_PLUS_1" });
      const f1 = healthFlag({ id: "f1", flagDate: "2026-08-09", resolvedAt: null, sourceCheckinId: "c1" });
      return { checkins: [c1], decisions: [d1, d2], completedSessions: [s1], outcomes: [o1], healthFlags: [f1] };
    }

    it("shuffling every input array's order never changes the output", () => {
      const sources = scenarioSources();
      const forward = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });

      const shuffled = buildTimeline({
        athleteId: ATHLETE_A,
        range: RANGE,
        sources: {
          checkins: [...sources.checkins].reverse(),
          decisions: [...sources.decisions].reverse(),
          completedSessions: [...sources.completedSessions].reverse(),
          outcomes: [...sources.outcomes].reverse(),
          healthFlags: [...sources.healthFlags].reverse(),
        },
      });

      expect(shuffled).toEqual(forward);
    });

    it("building twice from the same input produces a deepEqual result", () => {
      const sources = scenarioSources();
      const first = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      const second = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });
      expect(first).toEqual(second);
    });
  });

  describe("provenance", () => {
    it("exposes builderVersion (not timelineBuilderVersion) equal to TIMELINE_BUILDER_VERSION", () => {
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources: emptySources() });
      expect(timeline.provenance.builderVersion).toBe(TIMELINE_BUILDER_VERSION);
      expect(timeline.provenance).not.toHaveProperty("timelineBuilderVersion");
    });

    it("counts sources, links, and reverse-session matches exactly", () => {
      const c1 = checkin({ id: "c1", checkinDate: "2026-08-10" });
      const d1 = decision({ id: "d1", decisionDate: "2026-08-10", sourceCheckinId: "c1" });
      const d2 = decision({ id: "d2", decisionDate: "2026-08-11", sourceCheckinId: null }); // fk_null
      const s1 = completedSession({ id: "s1", sessionDate: "2026-08-11", decisionId: "d2" });
      const s2 = completedSession({ id: "s2", sessionDate: "2026-08-11", decisionId: "d2" });
      const s3 = completedSession({ id: "s3", sessionDate: "2026-08-12", decisionId: null }); // fk_null
      const f1 = healthFlag({ id: "f1", flagDate: "2026-08-10", sourceCheckinId: "c1" });
      const f2 = healthFlag({ id: "f2", flagDate: "2026-08-11", sourceCheckinId: null }); // fk_null

      const sources = { checkins: [c1], decisions: [d1, d2], completedSessions: [s1, s2, s3], outcomes: [], healthFlags: [f1, f2] };
      const timeline = buildTimeline({ athleteId: ATHLETE_A, range: RANGE, sources });

      expect(timeline.provenance.rangeDaysMaterialized).toBe(6);
      expect(timeline.provenance.sourceCounts).toEqual({
        checkins: 1,
        decisions: 2,
        completedSessions: 3,
        outcomes: 0,
        healthFlags: 2,
      });

      // Link<T> sites: d1.linkedSourceCheckin (explicit), d2.linkedSourceCheckin (fk_null),
      // s1/s2/s3.linkedDecision (2 explicit + 1 fk_null), f1/f2.linkedSourceCheckin (1 explicit + 1 fk_null).
      // explicit: d1 + s1 + s2 + f1 = 4. absent: d2 + s3 + f2 = 3.
      expect(timeline.provenance.linkCounts).toEqual({ explicit: 4, absent: 3 });

      // Reverse decision->sessions match, counted separately: d2 has 2 linked sessions, d1 has 0.
      expect(timeline.provenance.linkedCompletedSessionsMatched).toBe(2);
    });
  });
});
