import { beforeEach, describe, expect, it } from "vitest";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import type { AthleteTimeline } from "../../../src/timeline/types.js";
import {
  calculateDecisionOutcomeSnapshot,
  targetDateForHorizon,
  DecisionNotFoundInTimelineError,
  DuplicateDecisionThreadError,
  InvalidHorizonError,
  InvalidObservedThroughDateError,
  HorizonNotMatureError,
  OutcomeTimelineCoverageError,
  InconsistentTimelineDayError,
  InconsistentTargetCheckinError,
  InconsistentBaselineCheckinError,
  InconsistentExecutionLinkError,
  InconsistentExecutionDateError,
} from "../../../src/calculators/index.js";
import {
  ATHLETE_A,
  checkin,
  completedSession,
  decision,
  emptySources,
  healthFlag,
  resetIdSequence,
} from "../timeline/fixtures.js";
import type { DecisionOutcomeHorizon } from "../../../src/types/sources.js";

beforeEach(() => resetIdSequence());

const RANGE = { fromDate: "2026-08-01", toDate: "2026-08-20" };
const DECISION_DATE = "2026-08-10";
const J1 = "2026-08-11";
const J3 = "2026-08-13";
const J7 = "2026-08-17";

function buildScenarioTimeline(overrides: {
  readonly checkins?: ReturnType<typeof checkin>[];
  readonly decisions?: ReturnType<typeof decision>[];
  readonly completedSessions?: ReturnType<typeof completedSession>[];
  readonly healthFlags?: ReturnType<typeof healthFlag>[];
  readonly range?: { fromDate: string; toDate: string };
}): AthleteTimeline {
  return buildTimeline({
    athleteId: ATHLETE_A,
    range: overrides.range ?? RANGE,
    sources: {
      ...emptySources(),
      checkins: overrides.checkins ?? [],
      decisions: overrides.decisions ?? [],
      completedSessions: overrides.completedSessions ?? [],
      healthFlags: overrides.healthFlags ?? [],
    },
  });
}

function baseDecision(overrides: Parameters<typeof decision>[0] = {}) {
  return decision({ decisionDate: DECISION_DATE, ...overrides });
}

describe("calculateDecisionOutcomeSnapshot", () => {
  describe("decisionId resolution", () => {
    it("throws DecisionNotFoundInTimelineError when no thread matches", () => {
      const timeline = buildScenarioTimeline({ decisions: [baseDecision()] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: "nonexistent", horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(DecisionNotFoundInTimelineError);
    });

    it("uses the single matching thread when exactly one exists", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.inputSnapshot.decisionId).toBe(d.id);
    });

    it("throws DuplicateDecisionThreadError when the same decision id appears twice in the source pool", () => {
      const d = baseDecision();
      // Deliberately malformed source: the same decision row supplied twice.
      const timeline = buildScenarioTimeline({ decisions: [d, { ...d }] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(DuplicateDecisionThreadError);
    });

    it("never resolves via array reference identity — matches by decision.id value only", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      // Passing the id as a freshly constructed string (not the same JS reference as d.id) still resolves.
      const freshId = `${d.id}`.slice(0);
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: freshId, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.inputSnapshot.decisionId).toBe(d.id);
    });
  });

  describe("horizon target-date calculation", () => {
    it.each([
      ["J_PLUS_1", "2026-08-11"],
      ["J_PLUS_3", "2026-08-13"],
      ["J_PLUS_7", "2026-08-17"],
    ] as const)("%s targets decisionDate + N calendar days", (horizon, expected) => {
      expect(targetDateForHorizon(DECISION_DATE, horizon)).toBe(expected);
    });

    it("throws InvalidHorizonError for an unrecognized horizon value", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({
          timeline,
          decisionId: d.id,
          horizon: "J_PLUS_99" as unknown as DecisionOutcomeHorizon,
          observedThroughDate: "2026-08-20",
        })
      ).toThrow(InvalidHorizonError);
    });
  });

  describe("observedThroughDate validation", () => {
    const d = baseDecision();

    it("rejects a malformed date string", () => {
      const timeline = buildScenarioTimeline({ decisions: [d] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: "not-a-date" })
      ).toThrow(InvalidObservedThroughDateError);
    });

    it("rejects an impossible calendar date", () => {
      const timeline = buildScenarioTimeline({ decisions: [d] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: "2026-02-30" })
      ).toThrow(InvalidObservedThroughDateError);
    });
  });

  describe("maturity", () => {
    it("throws HorizonNotMatureError the day before the target date", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: "2026-08-10" })
      ).toThrow(HorizonNotMatureError);
    });

    it("succeeds exactly on the target date", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.targetDate).toBe(J1);
    });

    it("succeeds well after the target date", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: "2026-08-20" });
      expect(result.outcomeSignals.targetDate).toBe(J1);
    });
  });

  describe("timeline coverage", () => {
    it("throws OutcomeTimelineCoverageError when targetDate is after the supplied range", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d], range: { fromDate: "2026-08-01", toDate: "2026-08-12" } });
      // observedThroughDate proves maturity but the timeline itself was never loaded that far — J+7 = 2026-08-17.
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_7", observedThroughDate: "2026-08-20" })
      ).toThrow(OutcomeTimelineCoverageError);
    });

    it("succeeds when targetDate is exactly the range's last covered day", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d], range: { fromDate: "2026-08-01", toDate: J1 } });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.targetDate).toBe(J1);
    });
  });

  describe("target AthleteDay structural guard", () => {
    it("uses the single materialized AthleteDay for targetDate", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.targetDate).toBe(J1);
    });

    it("throws InconsistentTimelineDayError when the supplied timeline has zero AthleteDay entries for a proven-in-range targetDate", () => {
      const d = baseDecision();
      const real = buildScenarioTimeline({ decisions: [d] });
      const malformed: AthleteTimeline = { ...real, days: real.days.filter((day) => day.date !== J1) };
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline: malformed, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentTimelineDayError);
    });

    it("throws InconsistentTimelineDayError when the supplied timeline has duplicate AthleteDay entries for targetDate", () => {
      const d = baseDecision();
      const real = buildScenarioTimeline({ decisions: [d] });
      const targetDay = real.days.find((day) => day.date === J1)!;
      const malformed: AthleteTimeline = { ...real, days: [...real.days, targetDay] };
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline: malformed, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentTimelineDayError);
    });
  });

  describe("target check-in cardinality", () => {
    it("0 check-ins on target date -> missing_observation across all response fields", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.response.energy).toEqual({ state: "missing_observation" });
      expect(result.inputSnapshot.targetCheckin).toBeNull();
    });

    it("1 check-in on target date -> consumed", () => {
      const d = baseDecision();
      const c = checkin({ checkinDate: J1, energy: 6 });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [c] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.response.energy).toEqual({ state: "observed", value: 6 });
      expect(result.inputSnapshot.targetCheckin?.id).toBe(c.id);
    });

    it(">1 check-ins on target date -> InconsistentTargetCheckinError", () => {
      const d = baseDecision();
      const c1 = checkin({ checkinDate: J1 });
      const c2 = checkin({ checkinDate: J1 });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [c1, c2] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentTargetCheckinError);
    });
  });

  describe("target response signals — raw fact fidelity", () => {
    it("distinguishes observed_null from missing_observation from an observed value", () => {
      const d = baseDecision();
      const c = checkin({ checkinDate: J1, energy: null, motivation: 8 });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [c] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.response.energy).toEqual({ state: "observed_null" });
      expect(result.outcomeSignals.response.motivation).toEqual({ state: "observed", value: 8 });
    });

    it("preserves a boolean false as observed false, never missing_observation", () => {
      const d = baseDecision();
      const c = checkin({ checkinDate: J1, pain: false, suspectedConcussion: false, feverOrIllness: false });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [c] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.response.pain).toEqual({ state: "observed", value: false });
      expect(result.outcomeSignals.response.suspectedConcussion).toEqual({ state: "observed", value: false });
      expect(result.outcomeSignals.response.illness).toEqual({ state: "observed", value: false });
    });

    it("preserves a numeric zero as observed 0, never missing_observation", () => {
      const d = baseDecision();
      const c = checkin({ checkinDate: J1, legFatigue: 0, sleepWakeUps: 0 });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [c] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.response.legFatigue).toEqual({ state: "observed", value: 0 });
      expect(result.outcomeSignals.response.sleepWakeUps).toEqual({ state: "observed", value: 0 });
    });

    it("includes sleep fields as raw descriptive facts, no score", () => {
      const d = baseDecision();
      const c = checkin({ checkinDate: J1, sleepHours: 7.5, sleepQuality: 6, sleepWakeUps: 1 });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [c] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.response.sleepHours).toEqual({ state: "observed", value: 7.5 });
      expect(result.outcomeSignals.response.sleepQuality).toEqual({ state: "observed", value: 6 });
      expect(result.outcomeSignals.response.sleepWakeUps).toEqual({ state: "observed", value: 1 });
      expect("sleepScore" in result.outcomeSignals.response).toBe(false);
      expect("readinessScore" in result.outcomeSignals).toBe(false);
    });

    it("sleep fields report missing_observation with no target check-in, and no sleep delta exists", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.response.sleepHours).toEqual({ state: "missing_observation" });
      expect(Object.keys(result.outcomeSignals.delta)).toEqual([
        "energyDelta",
        "legFatigueDelta",
        "gripFatigueDelta",
        "painIntensityDelta",
      ]);
    });
  });

  describe("baseline", () => {
    it("absent (sourceCheckinId null) -> deltas unavailable/baseline_missing, sourceCheckin null", () => {
      const d = baseDecision({ sourceCheckinId: null });
      const c = checkin({ checkinDate: J1, energy: 6 });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [c] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.delta.energyDelta).toEqual({ state: "unavailable", reason: "baseline_missing" });
      expect(result.inputSnapshot.sourceCheckin).toBeNull();
    });

    it("explicit, valid same-date baseline -> consumed, delta computed", () => {
      const baseline = checkin({ checkinDate: DECISION_DATE, energy: 5 });
      const d = baseDecision({ sourceCheckinId: baseline.id });
      const target = checkin({ checkinDate: J1, energy: 8 });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [baseline, target] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.inputSnapshot.sourceCheckin?.id).toBe(baseline.id);
      expect(result.outcomeSignals.delta.energyDelta).toEqual({ state: "computed", value: 3 });
    });

    it("explicit baseline field null -> delta unavailable/baseline_field_null", () => {
      const baseline = checkin({ checkinDate: DECISION_DATE, energy: null });
      const d = baseDecision({ sourceCheckinId: baseline.id });
      const target = checkin({ checkinDate: J1, energy: 8 });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [baseline, target] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.delta.energyDelta).toEqual({ state: "unavailable", reason: "baseline_field_null" });
    });

    it("baseline present, target missing -> delta unavailable/target_missing", () => {
      const baseline = checkin({ checkinDate: DECISION_DATE, energy: 5 });
      const d = baseDecision({ sourceCheckinId: baseline.id });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [baseline] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.delta.energyDelta).toEqual({ state: "unavailable", reason: "target_missing" });
    });

    it("baseline present, target field null -> delta unavailable/target_field_null", () => {
      const baseline = checkin({ checkinDate: DECISION_DATE, energy: 5 });
      const d = baseDecision({ sourceCheckinId: baseline.id });
      const target = checkin({ checkinDate: J1, energy: null });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [baseline, target] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.delta.energyDelta).toEqual({ state: "unavailable", reason: "target_field_null" });
    });

    it("explicit baseline link with a checkinDate other than decisionDate fails loud (InconsistentBaselineCheckinError)", () => {
      const wrongDateCheckin = checkin({ checkinDate: "2026-08-05", energy: 5 });
      const d = baseDecision({ sourceCheckinId: wrongDateCheckin.id });
      const timeline = buildScenarioTimeline({ decisions: [d], checkins: [wrongDateCheckin] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentBaselineCheckinError);
    });
  });

  describe("execution states", () => {
    it("explicit -> full raw session facts, REST preserves null duration/rpe/sessionLoad", () => {
      const d = baseDecision();
      const s = completedSession({
        sessionDate: DECISION_DATE,
        decisionId: d.id,
        sessionType: "REST",
        completionStatus: "done",
        actualDurationMin: null,
        rpe: null,
        sessionLoad: null,
      });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.execution).toEqual({
        state: "explicit",
        completedSessionId: s.id,
        sessionType: "REST",
        completionStatus: "done",
        actualDurationMin: null,
        rpe: null,
        sessionLoad: null,
        postLegFatigue: null,
        postGripFatigue: null,
        newPain: false,
      });
    });

    it("explicit -> normal session preserves a DB-provided sessionLoad as a raw source value", () => {
      const d = baseDecision();
      const s = completedSession({
        sessionDate: DECISION_DATE,
        decisionId: d.id,
        sessionType: "AEROBIC_BASE",
        actualDurationMin: 60,
        rpe: 6,
        sessionLoad: 36,
      });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.execution).toMatchObject({ state: "explicit", sessionLoad: 36 });
    });

    it("no_completed_session -> nothing on decisionDate at all", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.execution).toEqual({ state: "no_completed_session" });
      expect(result.inputSnapshot.sameDaySession).toBeNull();
    });

    it("same_day_session_unlinked -> a same-day session exists with decision_id null", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: null });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.execution).toEqual({ state: "same_day_session_unlinked" });
      expect(result.inputSnapshot.sameDaySession?.id).toBe(s.id);
      expect(result.inputSnapshot.sameDaySession?.linkedDecisionId).toBeNull();
    });

    it("same_day_session_linked_elsewhere -> a same-day session is linked to a different decision from the same day", () => {
      const d1 = baseDecision();
      const d2 = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: d2.id });
      const timeline = buildScenarioTimeline({ decisions: [d1, d2], completedSessions: [s] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d1.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.execution).toEqual({ state: "same_day_session_linked_elsewhere" });
      expect(result.inputSnapshot.sameDaySession?.id).toBe(s.id);
      expect(result.inputSnapshot.sameDaySession?.linkedDecisionId).toBe(d2.id);

      // d2's own perspective sees the same session as its own explicit execution.
      const result2 = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d2.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result2.outcomeSignals.execution).toMatchObject({ state: "explicit", completedSessionId: s.id });
    });

    it("never attaches an unlinked/other-linked session's values to the current decision", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: null, actualDurationMin: 90, rpe: 9 });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.execution).toEqual({ state: "same_day_session_unlinked" });
      expect(Object.keys(result.outcomeSignals.execution)).toEqual(["state"]);
    });

    it("throws InconsistentExecutionLinkError when the same-day AthleteDay has more than one completed session", () => {
      const d = baseDecision();
      const s1 = completedSession({ sessionDate: DECISION_DATE, decisionId: null });
      const s2 = completedSession({ sessionDate: DECISION_DATE, decisionId: null });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s1, s2] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentExecutionLinkError);
    });

    it("throws InconsistentExecutionDateError when an explicitly linked session's sessionDate differs from decisionDate", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: "2026-08-11", decisionId: d.id });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentExecutionDateError);
    });

    it("throws InconsistentExecutionLinkError when the reverse decision_id lookup itself has more than one entry", () => {
      // Two different completed_sessions rows (different sessionDate, so neither collides with the
      // other on AthleteDay(decisionDate) — this isolates DecisionThread.linkedCompletedSessions.length
      // > 1 specifically, distinct from the "same-day AthleteDay has >1 sessions" case above. Reachable
      // via buildTimeline directly: nothing in M5_002B enforces "at most one completed_sessions row per
      // decision_id" — that invariant is only ever upheld by the M5_003 Edge Function's own preflight on
      // its single legitimate write path, never as a structural guarantee this package can rely on.
      const d = baseDecision();
      const s1 = completedSession({ sessionDate: DECISION_DATE, decisionId: d.id });
      const s2 = completedSession({ sessionDate: "2026-08-05", decisionId: d.id });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s1, s2] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentExecutionLinkError);
    });
  });

  describe("execution bidirectional consistency (hand-malformed timelines)", () => {
    function baselineExplicitTimeline(): { timeline: AthleteTimeline; decisionId: string; sessionId: string } {
      const d = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: d.id });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      return { timeline, decisionId: d.id, sessionId: s.id };
    }

    it("sameDay says current decision but the reverse link is missing -> InconsistentExecutionLinkError", () => {
      const { timeline, decisionId } = baselineExplicitTimeline();
      const malformed: AthleteTimeline = {
        ...timeline,
        decisionThreads: timeline.decisionThreads.map((t) => (t.decision.id === decisionId ? { ...t, linkedCompletedSessions: [] } : t)),
      };
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline: malformed, decisionId, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentExecutionLinkError);
    });

    it("reverse link exists but the same-day session is missing -> InconsistentExecutionLinkError", () => {
      const { timeline, decisionId } = baselineExplicitTimeline();
      const malformed: AthleteTimeline = {
        ...timeline,
        days: timeline.days.map((day) => (day.date === DECISION_DATE ? { ...day, completedSessions: [] } : day)),
      };
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline: malformed, decisionId, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentExecutionLinkError);
    });

    it("reverse link and same-day session ids disagree -> InconsistentExecutionLinkError", () => {
      const { timeline, decisionId, sessionId } = baselineExplicitTimeline();
      const malformed: AthleteTimeline = {
        ...timeline,
        decisionThreads: timeline.decisionThreads.map((t) =>
          t.decision.id === decisionId
            ? { ...t, linkedCompletedSessions: t.linkedCompletedSessions.map((s) => ({ ...s, id: `${sessionId}-other` })) }
            : t
        ),
      };
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline: malformed, decisionId, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentExecutionLinkError);
    });

    it("sameDay is unlinked but a reverse link exists -> InconsistentExecutionLinkError", () => {
      const { timeline, decisionId } = baselineExplicitTimeline();
      const malformed: AthleteTimeline = {
        ...timeline,
        days: timeline.days.map((day) =>
          day.date === DECISION_DATE
            ? {
                ...day,
                completedSessions: day.completedSessions.map((entry) => ({
                  ...entry,
                  completedSession: { ...entry.completedSession, decisionId: null },
                })),
              }
            : day
        ),
      };
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline: malformed, decisionId, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentExecutionLinkError);
    });

    it("sameDay is linked to a different decision but a reverse link to the current decision still exists -> InconsistentExecutionLinkError", () => {
      const { timeline, decisionId } = baselineExplicitTimeline();
      const malformed: AthleteTimeline = {
        ...timeline,
        days: timeline.days.map((day) =>
          day.date === DECISION_DATE
            ? {
                ...day,
                completedSessions: day.completedSessions.map((entry) => ({
                  ...entry,
                  completedSession: { ...entry.completedSession, decisionId: "some-other-decision" },
                })),
              }
            : day
        ),
      };
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline: malformed, decisionId, horizon: "J_PLUS_1", observedThroughDate: J1 })
      ).toThrow(InconsistentExecutionLinkError);
    });
  });

  describe("health context", () => {
    it("active on target date", () => {
      const d = baseDecision();
      const flag = healthFlag({ flagDate: DECISION_DATE, resolvedAt: null });
      const timeline = buildScenarioTimeline({ decisions: [d], healthFlags: [flag] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.healthContext.activeOnTargetDate.map((f) => f.id)).toEqual([flag.id]);
    });

    it("created strictly after the decision, on or before target date -> newSinceDecision", () => {
      const d = baseDecision();
      const flag = healthFlag({ flagDate: J1, resolvedAt: null });
      const timeline = buildScenarioTimeline({ decisions: [d], healthFlags: [flag] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.healthContext.newSinceDecision.map((f) => f.id)).toEqual([flag.id]);
    });

    it("a flag raised exactly on decisionDate is NOT newSinceDecision (strictly after decisionDate)", () => {
      const d = baseDecision();
      const flag = healthFlag({ flagDate: DECISION_DATE, resolvedAt: null });
      const timeline = buildScenarioTimeline({ decisions: [d], healthFlags: [flag] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.healthContext.newSinceDecision).toEqual([]);
    });

    it("carry-over unresolved: active at decisionDate and still active at targetDate", () => {
      const d = baseDecision();
      const flag = healthFlag({ flagDate: "2026-08-05", resolvedAt: null });
      const timeline = buildScenarioTimeline({ decisions: [d], healthFlags: [flag] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.healthContext.unresolvedAtTarget.map((f) => f.id)).toEqual([flag.id]);
      // unresolvedAtTarget is a subset of activeOnTargetDate.
      expect(result.outcomeSignals.healthContext.activeOnTargetDate.map((f) => f.id)).toContain(flag.id);
    });

    it("resolved before targetDate -> absent from activeOnTargetDate and unresolvedAtTarget", () => {
      const d = baseDecision();
      const flag = healthFlag({ flagDate: "2026-08-05", resolvedAt: "2026-08-10" });
      const timeline = buildScenarioTimeline({ decisions: [d], healthFlags: [flag] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.healthContext.activeOnTargetDate).toEqual([]);
      expect(result.outcomeSignals.healthContext.unresolvedAtTarget).toEqual([]);
    });

    it("historical classification is date-derived, deliberately ignoring the flag's current live status", () => {
      const d = baseDecision();
      // status is "resolved" (current live status) even though flagDate/resolvedAt prove it was active on targetDate.
      const flag = healthFlag({ flagDate: "2026-08-05", resolvedAt: null, status: "resolved" });
      const timeline = buildScenarioTimeline({ decisions: [d], healthFlags: [flag] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.healthContext.activeOnTargetDate.map((f) => f.id)).toEqual([flag.id]);
      expect(result.outcomeSignals.healthContext.activeOnTargetDate[0]?.status).toBe("resolved");
    });

    it("healthFlagsInWindow is the deduplicated union of the three categories, never unrelated flags", () => {
      const d = baseDecision();
      const relevant = healthFlag({ flagDate: DECISION_DATE, resolvedAt: null });
      const unrelated = healthFlag({ flagDate: "2026-08-01", resolvedAt: "2026-08-02" });
      const timeline = buildScenarioTimeline({ decisions: [d], healthFlags: [relevant, unrelated] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      const ids = result.inputSnapshot.healthFlagsInWindow.map((f) => f.id);
      expect(ids).toContain(relevant.id);
      expect(ids).not.toContain(unrelated.id);
    });
  });

  describe("multiple decisions on the same day", () => {
    it("threads remain independent; a session explicitly linked to one leaves the other same_day_session_linked_elsewhere", () => {
      const d1 = baseDecision();
      const d2 = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: d1.id });
      const timeline = buildScenarioTimeline({ decisions: [d1, d2], completedSessions: [s] });

      const r1 = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d1.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      const r2 = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d2.id, horizon: "J_PLUS_1", observedThroughDate: J1 });

      expect(r1.outcomeSignals.execution).toMatchObject({ state: "explicit", completedSessionId: s.id });
      expect(r2.outcomeSignals.execution).toEqual({ state: "same_day_session_linked_elsewhere" });
    });
  });

  describe("determinism", () => {
    it("produces an identical snapshot/signals after shuffling every source array's order", () => {
      const baseline = checkin({ checkinDate: DECISION_DATE, energy: 5 });
      const d = baseDecision({ sourceCheckinId: baseline.id });
      const target = checkin({ checkinDate: J1, energy: 8 });
      const flag = healthFlag({ flagDate: DECISION_DATE, resolvedAt: null });
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: d.id });

      const forward = buildScenarioTimeline({
        decisions: [d],
        checkins: [baseline, target],
        healthFlags: [flag],
        completedSessions: [s],
      });
      const shuffled = buildScenarioTimeline({
        decisions: [d],
        checkins: [target, baseline],
        healthFlags: [flag],
        completedSessions: [s],
      });

      const r1 = calculateDecisionOutcomeSnapshot({ timeline: forward, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      const r2 = calculateDecisionOutcomeSnapshot({ timeline: shuffled, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });

      expect(r1).toEqual(r2);
    });
  });

  describe("J+3 and J+7 exact boundaries end-to-end", () => {
    it("J+3 matures exactly on decisionDate+3", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_3", observedThroughDate: "2026-08-12" })
      ).toThrow(HorizonNotMatureError);
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_3", observedThroughDate: J3 });
      expect(result.outcomeSignals.targetDate).toBe(J3);
    });

    it("J+7 matures exactly on decisionDate+7", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      expect(() =>
        calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_7", observedThroughDate: "2026-08-16" })
      ).toThrow(HorizonNotMatureError);
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_7", observedThroughDate: J7 });
      expect(result.outcomeSignals.targetDate).toBe(J7);
    });
  });

  describe("schema identity", () => {
    it("stamps schemaVersion 1 and the requested horizon/targetDate on every result", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      expect(result.outcomeSignals.schemaVersion).toBe(1);
      expect(result.outcomeSignals.horizon).toBe("J_PLUS_1");
      expect(result.inputSnapshot.horizon).toBe("J_PLUS_1");
      expect(result.inputSnapshot.targetDate).toBe(J1);
    });

    it("never includes a current timestamp field", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = calculateDecisionOutcomeSnapshot({ timeline, decisionId: d.id, horizon: "J_PLUS_1", observedThroughDate: J1 });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/calculatedAt|calculated_at/);
    });
  });
});
