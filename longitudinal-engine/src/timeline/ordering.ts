/**
 * Deterministic sort helpers. Every sort site in this package chains
 * enough tie-break fields down to a row's own `id` that input-array order
 * never affects output — see buildTimeline.ts's own tests for the
 * shuffled-input-array proof.
 */

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Builds a comparator that compares by each selector in order, falling through on ties. */
export function byFields<T>(...selectors: ReadonlyArray<(item: T) => string>): (a: T, b: T) => number {
  return (a, b) => {
    for (const selector of selectors) {
      const cmp = compareStrings(selector(a), selector(b));
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
}

/** Sorts a copy of `items` — never mutates the input array. */
export function sortedBy<T>(items: readonly T[], ...selectors: ReadonlyArray<(item: T) => string>): T[] {
  return [...items].sort(byFields(...selectors));
}
