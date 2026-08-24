import { beforeEach, describe, expect, it } from "vitest";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import type { AthleteTimeline } from "../../../src/timeline/types.js";
import {
  detectRecommendationVsActualExecution,
  RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
  RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION,
  AthleteScopeMismatchError,
  CompletionStatusTypeMismatchError,
} from "../../../src/detectors/index.js";
import { DecisionNotFoundInTimelineError, DuplicateDecisionThreadError } from "../../../src/relations/index.js";
import {
  ATHLETE_A,
  checkin,
  completedSession,
  decision,
  decisionOutcome,
  emptySources,
  healthFlag,
  resetIdSequence,
} from "../timeline/fixtures.js";
import type { CompletionStatus } from "../../../src/types/sources.js";

beforeEach(() => resetIdSequence());

const RANGE = { fromDate: "2026-08-01", toDate: "2026-08-20" };
const DECISION_DATE = "2026-08-10";

function buildScenarioTimeline(overrides: {
  readonly athleteId?: string;
  readonly decisions?: ReturnType<typeof decision>[];
  readonly completedSessions?: ReturnType<typeof completedSession>[];
  readonly checkins?: ReturnType<typeof checkin>[];
  readonly healthFlags?: ReturnType<typeof healthFlag>[];
  readonly outcomes?: ReturnType<typeof decisionOutcome>[];
}): AthleteTimeline {
  return buildTimeline({
    athleteId: overrides.athleteId ?? ATHLETE_A,
    range: RANGE,
    sources: {
      ...emptySources(),
      decisions: overrides.decisions ?? [],
      completedSessions: overrides.completedSessions ?? [],
      checkins: overrides.checkins ?? [],
      healthFlags: overrides.healthFlags ?? [],
      outcomes: overrides.outcomes ?? [],
    },
  });
}

/**
 * Deep-copies a real, correctly-assembled AthleteTimeline while reversing
 * every array whose ORDER the detector must not depend on:
 * decisionThreads, days, each day's own completedSessions, and each
 * thread's own linkedCompletedSessions. Structural relationships
 * (which day holds which session, which thread links to which session)
 * are preserved exactly — only positions within these arrays move.
 */
function reorderTimelineArrays(timeline: AthleteTimeline): AthleteTimeline {
  return {
    ...timeline,
    decisionThreads: [...timeline.decisionThreads].reverse().map((t) => ({
      ...t,
      linkedCompletedSessions: [...t.linkedCompletedSessions].reverse(),
    })),
    days: [...timeline.days].reverse().map((day) => ({
      ...day,
      completedSessions: [...day.completedSessions].reverse(),
    })),
  };
}

function baseDecision(overrides: Parameters<typeof decision>[0] = {}) {
  return decision({ decisionDate: DECISION_DATE, finalSession: "STRENGTH_A", ...overrides });
}

function explicitSession(decisionId: string, overrides: Parameters<typeof completedSession>[0] = {}) {
  return completedSession({
    sessionDate: DECISION_DATE,
    decisionId,
    sessionType: "STRENGTH_A",
    completionStatus: "done",
    ...overrides,
  });
}

const EVIDENCE_KEYS = [
  "kind",
  "detectorRuleId",
  "detectorRuleVersion",
  "evaluationKey",
  "evidenceKey",
  "eventType",
  "eventDate",
  "observedValue",
  "sourceRefs",
].sort();

const OBSERVED_VALUE_KEYS = [
  "decisionId",
  "decisionDate",
  "recommendedSessionType",
  "executionState",
  "completedSessionId",
  "completionStatus",
  "actualSessionType",
  "typeMatchesRecommendation",
].sort();

const SOURCE_REFS_KEYS = ["decisionId", "completedSessionId"].sort();

const NO_EVIDENCE_KEYS = ["kind", "detectorRuleId", "detectorRuleVersion", "evaluationKey", "eventDate", "reason"].sort();

describe("detectRecommendationVsActualExecution", () => {
  describe("classification matrix", () => {
    it("done + type match -> supporting", () => {
      const d = baseDecision();
      const s = explicitSession(d.id, { completionStatus: "done" });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(result.kind).toBe("evidence");
      if (result.kind === "evidence") expect(result.eventType).toBe("supporting");
    });

    it("partial + type match -> neutral", () => {
      const d = baseDecision();
      const s = explicitSession(d.id, { completionStatus: "partial" });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(result.kind).toBe("evidence");
      if (result.kind === "evidence") expect(result.eventType).toBe("neutral");
    });

    it("skipped + type match -> contradicting", () => {
      const d = baseDecision();
      const s = explicitSession(d.id, { completionStatus: "skipped", actualDurationMin: null, rpe: null });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(result.kind).toBe("evidence");
      if (result.kind === "evidence") expect(result.eventType).toBe("contradicting");
    });

    it("replaced + same DbSessionType -> contradicting", () => {
      const d = baseDecision();
      const s = explicitSession(d.id, { completionStatus: "replaced", sessionType: "STRENGTH_A" });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(result.kind).toBe("evidence");
      if (result.kind === "evidence") {
        expect(result.eventType).toBe("contradicting");
        expect(result.observedValue.typeMatchesRecommendation).toBe(true);
      }
    });

    it("replaced + different DbSessionType -> contradicting", () => {
      const d = baseDecision();
      const s = explicitSession(d.id, { completionStatus: "replaced", sessionType: "RECOVERY" });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(result.kind).toBe("evidence");
      if (result.kind === "evidence") {
        expect(result.eventType).toBe("contradicting");
        expect(result.observedValue.typeMatchesRecommendation).toBe(false);
      }
    });
  });

  describe("structural type-mismatch errors (never evidence)", () => {
    it("done + type mismatch -> CompletionStatusTypeMismatchError", () => {
      const d = baseDecision();
      const s = explicitSession(d.id, { completionStatus: "done", sessionType: "RECOVERY" });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      expect(() => detectRecommendationVsActualExecution({ timeline, decisionId: d.id })).toThrow(CompletionStatusTypeMismatchError);
    });

    it("partial + type mismatch -> CompletionStatusTypeMismatchError", () => {
      const d = baseDecision();
      const s = explicitSession(d.id, { completionStatus: "partial", sessionType: "RECOVERY" });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      expect(() => detectRecommendationVsActualExecution({ timeline, decisionId: d.id })).toThrow(CompletionStatusTypeMismatchError);
    });

    it("skipped + type mismatch -> CompletionStatusTypeMismatchError", () => {
      const d = baseDecision();
      const s = explicitSession(d.id, { completionStatus: "skipped", sessionType: "RECOVERY", actualDurationMin: null, rpe: null });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      expect(() => detectRecommendationVsActualExecution({ timeline, decisionId: d.id })).toThrow(CompletionStatusTypeMismatchError);
    });
  });

  describe("no-evidence matrix", () => {
    it("no_completed_session -> no_evidence", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(result).toEqual({
        kind: "no_evidence",
        detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
        detectorRuleVersion: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION,
        evaluationKey: `decision:${d.id}`,
        eventDate: DECISION_DATE,
        reason: "no_completed_session",
      });
    });

    it("unlinked, same session type as recommendation -> no_evidence (never inferred as a match)", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: null, sessionType: "STRENGTH_A" });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(result.kind).toBe("no_evidence");
      if (result.kind === "no_evidence") expect(result.reason).toBe("same_day_session_unlinked");
    });

    it("unlinked, different session type -> no_evidence", () => {
      const d = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: null, sessionType: "RECOVERY" });
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(result.kind).toBe("no_evidence");
      if (result.kind === "no_evidence") expect(result.reason).toBe("same_day_session_unlinked");
    });

    it("linked elsewhere -> no_evidence", () => {
      const d1 = baseDecision();
      const d2 = baseDecision();
      const s = completedSession({ sessionDate: DECISION_DATE, decisionId: d2.id, sessionType: "STRENGTH_A" });
      const timeline = buildScenarioTimeline({ decisions: [d1, d2], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d1.id });
      expect(result.kind).toBe("no_evidence");
      if (result.kind === "no_evidence") expect(result.reason).toBe("same_day_session_linked_elsewhere");
    });
  });

  describe("multiple decisions on the same day", () => {
    it("linked decision gets evidence, the other decision gets no_evidence", () => {
      const d1 = baseDecision();
      const d2 = baseDecision();
      const s = explicitSession(d1.id);
      const timeline = buildScenarioTimeline({ decisions: [d1, d2], completedSessions: [s] });

      const r1 = detectRecommendationVsActualExecution({ timeline, decisionId: d1.id });
      const r2 = detectRecommendationVsActualExecution({ timeline, decisionId: d2.id });

      expect(r1.kind).toBe("evidence");
      expect(r2.kind).toBe("no_evidence");
      if (r2.kind === "no_evidence") expect(r2.reason).toBe("same_day_session_linked_elsewhere");
    });
  });

  describe("decision resolution errors", () => {
    it("decision missing -> DecisionNotFoundInTimelineError", () => {
      const timeline = buildScenarioTimeline({ decisions: [baseDecision()] });
      expect(() => detectRecommendationVsActualExecution({ timeline, decisionId: "nonexistent" })).toThrow(DecisionNotFoundInTimelineError);
    });

    it("duplicate decision -> DuplicateDecisionThreadError", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d, { ...d }] });
      expect(() => detectRecommendationVsActualExecution({ timeline, decisionId: d.id })).toThrow(DuplicateDecisionThreadError);
    });

    it("athlete scope mismatch -> AthleteScopeMismatchError", () => {
      const d = baseDecision({ athleteId: ATHLETE_A });
      const real = buildScenarioTimeline({ decisions: [d] });
      // Structurally unreachable via a normal buildTimeline call (assertAthleteScoped would reject a
      // mismatched decision at construction time) — hand-malformed here to prove the detector's own
      // defensive re-check against a caller-mismatched timeline.athleteId.
      const malformed: AthleteTimeline = { ...real, athleteId: "athlete-other" };
      expect(() => detectRecommendationVsActualExecution({ timeline: malformed, decisionId: d.id })).toThrow(AthleteScopeMismatchError);
    });
  });

  describe("exact schema key sets", () => {
    it("evidence has exactly the 9 top-level fields", () => {
      const d = baseDecision();
      const s = explicitSession(d.id);
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(Object.keys(result).sort()).toEqual(EVIDENCE_KEYS);
    });

    it("evidence.observedValue has exactly the 8 fields", () => {
      const d = baseDecision();
      const s = explicitSession(d.id);
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      if (result.kind === "evidence") expect(Object.keys(result.observedValue).sort()).toEqual(OBSERVED_VALUE_KEYS);
      else throw new Error("expected evidence");
    });

    it("evidence.sourceRefs has exactly the 2 fields", () => {
      const d = baseDecision();
      const s = explicitSession(d.id);
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      if (result.kind === "evidence") expect(Object.keys(result.sourceRefs).sort()).toEqual(SOURCE_REFS_KEYS);
      else throw new Error("expected evidence");
    });

    it("no_evidence has exactly the 6 fields", () => {
      const d = baseDecision();
      const timeline = buildScenarioTimeline({ decisions: [d] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(Object.keys(result).sort()).toEqual(NO_EVIDENCE_KEYS);
    });
  });

  describe("key semantics", () => {
    it("evaluationKey is decision:<id> for both evidence and no_evidence", () => {
      const d = baseDecision();
      const withSession = buildScenarioTimeline({ decisions: [d], completedSessions: [explicitSession(d.id)] });
      const withoutSession = buildScenarioTimeline({ decisions: [d] });
      const evidence = detectRecommendationVsActualExecution({ timeline: withSession, decisionId: d.id });
      const noEvidence = detectRecommendationVsActualExecution({ timeline: withoutSession, decisionId: d.id });
      expect(evidence.evaluationKey).toBe(`decision:${d.id}`);
      expect(noEvidence.evaluationKey).toBe(`decision:${d.id}`);
    });

    it("evidenceKey is decision:<id>:completion:<completedSessionId>", () => {
      const d = baseDecision();
      const s = explicitSession(d.id);
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const result = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      if (result.kind === "evidence") expect(result.evidenceKey).toBe(`decision:${d.id}:completion:${s.id}`);
      else throw new Error("expected evidence");
    });
  });

  describe("source-edit semantics", () => {
    it("skipped -> done: same evaluationKey, same evidenceKey, different eventType/observedValue", () => {
      const d = baseDecision();
      const sessionId = "shared-session-id";
      const skippedTimeline = buildScenarioTimeline({
        decisions: [d],
        completedSessions: [
          completedSession({ id: sessionId, sessionDate: DECISION_DATE, decisionId: d.id, sessionType: "STRENGTH_A", completionStatus: "skipped", actualDurationMin: null, rpe: null }),
        ],
      });
      const doneTimeline = buildScenarioTimeline({
        decisions: [d],
        completedSessions: [
          completedSession({ id: sessionId, sessionDate: DECISION_DATE, decisionId: d.id, sessionType: "STRENGTH_A", completionStatus: "done", actualDurationMin: 40, rpe: 6 }),
        ],
      });

      const before = detectRecommendationVsActualExecution({ timeline: skippedTimeline, decisionId: d.id });
      const after = detectRecommendationVsActualExecution({ timeline: doneTimeline, decisionId: d.id });

      expect(before.kind).toBe("evidence");
      expect(after.kind).toBe("evidence");
      if (before.kind === "evidence" && after.kind === "evidence") {
        expect(after.evaluationKey).toBe(before.evaluationKey);
        expect(after.evidenceKey).toBe(before.evidenceKey);
        expect(after.eventType).not.toBe(before.eventType);
        expect(after.observedValue).not.toEqual(before.observedValue);
        expect(before.eventType).toBe("contradicting");
        expect(after.eventType).toBe("supporting");
      }
    });

    it("done -> skipped -> done: same evaluationKey/evidenceKey throughout", () => {
      const d = baseDecision();
      const sessionId = "roundtrip-session-id";
      const make = (completionStatus: CompletionStatus) =>
        buildScenarioTimeline({
          decisions: [d],
          completedSessions: [
            completedSession({
              id: sessionId,
              sessionDate: DECISION_DATE,
              decisionId: d.id,
              sessionType: "STRENGTH_A",
              completionStatus,
              actualDurationMin: completionStatus === "skipped" ? null : 40,
              rpe: completionStatus === "skipped" ? null : 6,
            }),
          ],
        });

      const r1 = detectRecommendationVsActualExecution({ timeline: make("done"), decisionId: d.id });
      const r2 = detectRecommendationVsActualExecution({ timeline: make("skipped"), decisionId: d.id });
      const r3 = detectRecommendationVsActualExecution({ timeline: make("done"), decisionId: d.id });

      expect(r1.kind).toBe("evidence");
      expect(r2.kind).toBe("evidence");
      expect(r3.kind).toBe("evidence");
      if (r1.kind === "evidence" && r2.kind === "evidence" && r3.kind === "evidence") {
        expect(r2.evaluationKey).toBe(r1.evaluationKey);
        expect(r3.evaluationKey).toBe(r1.evaluationKey);
        expect(r2.evidenceKey).toBe(r1.evidenceKey);
        expect(r3.evidenceKey).toBe(r1.evidenceKey);
        expect(r3).toEqual(r1); // full round-trip, deep-equal
      }
    });

    it("non-consumed session field edits (rpe/duration/fatigue/pain/intervention/notes/sessionLoad) -> output deep-equal", () => {
      const d = baseDecision();
      const sessionId = "field-edit-session-id";
      const v1 = buildScenarioTimeline({
        decisions: [d],
        completedSessions: [
          completedSession({
            id: sessionId,
            sessionDate: DECISION_DATE,
            decisionId: d.id,
            sessionType: "STRENGTH_A",
            completionStatus: "done",
            actualDurationMin: 40,
            rpe: 5,
            postLegFatigue: 2,
            postGripFatigue: 1,
            newPain: false,
            newPainNote: null,
            intervention: null,
            mainContent: null,
            sessionLoad: 20,
          }),
        ],
      });
      const v2 = buildScenarioTimeline({
        decisions: [d],
        completedSessions: [
          completedSession({
            id: sessionId,
            sessionDate: DECISION_DATE,
            decisionId: d.id,
            sessionType: "STRENGTH_A",
            completionStatus: "done",
            actualDurationMin: 90, // changed
            rpe: 9, // changed
            postLegFatigue: 8, // changed
            postGripFatigue: 7, // changed
            newPain: true, // changed
            newPainNote: "sore", // changed
            intervention: { a: 1 }, // changed
            mainContent: { b: 2 }, // changed
            sessionLoad: 81, // changed — trigger-derived in production, but ExecutionSignal.explicit still carries it; detector must not consume it
          }),
        ],
      });

      const r1 = detectRecommendationVsActualExecution({ timeline: v1, decisionId: d.id });
      const r2 = detectRecommendationVsActualExecution({ timeline: v2, decisionId: d.id });
      expect(r2).toEqual(r1);
    });

    it("explicit relationship disappearing (decision_id nulled) -> evidence becomes no_evidence, evaluationKey unchanged", () => {
      const d = baseDecision();
      const sessionId = "disappearing-link-session-id";
      const linked = buildScenarioTimeline({
        decisions: [d],
        completedSessions: [completedSession({ id: sessionId, sessionDate: DECISION_DATE, decisionId: d.id, sessionType: "STRENGTH_A", completionStatus: "done" })],
      });
      const unlinked = buildScenarioTimeline({
        decisions: [d],
        completedSessions: [completedSession({ id: sessionId, sessionDate: DECISION_DATE, decisionId: null, sessionType: "STRENGTH_A", completionStatus: "done" })],
      });

      const before = detectRecommendationVsActualExecution({ timeline: linked, decisionId: d.id });
      const after = detectRecommendationVsActualExecution({ timeline: unlinked, decisionId: d.id });

      expect(before.kind).toBe("evidence");
      expect(after.kind).toBe("no_evidence");
      expect(after.evaluationKey).toBe(before.evaluationKey);
      expect(after).not.toHaveProperty("evidenceKey");
    });
  });

  describe("zero consumption of health/race/dailyPlan/checkin/outcome facts", () => {
    it("output is deep-equal regardless of dailyPlan, activeMode, checkins, or health flags", () => {
      const d = baseDecision();
      const s = explicitSession(d.id);

      const plain = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const withExtras = buildScenarioTimeline({
        decisions: [decision({ ...d, dailyPlan: { some: "plan" }, activeMode: "RACE_WEEK", confidenceLevel: "HIGH" })],
        completedSessions: [s],
        checkins: [checkin({ checkinDate: DECISION_DATE, energy: 9, pain: true, painIntensity: 8 })],
        healthFlags: [healthFlag({ flagDate: DECISION_DATE, flagType: "concussion_suspect", status: "active" })],
      });

      const r1 = detectRecommendationVsActualExecution({ timeline: plain, decisionId: d.id });
      const r2 = detectRecommendationVsActualExecution({ timeline: withExtras, decisionId: d.id });
      expect(r2).toEqual(r1);
    });

    it("output is deep-equal regardless of decision_outcomes present in the timeline", () => {
      const d = baseDecision();
      const s = explicitSession(d.id);

      const withoutOutcomes = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const withOutcomes = buildScenarioTimeline({
        decisions: [d],
        completedSessions: [s],
        outcomes: [
          decisionOutcome({
            decisionId: d.id,
            horizon: "J_PLUS_1",
            inputSnapshot: { some: "snapshot" },
            outcomeSignals: { some: "signals" },
          }),
        ],
      });

      const r1 = detectRecommendationVsActualExecution({ timeline: withoutOutcomes, decisionId: d.id });
      const r2 = detectRecommendationVsActualExecution({ timeline: withOutcomes, decisionId: d.id });
      expect(r2).toEqual(r1);
    });
  });

  describe("determinism", () => {
    it("shuffled timeline source arrays produce a deep-equal result", () => {
      const d1 = baseDecision();
      const d2 = baseDecision();
      const s = explicitSession(d1.id);
      const flag = healthFlag({ flagDate: DECISION_DATE });
      const c = checkin({ checkinDate: DECISION_DATE });

      const forward = buildScenarioTimeline({ decisions: [d1, d2], completedSessions: [s], healthFlags: [flag], checkins: [c] });
      const shuffled = buildScenarioTimeline({ decisions: [d2, d1], completedSessions: [s], healthFlags: [flag], checkins: [c] });

      const r1 = detectRecommendationVsActualExecution({ timeline: forward, decisionId: d1.id });
      const r2 = detectRecommendationVsActualExecution({ timeline: shuffled, decisionId: d1.id });
      expect(r2).toEqual(r1);
    });

    it("reordering the canonical timeline's own decisionThreads/days/linkedCompletedSessions/completedSessions arrays after construction produces a deep-equal result", () => {
      const d1 = baseDecision();
      const d2 = baseDecision();
      const s = explicitSession(d1.id);
      const timeline = buildScenarioTimeline({ decisions: [d1, d2], completedSessions: [s] });
      const reordered = reorderTimelineArrays(timeline);

      // Sanity: the reorder actually changed array positions, this isn't a no-op.
      expect(reordered.decisionThreads[0]?.decision.id).not.toBe(timeline.decisionThreads[0]?.decision.id);

      const r1 = detectRecommendationVsActualExecution({ timeline, decisionId: d1.id });
      const r2 = detectRecommendationVsActualExecution({ timeline: reordered, decisionId: d1.id });
      expect(r2).toEqual(r1);

      const r1Other = detectRecommendationVsActualExecution({ timeline, decisionId: d2.id });
      const r2Other = detectRecommendationVsActualExecution({ timeline: reordered, decisionId: d2.id });
      expect(r2Other).toEqual(r1Other);
    });

    it("identical repeated calls are deep-equal", () => {
      const d = baseDecision();
      const s = explicitSession(d.id);
      const timeline = buildScenarioTimeline({ decisions: [d], completedSessions: [s] });
      const r1 = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      const r2 = detectRecommendationVsActualExecution({ timeline, decisionId: d.id });
      expect(r2).toEqual(r1);
    });
  });
});
