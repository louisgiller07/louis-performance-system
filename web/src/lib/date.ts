// Local calendar date for the current user — never the server's/UTC date.
// `new Date().toISOString().slice(0, 10)` is deliberately never used here:
// it returns the UTC date, which is wrong for any user not in a UTC-like
// offset (e.g. `2026-08-18T22:30Z` is already `2026-08-19` in
// Europe/Zurich). `timeZone` exists only to make tests deterministic —
// runtime callers omit it and get the browser/device's own timezone.
export function todayLocal(timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("todayLocal: failed to compute a local date.");
  }

  return `${year}-${month}-${day}`;
}
