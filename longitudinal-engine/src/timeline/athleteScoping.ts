/**
 * buildTimeline's ownership boundary — mirrors the same "never implicit"
 * discipline as the M5_002A Supabase adapter's `.eq("athlete_id", ...)` on
 * every query, but enforced here at the pure-function boundary: every row
 * in every supplied source family must already belong to the athlete the
 * caller declared. A caller accidentally mixing rows from two athletes
 * (e.g. a bug in how the caller queried the adapter) must fail loudly, not
 * silently produce a timeline that blends two athletes' facts.
 */

const MAX_OFFENDING_IDS_PER_SOURCE = 10;

export class TimelineAthleteMismatchError extends Error {
  readonly expectedAthleteId: string;
  /** Source family name -> offending row ids, capped at 10 per family. Only families with at least one mismatch are present. */
  readonly offendingSources: Readonly<Record<string, readonly string[]>>;

  constructor(expectedAthleteId: string, offendingSources: Readonly<Record<string, readonly string[]>>) {
    const summary = Object.entries(offendingSources)
      .map(([family, ids]) => `${family}: [${ids.join(", ")}]`)
      .join("; ");
    super(`TimelineAthleteMismatchError: expected athleteId "${expectedAthleteId}", mismatched rows in ${summary}`);
    this.name = "TimelineAthleteMismatchError";
    this.expectedAthleteId = expectedAthleteId;
    this.offendingSources = offendingSources;
  }
}

/**
 * Validates every source family in one pass and throws a single
 * {@link TimelineAthleteMismatchError} listing every family that has a
 * mismatch (not just the first one found), each capped at 10 offending
 * ids. Empty arrays are always valid.
 */
export function assertAthleteScoped(
  sourcesByFamily: Readonly<Record<string, readonly { readonly id: string; readonly athleteId: string }[]>>,
  athleteId: string
): void {
  const offendingSources: Record<string, string[]> = {};

  for (const [family, rows] of Object.entries(sourcesByFamily)) {
    const offendingIds: string[] = [];
    for (const row of rows) {
      if (row.athleteId !== athleteId && offendingIds.length < MAX_OFFENDING_IDS_PER_SOURCE) {
        offendingIds.push(row.id);
      }
    }
    if (offendingIds.length > 0) offendingSources[family] = offendingIds;
  }

  if (Object.keys(offendingSources).length > 0) {
    throw new TimelineAthleteMismatchError(athleteId, offendingSources);
  }
}
