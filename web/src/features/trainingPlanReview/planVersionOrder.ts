// UX-11R.9 (F-4) — the canonical order of plan versions is
// training_plan_versions.generated_at (the order of the drafts list and of
// the server's stale-plan guard). A draft is a "new version" of an active
// plan only when it was generated STRICTLY after it; equal or older → stale
// (the server refuses it: stale_plan_version). Microsecond-exact: PostgreSQL
// timestamps carry microseconds that Date alone would drop.

function instant(timestamp: string): { ms: number; micros: number } | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(timestamp.replace(" ", "T"));
  if (!match) return null;
  const zone = match[3] === undefined ? "Z" : match[3].length === 3 ? `${match[3]}:00` : match[3];
  const ms = Date.parse(`${match[1]}${zone}`);
  if (Number.isNaN(ms)) return null;
  return { ms, micros: Number((match[2] ?? "").padEnd(6, "0").slice(0, 6)) };
}

/** `candidate` was generated strictly after `reference`. Unparseable input → false (never offered as new). */
export function isGeneratedAfter(candidate: string, reference: string): boolean {
  const a = instant(candidate);
  const b = instant(reference);
  if (!a || !b) return false;
  return a.ms !== b.ms ? a.ms > b.ms : a.micros > b.micros;
}
