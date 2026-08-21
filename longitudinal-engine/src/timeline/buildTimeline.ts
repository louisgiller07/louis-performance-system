import type { AthleteTimeline, BuildTimelineInput } from "./types.js";
import { assertAthleteScoped } from "./athleteScoping.js";
import { materializeDateRange } from "./range.js";
import { indexById, groupByDate, filterInDateSet } from "./partitioning.js";
import { assembleDay } from "./assembleDay.js";
import { buildDecisionThreads } from "./decisionThread.js";
import { buildHealthFlagThreads } from "./healthFlagThread.js";
import { buildProvenance } from "./provenance.js";

/**
 * Assembles an AthleteTimeline from already-fetched M5_002A source facts.
 * Pure function: no I/O, no clock, no randomness. Validates its own inputs
 * (range well-formedness, athlete scoping, decision_outcomes referential
 * consistency) and fails loudly rather than silently dropping or
 * misattributing a source fact — see range.ts, athleteScoping.ts and
 * decisionThread.ts for the specific errors this can throw.
 *
 * RANGE SCOPING: checkins/decisions/completedSessions are each range-scoped
 * by their own date column (checkinDate/decisionDate/sessionDate ∈ range)
 * before anything downstream — day assembly, decision threads, and every
 * FK resolution — ever sees them. A decision whose decisionDate falls
 * outside `range` gets no DecisionThread, even if it's present in
 * `sources.decisions`; a link (completedSession→decision,
 * decision→sourceCheckin) that would resolve to a row outside `range`
 * comes back `absent/source_missing_in_pool`, exactly like a link that
 * points to a row genuinely missing from the supplied sources — an
 * out-of-range row is, from this range's perspective, not in the pool.
 * `healthFlags` are the one deliberate exception: they stay unfiltered
 * here, since M5_002A already supplies them via lifecycle overlap (a flag
 * opened before `range.fromDate` and still unresolved is meant to remain
 * visible) — see healthContext.ts. `provenance.sourceCounts` still reports
 * the raw, unscoped lengths of every supplied source array.
 */
export function buildTimeline(input: BuildTimelineInput): AthleteTimeline {
  const { athleteId, range, sources } = input;

  const dates = materializeDateRange(range);
  const dateSet = new Set(dates);

  assertAthleteScoped(
    {
      checkins: sources.checkins,
      decisions: sources.decisions,
      completedSessions: sources.completedSessions,
      outcomes: sources.outcomes,
      healthFlags: sources.healthFlags,
    },
    athleteId
  );

  const rangeScopedCheckins = filterInDateSet(sources.checkins, (c) => c.checkinDate, dateSet);
  const rangeScopedDecisions = filterInDateSet(sources.decisions, (d) => d.decisionDate, dateSet);
  const rangeScopedCompletedSessions = filterInDateSet(sources.completedSessions, (s) => s.sessionDate, dateSet);

  const checkinsById = indexById(rangeScopedCheckins);
  const decisionsById = indexById(rangeScopedDecisions);

  const checkinsByDate = groupByDate(rangeScopedCheckins, (c) => c.checkinDate);
  const decisionsByDate = groupByDate(rangeScopedDecisions, (d) => d.decisionDate);
  const completedSessionsByDate = groupByDate(rangeScopedCompletedSessions, (s) => s.sessionDate);

  const days = dates.map((date) =>
    assembleDay(date, checkinsByDate, decisionsByDate, completedSessionsByDate, decisionsById, sources.healthFlags)
  );

  const decisionThreads = buildDecisionThreads(
    rangeScopedDecisions,
    checkinsById,
    rangeScopedCompletedSessions,
    sources.outcomes
  );
  const healthFlagThreads = buildHealthFlagThreads(sources.healthFlags, checkinsById);

  const provenance = buildProvenance(sources, dates.length, days, decisionThreads, healthFlagThreads);

  return { athleteId, range, days, decisionThreads, healthFlagThreads, provenance };
}
