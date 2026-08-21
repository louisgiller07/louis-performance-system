import type { AthleteDay, DecisionThread, HealthFlagThread, Link, TimelineProvenance, TimelineSources } from "./types.js";
import { TIMELINE_BUILDER_VERSION } from "./constants.js";

function tally(counts: { explicit: number; absent: number }, link: Link<unknown>): void {
  if (link.kind === "explicit") counts.explicit += 1;
  else counts.absent += 1;
}

/**
 * Deterministic only — derived entirely from the already-built timeline
 * pieces, no clock (`TIMELINE_BUILDER_VERSION` is a fixed constant, not a
 * build timestamp). `linkCounts` covers exactly the three Link<T> sites
 * (CompletedSessionOnDay.linkedDecision, DecisionThread.linkedSourceCheckin,
 * HealthFlagThread.linkedSourceCheckin); `linkedCompletedSessionsMatched` —
 * the reverse decision→sessions match, which is a plain array, not a
 * Link<T> — is counted separately.
 *
 * `sourceCounts` reports the RAW supplied `sources` lengths — deliberately
 * not range-scoped — so a caller can always tell how much was actually
 * handed to buildTimeline, independent of how much of it fell inside
 * `range` (see buildTimeline.ts for the range-scoping applied elsewhere).
 */
export function buildProvenance(
  sources: TimelineSources,
  rangeDaysMaterialized: number,
  days: readonly AthleteDay[],
  decisionThreads: readonly DecisionThread[],
  healthFlagThreads: readonly HealthFlagThread[]
): TimelineProvenance {
  const linkCounts = { explicit: 0, absent: 0 };

  for (const day of days) {
    for (const completedSessionOnDay of day.completedSessions) {
      tally(linkCounts, completedSessionOnDay.linkedDecision);
    }
  }
  for (const thread of decisionThreads) tally(linkCounts, thread.linkedSourceCheckin);
  for (const thread of healthFlagThreads) tally(linkCounts, thread.linkedSourceCheckin);

  const linkedCompletedSessionsMatched = decisionThreads.reduce(
    (sum, thread) => sum + thread.linkedCompletedSessions.length,
    0
  );

  return {
    builderVersion: TIMELINE_BUILDER_VERSION,
    rangeDaysMaterialized,
    sourceCounts: {
      checkins: sources.checkins.length,
      decisions: sources.decisions.length,
      completedSessions: sources.completedSessions.length,
      outcomes: sources.outcomes.length,
      healthFlags: sources.healthFlags.length,
    },
    linkCounts,
    linkedCompletedSessionsMatched,
  };
}
