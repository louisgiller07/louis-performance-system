import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateEffectivePatternEvidence,
  AggregationAthleteScopeMismatchError,
  DuplicateEffectiveEvidenceIdentityError,
  DuplicateEffectiveEvidenceKeyError,
  EvidenceOutsideAggregationRangeError,
} from "../../../src/aggregation/index.js";
import type { PatternEvidenceAggregate, PatternEvidenceCurrentEffectiveRow, PatternEvidenceEventType } from "../../../src/aggregation/index.js";
import { nextId, resetIdSequence } from "../timeline/fixtures.js";

beforeEach(() => resetIdSequence());

const ATHLETE_A = "athlete-a";
const RANGE = { fromDate: "2026-06-01", toDate: "2026-06-30" };

function evidenceRow(overrides: Partial<PatternEvidenceCurrentEffectiveRow> = {}): PatternEvidenceCurrentEffectiveRow {
  return {
    identityId: nextId("identity"),
    athleteId: ATHLETE_A,
    detectorRuleId: "rule_a",
    detectorRuleVersion: "1.0.0",
    evaluationKey: nextId("eval"),
    evidenceKey: nextId("evidence"),
    revisionId: nextId("revision"),
    revisionNumber: 1,
    supersedesId: null,
    eventType: "supporting",
    eventDate: "2026-06-10",
    observedValue: { irrelevant: "noise" },
    revisionCreatedAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

function aggregate(evidence: readonly PatternEvidenceCurrentEffectiveRow[], athleteId = ATHLETE_A, range = RANGE): readonly PatternEvidenceAggregate[] {
  return aggregateEffectivePatternEvidence({ athleteId, range, evidence });
}

describe("aggregateEffectivePatternEvidence", () => {
  describe("empty input", () => {
    it("evidence=[] -> []", () => {
      expect(aggregate([])).toEqual([]);
    });
  });

  describe("single-evidence cases", () => {
    it("single supporting -> supporting_only, ratios 1/0/null-contradicting", () => {
      const result = aggregate([evidenceRow({ eventType: "supporting" })]);
      expect(result).toHaveLength(1);
      const a = result[0]!;
      expect(a.evidenceCount).toBe(1);
      expect(a.supportingCount).toBe(1);
      expect(a.contradictingCount).toBe(0);
      expect(a.neutralCount).toBe(0);
      expect(a.directionalEvidenceCount).toBe(1);
      expect(a.supportingRatio).toBe(1);
      expect(a.contradictingRatio).toBe(0);
      expect(a.neutralRatio).toBe(0);
      expect(a.evidenceBalance).toBe("supporting_only");
    });

    it("single contradicting -> contradicting_only", () => {
      const result = aggregate([evidenceRow({ eventType: "contradicting" })]);
      const a = result[0]!;
      expect(a.contradictingCount).toBe(1);
      expect(a.supportingRatio).toBe(0);
      expect(a.contradictingRatio).toBe(1);
      expect(a.evidenceBalance).toBe("contradicting_only");
    });

    it("neutral only -> neutral_only, both directional ratios null", () => {
      const result = aggregate([evidenceRow({ eventType: "neutral" }), evidenceRow({ eventType: "neutral" })]);
      const a = result[0]!;
      expect(a.neutralCount).toBe(2);
      expect(a.directionalEvidenceCount).toBe(0);
      expect(a.supportingRatio).toBeNull();
      expect(a.contradictingRatio).toBeNull();
      expect(a.neutralRatio).toBe(1);
      expect(a.evidenceBalance).toBe("neutral_only");
    });
  });

  describe("evidence balance — exact matrix", () => {
    it("supporting_only (multiple supporting, zero contradicting)", () => {
      const result = aggregate([evidenceRow({ eventType: "supporting" }), evidenceRow({ eventType: "supporting" }), evidenceRow({ eventType: "neutral" })]);
      expect(result[0]!.evidenceBalance).toBe("supporting_only");
    });

    it("contradicting_only (multiple contradicting, zero supporting)", () => {
      const result = aggregate([evidenceRow({ eventType: "contradicting" }), evidenceRow({ eventType: "contradicting" })]);
      expect(result[0]!.evidenceBalance).toBe("contradicting_only");
    });

    it("supporting_majority (2 supporting, 1 contradicting)", () => {
      const result = aggregate([evidenceRow({ eventType: "supporting" }), evidenceRow({ eventType: "supporting" }), evidenceRow({ eventType: "contradicting" })]);
      expect(result[0]!.evidenceBalance).toBe("supporting_majority");
    });

    it("contradicting_majority (2 contradicting, 1 supporting)", () => {
      const result = aggregate([evidenceRow({ eventType: "contradicting" }), evidenceRow({ eventType: "contradicting" }), evidenceRow({ eventType: "supporting" })]);
      expect(result[0]!.evidenceBalance).toBe("contradicting_majority");
    });

    it("balanced (equal support/contradiction, both > 0)", () => {
      const result = aggregate([evidenceRow({ eventType: "supporting" }), evidenceRow({ eventType: "contradicting" })]);
      expect(result[0]!.evidenceBalance).toBe("balanced");
      expect(result[0]!.supportingCount).toBe(1);
      expect(result[0]!.contradictingCount).toBe(1);
    });
  });

  describe("ratios — exact, no rounding", () => {
    it("1 supporting / 2 contradicting -> exact thirds, not rounded", () => {
      const result = aggregate([evidenceRow({ eventType: "supporting" }), evidenceRow({ eventType: "contradicting" }), evidenceRow({ eventType: "contradicting" })]);
      const a = result[0]!;
      expect(a.supportingRatio).toBeCloseTo(1 / 3, 15);
      expect(a.contradictingRatio).toBeCloseTo(2 / 3, 15);
      expect(a.supportingRatio).toBe(1 / 3); // exact IEEE754 value, not a rounded display value
    });

    it("neutralRatio computed over evidenceCount, not directionalEvidenceCount", () => {
      const result = aggregate([evidenceRow({ eventType: "supporting" }), evidenceRow({ eventType: "neutral" }), evidenceRow({ eventType: "neutral" }), evidenceRow({ eventType: "neutral" })]);
      const a = result[0]!;
      expect(a.evidenceCount).toBe(4);
      expect(a.neutralRatio).toBe(3 / 4);
      expect(a.supportingRatio).toBe(1); // 1/1 directional
    });
  });

  describe("grouping — detector rule and version separation", () => {
    it("multiple detector rules produce separate aggregates", () => {
      const result = aggregate([evidenceRow({ detectorRuleId: "rule_a" }), evidenceRow({ detectorRuleId: "rule_b" })]);
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.detectorRuleId).sort()).toEqual(["rule_a", "rule_b"]);
    });

    it("same rule, different versions -> NEVER merged", () => {
      const result = aggregate([
        evidenceRow({ detectorRuleId: "rule_a", detectorRuleVersion: "1.0.0", eventType: "supporting" }),
        evidenceRow({ detectorRuleId: "rule_a", detectorRuleVersion: "2.0.0", eventType: "contradicting" }),
      ]);
      expect(result).toHaveLength(2);
      const v1 = result.find((a) => a.detectorRuleVersion === "1.0.0")!;
      const v2 = result.find((a) => a.detectorRuleVersion === "2.0.0")!;
      expect(v1.supportingCount).toBe(1);
      expect(v1.contradictingCount).toBe(0);
      expect(v2.supportingCount).toBe(0);
      expect(v2.contradictingCount).toBe(1);
    });

    it("locked scenario: ruleA@1.0.0 -> 2 supporting, ruleA@2.0.0 -> 1 contradicting, ruleB@1.0.0 -> 1 neutral -> exactly 3 aggregates", () => {
      const result = aggregate([
        evidenceRow({ detectorRuleId: "ruleA", detectorRuleVersion: "1.0.0", eventType: "supporting" }),
        evidenceRow({ detectorRuleId: "ruleA", detectorRuleVersion: "1.0.0", eventType: "supporting" }),
        evidenceRow({ detectorRuleId: "ruleA", detectorRuleVersion: "2.0.0", eventType: "contradicting" }),
        evidenceRow({ detectorRuleId: "ruleB", detectorRuleVersion: "1.0.0", eventType: "neutral" }),
      ]);
      expect(result).toHaveLength(3);
      const a1 = result.find((a) => a.detectorRuleId === "ruleA" && a.detectorRuleVersion === "1.0.0")!;
      const a2 = result.find((a) => a.detectorRuleId === "ruleA" && a.detectorRuleVersion === "2.0.0")!;
      const b1 = result.find((a) => a.detectorRuleId === "ruleB" && a.detectorRuleVersion === "1.0.0")!;
      expect(a1.supportingCount).toBe(2);
      expect(a2.contradictingCount).toBe(1);
      expect(b1.neutralCount).toBe(1);
    });
  });

  describe("range invariant — inclusive boundaries", () => {
    it("eventDate === range.fromDate is accepted", () => {
      expect(() => aggregate([evidenceRow({ eventDate: RANGE.fromDate })])).not.toThrow();
    });

    it("eventDate === range.toDate is accepted", () => {
      expect(() => aggregate([evidenceRow({ eventDate: RANGE.toDate })])).not.toThrow();
    });

    it("eventDate one day before range.fromDate fails loud, never silently filtered", () => {
      expect(() => aggregate([evidenceRow({ eventDate: "2026-05-31" })])).toThrow(EvidenceOutsideAggregationRangeError);
    });

    it("eventDate one day after range.toDate fails loud", () => {
      expect(() => aggregate([evidenceRow({ eventDate: "2026-07-01" })])).toThrow(EvidenceOutsideAggregationRangeError);
    });
  });

  describe("athlete scope", () => {
    it("a row belonging to a different athlete fails loud, never silently discarded", () => {
      expect(() => aggregate([evidenceRow({ athleteId: "athlete-b" })], ATHLETE_A)).toThrow(AggregationAthleteScopeMismatchError);
    });
  });

  describe("duplicates", () => {
    it("duplicate identityId fails loud", () => {
      const sharedId = nextId("identity");
      expect(() =>
        aggregate([evidenceRow({ identityId: sharedId, evidenceKey: "k1" }), evidenceRow({ identityId: sharedId, evidenceKey: "k2" })])
      ).toThrow(DuplicateEffectiveEvidenceIdentityError);
    });

    it("duplicate evidenceKey within the SAME (rule, version) group fails loud", () => {
      expect(() =>
        aggregate([evidenceRow({ evidenceKey: "shared-key", detectorRuleId: "rule_a" }), evidenceRow({ evidenceKey: "shared-key", detectorRuleId: "rule_a" })])
      ).toThrow(DuplicateEffectiveEvidenceKeyError);
    });

    it("the SAME evidenceKey string across DIFFERENT (rule, version) groups is allowed — duplicate-key detection is scoped per group", () => {
      expect(() =>
        aggregate([evidenceRow({ evidenceKey: "shared-key", detectorRuleId: "rule_a" }), evidenceRow({ evidenceKey: "shared-key", detectorRuleId: "rule_b" })])
      ).not.toThrow();
    });
  });

  describe("deterministic ordering", () => {
    it("aggregates are sorted by detectorRuleId ASC, then detectorRuleVersion ASC", () => {
      const result = aggregate([
        evidenceRow({ detectorRuleId: "rule_c", detectorRuleVersion: "1.0.0" }),
        evidenceRow({ detectorRuleId: "rule_a", detectorRuleVersion: "2.0.0" }),
        evidenceRow({ detectorRuleId: "rule_a", detectorRuleVersion: "1.0.0" }),
      ]);
      expect(result.map((a) => `${a.detectorRuleId}@${a.detectorRuleVersion}`)).toEqual(["rule_a@1.0.0", "rule_a@2.0.0", "rule_c@1.0.0"]);
    });

    it("source refs are sorted by eventDate ASC, evidenceKey ASC, identityId ASC, revisionId ASC", () => {
      const result = aggregate([
        evidenceRow({ eventDate: "2026-06-15", evidenceKey: "z-key" }),
        evidenceRow({ eventDate: "2026-06-10", evidenceKey: "a-key" }),
        evidenceRow({ eventDate: "2026-06-10", evidenceKey: "b-key" }),
      ]);
      const refs = result[0]!.sourceEvidenceRefs;
      expect(refs.map((r) => `${r.eventDate}:${r.evidenceKey}`)).toEqual(["2026-06-10:a-key", "2026-06-10:b-key", "2026-06-15:z-key"]);
    });

    it("shuffling the input array produces byte-equivalent output (full deep-equal, including source-ref order)", () => {
      const rows = [
        evidenceRow({ detectorRuleId: "rule_a", eventDate: "2026-06-05", eventType: "supporting" }),
        evidenceRow({ detectorRuleId: "rule_b", eventDate: "2026-06-12", eventType: "contradicting" }),
        evidenceRow({ detectorRuleId: "rule_a", eventDate: "2026-06-20", eventType: "neutral" }),
      ];
      const forward = aggregate(rows);
      const shuffled = aggregate([rows[2]!, rows[0]!, rows[1]!]);
      expect(shuffled).toEqual(forward);
    });
  });

  describe("observedValue non-consumption", () => {
    it("changing ONLY observedValue does not change grouping/counts/ratios/balance/dates/ordering", () => {
      const rowsA = [
        evidenceRow({ identityId: "id-1", evidenceKey: "k1", eventType: "supporting", eventDate: "2026-06-05", observedValue: { a: 1 } }),
        evidenceRow({ identityId: "id-2", evidenceKey: "k2", eventType: "contradicting", eventDate: "2026-06-15", observedValue: { b: [1, 2, 3] } }),
      ];
      const rowsB = rowsA.map((r) => ({ ...r, observedValue: { totally: "different", shape: 42, nested: { x: true } } }));
      expect(aggregate(rowsB)).toEqual(aggregate(rowsA));
    });
  });

  describe("exact output shapes", () => {
    it("PatternEvidenceAggregate has exactly 17 fields", () => {
      const result = aggregate([evidenceRow()]);
      expect(Object.keys(result[0]!).sort()).toEqual(
        [
          "athleteId",
          "detectorRuleId",
          "detectorRuleVersion",
          "rangeFromDate",
          "rangeToDate",
          "evidenceCount",
          "supportingCount",
          "contradictingCount",
          "neutralCount",
          "directionalEvidenceCount",
          "supportingRatio",
          "contradictingRatio",
          "neutralRatio",
          "evidenceBalance",
          "firstEventDate",
          "lastEventDate",
          "sourceEvidenceRefs",
        ].sort()
      );
    });

    it("PatternEvidenceAggregateSourceRef has exactly 7 fields", () => {
      const result = aggregate([evidenceRow()]);
      expect(Object.keys(result[0]!.sourceEvidenceRefs[0]!).sort()).toEqual(
        ["identityId", "revisionId", "revisionNumber", "evaluationKey", "evidenceKey", "eventType", "eventDate"].sort()
      );
    });

    it("rangeFromDate/rangeToDate echo the caller's own range verbatim", () => {
      const result = aggregate([evidenceRow()]);
      expect(result[0]!.rangeFromDate).toBe(RANGE.fromDate);
      expect(result[0]!.rangeToDate).toBe(RANGE.toDate);
    });
  });

  describe("first/last event dates", () => {
    it("computes the min/max eventDate across the group, independent of input order", () => {
      const result = aggregate([
        evidenceRow({ eventDate: "2026-06-15" }),
        evidenceRow({ eventDate: "2026-06-03" }),
        evidenceRow({ eventDate: "2026-06-28" }),
        evidenceRow({ eventDate: "2026-06-10" }),
      ]);
      expect(result[0]!.firstEventDate).toBe("2026-06-03");
      expect(result[0]!.lastEventDate).toBe("2026-06-28");
    });

    it("a single row has firstEventDate === lastEventDate", () => {
      const result = aggregate([evidenceRow({ eventDate: "2026-06-14" })]);
      expect(result[0]!.firstEventDate).toBe("2026-06-14");
      expect(result[0]!.lastEventDate).toBe("2026-06-14");
    });
  });

  describe("no fake zero-count aggregate", () => {
    it("does not invent an aggregate for a detector rule with zero evidence", () => {
      const result = aggregate([evidenceRow({ detectorRuleId: "rule_a" })]);
      expect(result.every((a) => a.evidenceCount > 0)).toBe(true);
    });
  });

  describe("event type exhaustiveness (defense in depth)", () => {
    it("all three event types tally correctly in one mixed group", () => {
      const types: PatternEvidenceEventType[] = ["supporting", "contradicting", "neutral", "supporting", "neutral"];
      const result = aggregate(types.map((eventType) => evidenceRow({ eventType })));
      const a = result[0]!;
      expect(a.supportingCount).toBe(2);
      expect(a.contradictingCount).toBe(1);
      expect(a.neutralCount).toBe(2);
      expect(a.evidenceCount).toBe(5);
    });
  });
});
