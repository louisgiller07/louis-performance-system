import { beforeEach, describe, expect, it } from "vitest";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import type { AthleteTimeline } from "../../../src/timeline/types.js";
import {
  resolveExecutionRelationship,
  resolveDecisionThreadById,
  resolveUniqueDay,
  DecisionNotFoundInTimelineError,
  DuplicateDecisionThreadError,
  InconsistentTimelineDayError,
  InconsistentExecutionLinkError,
  InconsistentExecutionDateError,
} from "../../../src/relations/index.js";
import { ATHLETE_A, checkin, completedSession, decision, emptySources, resetIdSequence } from "../timeline/fixtures.js";

beforeEach(() => resetIdSequence());

const RANGE = { fromDate: "2026-08-01", toDate: "2026-08-20" };
const DECISION_DATE = "2026-08-10";

function buildScenarioTimeline(overrides: {
  readonly decisions?: ReturnType<typeof decision>[];
  readonly completedSessions?: ReturnType<typeof completedSession>[];
}): AthleteTimeline {
  return buildTimeline({
    athleteId: ATHLETE_A,
    range: RANGE,
    sources: {
      ...emptySources(),
      decisions: overrides.decisions ?? [],
      completedSessions: overrides.completedSessions ?? [],
    },
  });
}

function baseDecision(overrides: Parameters<typeof decision>[0] = {}) {
  return decision({ decisionDate: DECISION_DATE, ...overrides });
}

describe("resolveExecutionRelationship", () => {
  it("resolves the canonical decision thread by value, never reference identity", () => {
    const d = baseDecision();
    const timeline = buildScenarioTimeline({ decisions: [d] });
    const result = resolveExecutionRelationship({ timeline, decisionId: `${d.id}`.slice(0) });
    expect(result.signal).toEqual({ state: "no_completed_session" });
  });

  it("throws DecisionNotFoundInTimelineError for an unknown decisionId", () => {
    const timeline = buildScenarioTimeline({ decisions: [baseDecision()] });
    expect(() => resolveExecutionRelationship({ timeline, decisionId: "nonexistent" })).toThrow(DecisionNotFoundInTimelineError);
  });

  it("throws DuplicateDecisionThreadError when the same decision id appears twice", () => {
    const d = baseDecision();
    const timeline = buildScenarioTimeline({ decisions: [d, { ...d }] });
    expect(() => resolveExecutionRelationship({ timeline, decisionId: d.id })).toThrow(DuplicateDecisionThreadError);
  });

  describe("four canonical states", () => {
    it("explicit — full raw ExecutionSignal fields and the raw CompletedSessionOnDay returned as sameDaySession", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: d.id, actualDurationMin: 45, rpe: 6 });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = resolveExecutionRelationship({ timeline, decisionId: d.id });
      expect(result.signal).toEqual({
        state: "explicit",
        completedSessionId: s.id,
        sessionType: s.sessionType,
        completionStatus: s.completionStatus,
        actualDurationMin: 45,
        rpe: 6,
        sessionLoad: s.sessionLoad,
        postLegFatigue: s.postLegFatigue,
        postGripFatigue: s.postGripFatigue,
        newPain: s.newPain,
      });
      expect(result.sameDaySession).not.toBeNull();
      expect(result.sameDaySession?.completedSession.id).toBe(s.id);
      // The raw M5_002B shape, not an M5_004-specific snapshot — carries linkedDecision, not linkedDecisionId.
      expect(result.sameDaySession).toHaveProperty("linkedDecision");
      expect(result.sameDaySession).not.toHaveProperty("linkedDecisionId");
    });

    it("no_completed_session", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = resolveExecutionRelationship({ timeline, decisionId: d.id });
      expect(result.signal).toEqual({ state: "no_completed_session" });
      expect(result.sameDaySession).toBeNull();
    });

    it("same_day_session_unlinked", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: null });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = resolveExecutionRelationship({ timeline, decisionId: d.id });
      expect(result.signal).toEqual({ state: "same_day_session_unlinked" });
      expect(result.sameDaySession?.completedSession.id).toBe(s.id);
    });

    it("same_day_session_linked_elsewhere", () => {
      const d1 = baseDecision();
      const d2 = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: d2.id });
      const timeline = buildScenarioTimeline({ decisions: [d1, d2], completedSessions: [s] });
      const result = resolveExecutionRelationship({ timeline, decisionId: d1.id });
      expect(result.signal).toEqual({ state: "same_day_session_linked_elsewhere" });
      expect(result.sameDaySession?.completedSession.id).toBe(s.id);
    });
  });

  describe("cardinality and consistency guards", () => {
    it(">1 same-day completed sessions -> InconsistentExecutionLinkError", () => {
      const d = baseDecision();
      const s1 = completedSession({ sessionDate: DECISION_DATE, decisionId: null });
      const s2 = completedSession({ sessionDate: DECISION_DATE, decisionId: null });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s1, s2] });
      expect(() => resolveExecutionRelationship({ timeline, decisionId: d.id })).toThrow(InconsistentExecutionLinkError);
    });

    it(">1 reverse-linked completed sessions -> InconsistentExecutionLinkError", () => {
      const d = baseDecision();
      const s1 = completedSession({ sessionDate: DECISION_DATE, decisionId: d.id });
      const s2 = completedSession({ sessionDate: "2026-08-05", decisionId: d.id });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s1, s2] });
      expect(() => resolveExecutionRelationship({ timeline, decisionId: d.id })).toThrow(InconsistentExecutionLinkError);
    });

    it("explicit link with a sessionDate different from decisionDate -> InconsistentExecutionDateError", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: "2026-08-11", decisionId: d.id });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      expect(() => resolveExecutionRelationship({ timeline, decisionId: d.id })).toThrow(InconsistentExecutionDateError);
    });

    it("bidirectional mismatch (hand-malformed timeline) -> InconsistentExecutionLinkError", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: d.id });
      const real = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const malformed: AthleteTimeline = {
        ...real,
        decisionThreads: real.decisionThreads.map((t) => (t.decision.id === d.id ? { ...t, linkedCompletedSessions: [] } : t)),
      };
      expect(() => resolveExecutionRelationship({ timeline: malformed, decisionId: d.id })).toThrow(InconsistentExecutionLinkError);
    });
  });
});

describe("resolveDecisionThreadById (shared primitive)", () => {
  it("resolves by value equality only", () => {
    const d = baseDecision();
    const timeline = buildScenarioTimeline({ decisions: [d] });
    const thread = resolveDecisionThreadById(timeline, `${d.id}`.slice(0));
    expect(thread.decision.id).toBe(d.id);
  });

  it("throws DecisionNotFoundInTimelineError / DuplicateDecisionThreadError consistently with resolveExecutionRelationship", () => {
    const d = baseDecision();
    const timeline = buildScenarioTimeline({ decisions: [d, { ...d }] });
    expect(() => resolveDecisionThreadById(timeline, d.id)).toThrow(DuplicateDecisionThreadError);
    expect(() => resolveDecisionThreadById(timeline, "nope")).toThrow(DecisionNotFoundInTimelineError);
  });
});

describe("resolveUniqueDay (shared primitive)", () => {
  it("resolves exactly one AthleteDay for an in-range date", () => {
    const timeline = buildScenarioTimeline({ decisions: [] });
    const day = resolveUniqueDay(timeline, DECISION_DATE);
    expect(day.date).toBe(DECISION_DATE);
  });

  it("throws InconsistentTimelineDayError for a hand-malformed timeline missing the day", () => {
    const timeline = buildScenarioTimeline({ decisions: [] });
    const malformed: AthleteTimeline = { ...timeline, days: timeline.days.filter((day) => day.date !== DECISION_DATE) };
    expect(() => resolveUniqueDay(malformed, DECISION_DATE)).toThrow(InconsistentTimelineDayError);
  });
});
