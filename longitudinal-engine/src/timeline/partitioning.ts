/** Small, generic grouping/indexing helpers used to assemble AthleteDay/DecisionThread pools — never mutate the input array. */

export function indexById<T extends { readonly id: string }>(rows: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, row);
  return map;
}

/**
 * Filters `rows` to only those whose `dateOf` value is in `dateSet` — the
 * canonical range-scoping step for checkins/decisions/completedSessions
 * (each scoped by its own date column against the range's materialized
 * day set). Deliberately not used for healthFlags — those stay unfiltered,
 * see healthContext.ts's lifecycle-overlap rule instead.
 */
export function filterInDateSet<T>(rows: readonly T[], dateOf: (row: T) => string, dateSet: ReadonlySet<string>): T[] {
  return rows.filter((row) => dateSet.has(dateOf(row)));
}

export function groupByDate<T>(rows: readonly T[], dateOf: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const date = dateOf(row);
    const bucket = map.get(date);
    if (bucket) bucket.push(row);
    else map.set(date, [row]);
  }
  return map;
}

/** Groups by a nullable key, silently skipping rows whose key is null (a null FK has nothing to group under — see linking.ts for how that absence is surfaced instead). */
export function groupByNullableKey<T>(rows: readonly T[], keyOf: (row: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}
