import { beforeEach, describe, expect, it } from "vitest";
import { buildPatternInsightCandidates, UnsupportedPatternInsightProjectorError, PATTERN_INSIGHT_PROJECTOR_VERSION } from "../../../src/insights/index.js";
import type { PatternInsightCandidate, PatternInsightReviewRecord, PatternInsightSnapshot } from "../../../src/insights/index.js";
import type { PatternEvidenceAggregate, PatternEvidenceAggregateSourceRef, PatternEvidenceBalance } from "../../../src/aggregation/index.js";
import { nextId, resetIdSequence } from "../timeline/fixtures.js";

beforeEach(() => resetIdSequence());

const ATHLETE_A = "athlete-a";
const RANGE = { fromDate: "2026-06-01", toDate: "2026-06-30" };

const RECOMMENDATION_RULE_ID = "recommendation_vs_actual_execution";
const SLEEP_RULE_ID = "sleep_quality_to_same_day_energy_correlation";
const PAIN_RULE_ID = "pain_persistence_across_recent_checkins";
const RULE_VERSION = "1.0.0";

function sourceRef(overrides: Partial<PatternEvidenceAggregateSourceRef> = {}): PatternEvidenceAggregateSourceRef {
  return {
    identityId: nextId("identity"),
    revisionId: nextId("revision"),
    revisionNumber: 1,
    evaluationKey: nextId("eval"),
    evidenceKey: nextId("evidence"),
    eventType: "supporting",
    eventDate: "2026-06-10",
    ...overrides,
  };
}

function aggregateFixture(overrides: Partial<PatternEvidenceAggregate> = {}): PatternEvidenceAggregate {
  return {
    athleteId: ATHLETE_A,
    detectorRuleId: RECOMMENDATION_RULE_ID,
    detectorRuleVersion: RULE_VERSION,
    rangeFromDate: RANGE.fromDate,
    rangeToDate: RANGE.toDate,
    evidenceCount: 1,
    supportingCount: 1,
    contradictingCount: 0,
    neutralCount: 0,
    directionalEvidenceCount: 1,
    supportingRatio: 1,
    contradictingRatio: 0,
    neutralRatio: 0,
    evidenceBalance: "supporting_only",
    firstEventDate: "2026-06-10",
    lastEventDate: "2026-06-10",
    sourceEvidenceRefs: [sourceRef()],
    ...overrides,
  };
}

function build(aggregates: readonly PatternEvidenceAggregate[], currentReviews: readonly PatternInsightReviewRecord[] = []): readonly PatternInsightCandidate[] {
  return buildPatternInsightCandidates({ aggregates, currentReviews });
}

describe("buildPatternInsightCandidates", () => {
  describe("supported projectors — exact 3 pairs", () => {
    it("recommendation_vs_actual_execution@1.0.0 -> recommendation_execution_alignment", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID, detectorRuleVersion: RULE_VERSION })]);
      expect(c!.snapshot.insightKind).toBe("recommendation_execution_alignment");
    });

    it("sleep_quality_to_same_day_energy_correlation@1.0.0 -> sleep_energy_same_day_association", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID, detectorRuleVersion: RULE_VERSION })]);
      expect(c!.snapshot.insightKind).toBe("sleep_energy_same_day_association");
    });

    it("pain_persistence_across_recent_checkins@1.0.0 -> pain_persistence_between_recent_checkins", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: PAIN_RULE_ID, detectorRuleVersion: RULE_VERSION })]);
      expect(c!.snapshot.insightKind).toBe("pain_persistence_between_recent_checkins");
    });
  });

  describe("unsupported detector/version — fails loud", () => {
    it("unrecognized detectorRuleId throws UnsupportedPatternInsightProjectorError", () => {
      expect(() => build([aggregateFixture({ detectorRuleId: "totally_unknown_rule" })])).toThrow(UnsupportedPatternInsightProjectorError);
    });

    it("recognized detectorRuleId but unrecognized version throws", () => {
      expect(() => build([aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID, detectorRuleVersion: "2.0.0" })])).toThrow(UnsupportedPatternInsightProjectorError);
    });

    it("no generic fallback — the error names the exact rule/version", () => {
      expect(() => build([aggregateFixture({ detectorRuleId: "x", detectorRuleVersion: "y" })])).toThrow(/x@y/);
    });
  });

  describe("direction mapping — exact, all 6 evidenceBalance values", () => {
    const cases: Array<{ balance: PatternEvidenceBalance; direction: string }> = [
      { balance: "supporting_only", direction: "supporting" },
      { balance: "supporting_majority", direction: "supporting" },
      { balance: "contradicting_only", direction: "contradicting" },
      { balance: "contradicting_majority", direction: "contradicting" },
      { balance: "balanced", direction: "mixed" },
      { balance: "neutral_only", direction: "neutral" },
    ];

    for (const { balance, direction } of cases) {
      it(`${balance} -> ${direction}`, () => {
        const [c] = build([aggregateFixture({ evidenceBalance: balance })]);
        expect(c!.snapshot.direction).toBe(direction);
      });
    }
  });

  describe("exact copy — recommendation_execution_alignment", () => {
    it("title", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID })]);
      expect(c!.snapshot.title).toBe("Exécution des recommandations");
    });

    it("supporting statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID, evidenceBalance: "supporting_only" })]);
      expect(c!.snapshot.statement).toBe("Parmi les observations directionnelles disponibles, les séances recommandées sont le plus souvent réalisées comme prévu.");
    });

    it("contradicting statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID, evidenceBalance: "contradicting_only" })]);
      expect(c!.snapshot.statement).toBe(
        "Parmi les observations directionnelles disponibles, les séances recommandées sont plus souvent remplacées ou sautées qu’exécutées comme prévu."
      );
    });

    it("mixed statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID, evidenceBalance: "balanced" })]);
      expect(c!.snapshot.statement).toBe("L’exécution réelle des séances recommandées est partagée entre concordance et divergence.");
    });

    it("neutral statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID, evidenceBalance: "neutral_only" })]);
      expect(c!.snapshot.statement).toBe("Les observations disponibles sont uniquement neutres pour l’exécution des recommandations.");
    });

    it("exact caveats", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID })]);
      expect(c!.snapshot.caveats).toEqual(["Décrit l’exécution observée, pas la qualité de la recommandation ni le comportement de l’athlète."]);
    });
  });

  describe("exact copy — sleep_energy_same_day_association", () => {
    it("title", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID })]);
      expect(c!.snapshot.title).toBe("Sommeil et énergie");
    });

    it("supporting statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID, evidenceBalance: "supporting_majority" })]);
      expect(c!.snapshot.statement).toBe(
        "Parmi les observations directionnelles disponibles, elles vont le plus souvent dans le sens d’une association positive entre qualité du sommeil et énergie le même jour."
      );
    });

    it("contradicting statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID, evidenceBalance: "contradicting_majority" })]);
      expect(c!.snapshot.statement).toBe(
        "Parmi les observations directionnelles disponibles, elles vont le plus souvent à l’encontre d’une association positive entre qualité du sommeil et énergie le même jour."
      );
    });

    it("mixed statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID, evidenceBalance: "balanced" })]);
      expect(c!.snapshot.statement).toBe("Les observations sommeil-énergie sont partagées entre soutien et contradiction.");
    });

    it("neutral statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID, evidenceBalance: "neutral_only" })]);
      expect(c!.snapshot.statement).toBe("Les observations sommeil-énergie disponibles sont uniquement neutres.");
    });

    it("exact caveats", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: SLEEP_RULE_ID })]);
      expect(c!.snapshot.caveats).toEqual(["Association descriptive uniquement ; aucune causalité n’est inférée."]);
    });
  });

  describe("exact copy — pain_persistence_between_recent_checkins", () => {
    it("title", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: PAIN_RULE_ID })]);
      expect(c!.snapshot.title).toBe("Persistance de la douleur");
    });

    it("supporting statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: PAIN_RULE_ID, evidenceBalance: "supporting_only" })]);
      expect(c!.snapshot.statement).toBe(
        "Parmi les observations directionnelles disponibles, la même douleur est le plus souvent encore signalée au check-in suivant observé, dans un intervalle maximal de 3 jours."
      );
    });

    it("contradicting statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: PAIN_RULE_ID, evidenceBalance: "contradicting_only" })]);
      expect(c!.snapshot.statement).toBe(
        "Parmi les observations directionnelles disponibles, la douleur est plus souvent résolue au check-in suivant observé qu’encore signalée au même endroit."
      );
    });

    it("mixed statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: PAIN_RULE_ID, evidenceBalance: "balanced" })]);
      expect(c!.snapshot.statement).toBe("Les observations de persistance de la douleur sont partagées entre continuation et résolution.");
    });

    it("neutral statement", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: PAIN_RULE_ID, evidenceBalance: "neutral_only" })]);
      expect(c!.snapshot.statement).toBe("Les observations disponibles de persistance de la douleur sont uniquement neutres ou ambiguës.");
    });

    it("exact caveats (2 entries)", () => {
      const [c] = build([aggregateFixture({ detectorRuleId: PAIN_RULE_ID })]);
      expect(c!.snapshot.caveats).toEqual([
        "Ne prouve pas une douleur continue pendant les jours sans check-in.",
        "Ne remplace jamais les règles Safety, un diagnostic ou un avis professionnel.",
      ]);
    });
  });

  describe("no threshold — every aggregate produces exactly one candidate", () => {
    it("a single-evidence aggregate still produces a candidate", () => {
      const result = build([aggregateFixture({ evidenceCount: 1 })]);
      expect(result).toHaveLength(1);
    });

    it("empty aggregates -> []", () => {
      expect(build([])).toEqual([]);
    });

    it("N aggregates -> exactly N candidates", () => {
      const result = build([
        aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID }),
        aggregateFixture({ detectorRuleId: SLEEP_RULE_ID }),
        aggregateFixture({ detectorRuleId: PAIN_RULE_ID }),
      ]);
      expect(result).toHaveLength(3);
    });
  });

  describe("exact snapshot shape", () => {
    it("exactly 23 keys, no extra fields", () => {
      const [c] = build([aggregateFixture()]);
      const keys = Object.keys(c!.snapshot).sort();
      expect(keys).toEqual(
        [
          "athleteId",
          "caveats",
          "contradictingCount",
          "contradictingRatio",
          "detectorRuleId",
          "detectorRuleVersion",
          "direction",
          "directionalEvidenceCount",
          "evidenceBalance",
          "evidenceCount",
          "firstEventDate",
          "insightKind",
          "insightProjectorVersion",
          "lastEventDate",
          "neutralCount",
          "neutralRatio",
          "rangeFromDate",
          "rangeToDate",
          "sourceEvidenceRefs",
          "statement",
          "supportingCount",
          "supportingRatio",
          "title",
        ].sort()
      );
    });

    it("insightProjectorVersion is the locked constant", () => {
      const [c] = build([aggregateFixture()]);
      expect(c!.snapshot.insightProjectorVersion).toBe(PATTERN_INSIGHT_PROJECTOR_VERSION);
    });

    it("sourceEvidenceRefs is passed through verbatim from the aggregate", () => {
      const refs = [sourceRef({ evidenceKey: "verbatim-check" })];
      const [c] = build([aggregateFixture({ sourceEvidenceRefs: refs })]);
      expect(c!.snapshot.sourceEvidenceRefs).toBe(refs);
    });
  });

  describe("deterministic ordering", () => {
    it("sorted by detectorRuleId ASC, detectorRuleVersion ASC, insightKind ASC", () => {
      const result = build([
        aggregateFixture({ detectorRuleId: SLEEP_RULE_ID }),
        aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID }),
        aggregateFixture({ detectorRuleId: PAIN_RULE_ID }),
      ]);
      expect(result.map((c) => c.snapshot.detectorRuleId)).toEqual([PAIN_RULE_ID, RECOMMENDATION_RULE_ID, SLEEP_RULE_ID].sort());
    });

    it("input shuffle invariance — reversed input order produces the identical sorted output", () => {
      const inputs = [
        aggregateFixture({ detectorRuleId: SLEEP_RULE_ID }),
        aggregateFixture({ detectorRuleId: RECOMMENDATION_RULE_ID }),
        aggregateFixture({ detectorRuleId: PAIN_RULE_ID }),
      ];
      const forward = build(inputs);
      const reversed = build([...inputs].reverse());
      expect(reversed.map((c) => c.snapshot.detectorRuleId)).toEqual(forward.map((c) => c.snapshot.detectorRuleId));
    });
  });

  describe("review state derivation", () => {
    function reviewFor(snapshot: PatternInsightSnapshot, overrides: Partial<PatternInsightReviewRecord> = {}): PatternInsightReviewRecord {
      return {
        athleteId: snapshot.athleteId,
        detectorRuleId: snapshot.detectorRuleId,
        detectorRuleVersion: snapshot.detectorRuleVersion,
        insightKind: snapshot.insightKind,
        decision: "accepted_as_insight",
        reviewNumber: 1,
        reviewerNote: null,
        candidateSnapshot: snapshot,
        ...overrides,
      };
    }

    it("no current review -> unreviewed", () => {
      const [c] = build([aggregateFixture()]);
      expect(c!.reviewState).toBe("unreviewed");
      expect(c!.currentReview).toBeNull();
    });

    it("current review with an exactly matching fingerprint -> reviewed_current", () => {
      const agg = aggregateFixture();
      const [fresh] = build([agg]);
      const review = reviewFor(fresh!.snapshot);
      const [c] = build([agg], [review]);
      expect(c!.reviewState).toBe("reviewed_current");
      expect(c!.currentReview).toEqual(review);
    });

    it("reviewed_stale because the range changed", () => {
      const agg = aggregateFixture();
      const [fresh] = build([agg]);
      const review = reviewFor(fresh!.snapshot);
      const [c] = build([{ ...agg, rangeFromDate: "2026-07-01", rangeToDate: "2026-07-31" }], [review]);
      expect(c!.reviewState).toBe("reviewed_stale");
    });

    it("reviewed_stale because a sourceEvidenceRefs revisionId changed (same identity, superseding revision)", () => {
      const ref = sourceRef({ evidenceKey: "same-identity" });
      const [fresh] = build([aggregateFixture({ sourceEvidenceRefs: [ref] })]);
      const review = reviewFor(fresh!.snapshot);
      const newRef = { ...ref, revisionId: nextId("revision"), revisionNumber: 2 };
      const [c] = build([aggregateFixture({ sourceEvidenceRefs: [newRef] })], [review]);
      expect(c!.reviewState).toBe("reviewed_stale");
    });

    it("reviewed_stale because the insightProjectorVersion changed (a stored review from an older projector)", () => {
      const [fresh] = build([aggregateFixture()]);
      const staleSnapshot: PatternInsightSnapshot = { ...fresh!.snapshot, insightProjectorVersion: "0.9.0" };
      const review = reviewFor(staleSnapshot);
      const [c] = build([aggregateFixture()], [review]);
      expect(c!.reviewState).toBe("reviewed_stale");
    });

    it("a stale accepted_as_insight decision is reported but never upgraded to reviewed_current", () => {
      const agg = aggregateFixture();
      const [fresh] = build([agg]);
      const review = reviewFor(fresh!.snapshot, { decision: "accepted_as_insight" });
      const [c] = build([{ ...agg, rangeToDate: "2026-07-31" }], [review]);
      expect(c!.reviewState).toBe("reviewed_stale");
      expect(c!.currentReview!.decision).toBe("accepted_as_insight");
    });
  });

  describe("review decision never affects candidate projection (non-activation proof)", () => {
    it("accepted_as_insight, dismissed, and needs_more_evidence all produce the identical snapshot for the same aggregate", () => {
      const agg = aggregateFixture();
      const [fresh] = build([agg]);
      function reviewWith(decision: PatternInsightReviewRecord["decision"]): PatternInsightReviewRecord {
        return {
          athleteId: fresh!.snapshot.athleteId,
          detectorRuleId: fresh!.snapshot.detectorRuleId,
          detectorRuleVersion: fresh!.snapshot.detectorRuleVersion,
          insightKind: fresh!.snapshot.insightKind,
          decision,
          reviewNumber: 1,
          reviewerNote: null,
          candidateSnapshot: fresh!.snapshot,
        };
      }

      const [acceptedCandidate] = build([agg], [reviewWith("accepted_as_insight")]);
      const [dismissedCandidate] = build([agg], [reviewWith("dismissed")]);
      const [needsMoreCandidate] = build([agg], [reviewWith("needs_more_evidence")]);

      expect(acceptedCandidate!.snapshot).toEqual(dismissedCandidate!.snapshot);
      expect(dismissedCandidate!.snapshot).toEqual(needsMoreCandidate!.snapshot);
      // Only reviewState/currentReview differ by decision — the projected insight itself never branches on it.
      expect(acceptedCandidate!.reviewState).toBe("reviewed_current");
      expect(dismissedCandidate!.reviewState).toBe("reviewed_current");
      expect(needsMoreCandidate!.reviewState).toBe("reviewed_current");
    });
  });
});
