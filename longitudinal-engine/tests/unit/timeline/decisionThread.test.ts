import { beforeEach, describe, expect, it } from "vitest";
import { buildDecisionThreads, OrphanedDecisionOutcomeError } from "../../../src/timeline/decisionThread.js";
import { checkin, completedSession, decision, decisionOutcome, resetIdSequence } from "./fixtures.js";
import { indexById } from "../../../src/timeline/partitioning.js";

beforeEach(() => resetIdSequence());

describe("buildDecisionThreads", () => {
  it("builds one thread per decision, never collapsing multiple same-day decisions", () => {
    const d1 = decision({ id: "d1", decisionDate: "2026-08-10", computedAt: "2026-08-10T09:00:00.000Z" });
    const d2 = decision({ id: "d2", decisionDate: "2026-08-10", computedAt: "2026-08-10T08:00:00.000Z" });
    const threads = buildDecisionThreads([d1, d2], new Map(), [], []);
    expect(threads).toHaveLength(2);
    // Same decisionDate -> tie-break by computedAt ASC, not insertion order.
    expect(threads.map((t) => t.decision.id)).toEqual(["d2", "d1"]);
  });

  it("orders threads by decisionDate ASC first", () => {
    const d1 = decision({ id: "d1", decisionDate: "2026-08-15" });
    const d2 = decision({ id: "d2", decisionDate: "2026-08-10" });
    const threads = buildDecisionThreads([d1, d2], new Map(), [], []);
    expect(threads.map((t) => t.decision.id)).toEqual(["d2", "d1"]);
  });

  it("shuffled input array order never affects output order", () => {
    const decisions = [
      decision({ id: "a", decisionDate: "2026-08-12" }),
      decision({ id: "b", decisionDate: "2026-08-10" }),
      decision({ id: "c", decisionDate: "2026-08-11" }),
    ];
    const forward = buildDecisionThreads(decisions, new Map(), [], []).map((t) => t.decision.id);
    const shuffled = buildDecisionThreads([decisions[2]!, decisions[0]!, decisions[1]!], new Map(), [], []).map(
      (t) => t.decision.id
    );
    expect(shuffled).toEqual(forward);
    expect(forward).toEqual(["b", "c", "a"]);
  });

  describe("linkedSourceCheckin", () => {
    it("resolves explicitly when sourceCheckinId matches a checkin in the pool", () => {
      const c = checkin({ id: "c1" });
      const d = decision({ sourceCheckinId: "c1" });
      const threads = buildDecisionThreads([d], indexById([c]), [], []);
      expect(threads[0]?.linkedSourceCheckin).toEqual({ kind: "explicit", ref: c });
    });

    it("is fk_null when sourceCheckinId is null", () => {
      const d = decision({ sourceCheckinId: null });
      const threads = buildDecisionThreads([d], new Map(), [], []);
      expect(threads[0]?.linkedSourceCheckin).toEqual({ kind: "absent", reason: "fk_null" });
    });

    it("is source_missing_in_pool when sourceCheckinId points outside the supplied pool", () => {
      const d = decision({ sourceCheckinId: "outside-range" });
      const threads = buildDecisionThreads([d], new Map(), [], []);
      expect(threads[0]?.linkedSourceCheckin).toEqual({ kind: "absent", reason: "source_missing_in_pool" });
    });
  });

  describe("linkedCompletedSessions (reverse 0..N)", () => {
    it("is empty when no completed session references the decision", () => {
      const d = decision({ id: "d1" });
      const threads = buildDecisionThreads([d], new Map(), [], []);
      expect(threads[0]?.linkedCompletedSessions).toEqual([]);
    });

    it("links a single completed session to its decision", () => {
      const d = decision({ id: "d1" });
      const s = completedSession({ id: "s1", decisionId: "d1" });
      const threads = buildDecisionThreads([d], new Map(), [s], []);
      expect(threads[0]?.linkedCompletedSessions).toEqual([s]);
    });

    it("links multiple completed sessions to the same decision, sorted by id ASC", () => {
      const d = decision({ id: "d1" });
      const s1 = completedSession({ id: "s2", decisionId: "d1" });
      const s2 = completedSession({ id: "s1", decisionId: "d1" });
      const threads = buildDecisionThreads([d], new Map(), [s1, s2], []);
      expect(threads[0]?.linkedCompletedSessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    });

    it("a completed session with decisionId null is simply never linked to any thread", () => {
      const d = decision({ id: "d1" });
      const s = completedSession({ id: "s1", decisionId: null });
      const threads = buildDecisionThreads([d], new Map(), [s], []);
      expect(threads[0]?.linkedCompletedSessions).toEqual([]);
    });
  });

  describe("outcomesByHorizon", () => {
    it("exposes all three horizon buckets, including empty ones, for a decision with no outcomes", () => {
      const d = decision({ id: "d1" });
      const threads = buildDecisionThreads([d], new Map(), [], []);
      expect(threads[0]?.outcomesByHorizon).toEqual({ J_PLUS_1: [], J_PLUS_3: [], J_PLUS_7: [] });
    });

    it("buckets outcomes by their exact horizon", () => {
      const d = decision({ id: "d1" });
      const o1 = decisionOutcome({ id: "o1", decisionId: "d1", horizon: "J_PLUS_1" });
      const o3 = decisionOutcome({ id: "o3", decisionId: "d1", horizon: "J_PLUS_3" });
      const o7 = decisionOutcome({ id: "o7", decisionId: "d1", horizon: "J_PLUS_7" });
      const threads = buildDecisionThreads([d], new Map(), [], [o3, o7, o1]);
      expect(threads[0]?.outcomesByHorizon.J_PLUS_1).toEqual([o1]);
      expect(threads[0]?.outcomesByHorizon.J_PLUS_3).toEqual([o3]);
      expect(threads[0]?.outcomesByHorizon.J_PLUS_7).toEqual([o7]);
    });

    it("preserves every calculatorId/calculatorVersion variant — never picks 'latest'", () => {
      const d = decision({ id: "d1" });
      const oV1 = decisionOutcome({ id: "o1", decisionId: "d1", horizon: "J_PLUS_1", calculatorId: "calc_a", calculatorVersion: "v1" });
      const oV2 = decisionOutcome({ id: "o2", decisionId: "d1", horizon: "J_PLUS_1", calculatorId: "calc_a", calculatorVersion: "v2" });
      const oOther = decisionOutcome({ id: "o3", decisionId: "d1", horizon: "J_PLUS_1", calculatorId: "calc_b", calculatorVersion: "v1" });
      const threads = buildDecisionThreads([d], new Map(), [], [oV1, oV2, oOther]);
      expect(threads[0]?.outcomesByHorizon.J_PLUS_1).toHaveLength(3);
      expect(threads[0]?.outcomesByHorizon.J_PLUS_1.map((o) => o.id).sort()).toEqual(["o1", "o2", "o3"]);
    });

    it("orders outcomes within a horizon by calculatedAt ASC, calculatorId ASC, calculatorVersion ASC, id ASC", () => {
      const d = decision({ id: "d1" });
      const late = decisionOutcome({ id: "z", decisionId: "d1", horizon: "J_PLUS_1", calculatedAt: "2026-08-12T00:00:00.000Z" });
      const earlySameTimeB = decisionOutcome({
        id: "b-id",
        decisionId: "d1",
        horizon: "J_PLUS_1",
        calculatorId: "calc_b",
        calculatedAt: "2026-08-11T00:00:00.000Z",
      });
      const earlySameTimeA = decisionOutcome({
        id: "a-id",
        decisionId: "d1",
        horizon: "J_PLUS_1",
        calculatorId: "calc_a",
        calculatedAt: "2026-08-11T00:00:00.000Z",
      });
      const threads = buildDecisionThreads([d], new Map(), [], [late, earlySameTimeB, earlySameTimeA]);
      expect(threads[0]?.outcomesByHorizon.J_PLUS_1.map((o) => o.id)).toEqual(["a-id", "b-id", "z"]);
    });

    it("throws OrphanedDecisionOutcomeError when an outcome references a decisionId not in the pool — fails loud, never silently drops it", () => {
      const d = decision({ id: "d1" });
      const orphan = decisionOutcome({ id: "o1", decisionId: "does-not-exist", horizon: "J_PLUS_1" });
      expect(() => buildDecisionThreads([d], new Map(), [], [orphan])).toThrow(OrphanedDecisionOutcomeError);
    });
  });
});
