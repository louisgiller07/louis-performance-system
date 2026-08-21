/**
 * Deterministic longitudinal timeline — pure data shapes. This module (and
 * every module under src/timeline/**) contains no I/O, no clock, no
 * randomness, no interpretation: it only rearranges the M5_002A source
 * facts it is given into a navigable, fully-ordered structure. See
 * docs/11_DECISION_LOG.md (M5_002B) for the full boundary this enforces.
 */
import type {
  CompletedSessionSource,
  DailyCheckinSource,
  DecisionOutcomeHorizon,
  DecisionOutcomeSource,
  DecisionSource,
  HealthFlagSource,
} from "../types/sources.js";
import type { DateRange } from "../types/adapter.js";

/**
 * A resolved (or deliberately unresolved) foreign-key reference.
 * `fk_null`: the FK column itself is null (no relationship was ever
 * recorded). `source_missing_in_pool`: the FK is non-null but no row with
 * that id was found in the supplied source pool (e.g. it points outside
 * the requested date range) — this is a normal, expected outcome for a
 * nullable cross-range link, never an error by itself. Contrast with
 * decision_outcomes.decision_id, which is NOT NULL and is therefore never
 * modeled as a Link — see OrphanedDecisionOutcomeError in decisionThread.ts.
 */
export type Link<T> =
  | { readonly kind: "explicit"; readonly ref: T }
  | { readonly kind: "absent"; readonly reason: "fk_null" | "source_missing_in_pool" };

export interface CompletedSessionOnDay {
  readonly completedSession: CompletedSessionSource;
  readonly linkedDecision: Link<DecisionSource>;
}

/**
 * One calendar day in the requested range. Materialized for every date in
 * `[range.fromDate, range.toDate]`, even when it carries no primary facts
 * at all (see buildTimeline.ts) — a day is a position on the timeline, not
 * merely a container that exists only when something happened.
 */
export interface AthleteDay {
  readonly date: string;
  readonly checkins: readonly DailyCheckinSource[];
  readonly decisions: readonly DecisionSource[];
  readonly completedSessions: readonly CompletedSessionOnDay[];
  /** health_flags whose flagDate === this day. */
  readonly healthEventsCreated: readonly HealthFlagSource[];
  /** health_flags whose resolvedAt === this day. */
  readonly healthEventsResolved: readonly HealthFlagSource[];
  /** health_flags whose [flagDate, resolvedAt ?? open-ended] lifecycle overlaps this day — see healthContext.ts. */
  readonly activeHealthContext: readonly HealthFlagSource[];
}

/** Every decision_outcome for one decision, bucketed by its exact horizon — all three keys always present, even empty. Never collapsed to "latest"/"current". */
export type DecisionOutcomesByHorizon = {
  readonly [H in DecisionOutcomeHorizon]: readonly DecisionOutcomeSource[];
};

/**
 * One append-only decision and everything longitudinally attached to it.
 * `linkedCompletedSessions` is the *reverse* of completed_sessions.decisionId
 * — cardinality 0..N, never collapsed to a single "the" session.
 */
export interface DecisionThread {
  readonly decision: DecisionSource;
  readonly decisionDate: string;
  readonly linkedSourceCheckin: Link<DailyCheckinSource>;
  readonly linkedCompletedSessions: readonly CompletedSessionSource[];
  readonly outcomesByHorizon: DecisionOutcomesByHorizon;
}

export interface HealthFlagThread {
  readonly flag: HealthFlagSource;
  readonly openedOn: string;
  readonly resolvedOn: string | null;
  readonly linkedSourceCheckin: Link<DailyCheckinSource>;
}

export interface TimelineProvenance {
  readonly builderVersion: string;
  readonly rangeDaysMaterialized: number;
  readonly sourceCounts: {
    readonly checkins: number;
    readonly decisions: number;
    readonly completedSessions: number;
    readonly outcomes: number;
    readonly healthFlags: number;
  };
  /**
   * Counts only the three actual Link<T> sites: CompletedSessionOnDay.linkedDecision,
   * DecisionThread.linkedSourceCheckin, HealthFlagThread.linkedSourceCheckin.
   * `linkedCompletedSessionsMatched` (the reverse decision->sessions match) is
   * counted separately, below — it is not a Link<T>.
   */
  readonly linkCounts: {
    readonly explicit: number;
    readonly absent: number;
  };
  readonly linkedCompletedSessionsMatched: number;
}

export interface AthleteTimeline {
  readonly athleteId: string;
  readonly range: DateRange;
  readonly days: readonly AthleteDay[];
  readonly decisionThreads: readonly DecisionThread[];
  readonly healthFlagThreads: readonly HealthFlagThread[];
  readonly provenance: TimelineProvenance;
}

/** The exact source-fact pools buildTimeline assembles into an AthleteTimeline. Every row must belong to `athleteId` — see athleteScoping.ts. */
export interface TimelineSources {
  readonly checkins: readonly DailyCheckinSource[];
  readonly decisions: readonly DecisionSource[];
  readonly completedSessions: readonly CompletedSessionSource[];
  readonly outcomes: readonly DecisionOutcomeSource[];
  readonly healthFlags: readonly HealthFlagSource[];
}

export interface BuildTimelineInput {
  readonly athleteId: string;
  readonly range: DateRange;
  readonly sources: TimelineSources;
}
