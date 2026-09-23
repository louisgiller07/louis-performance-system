// V0.5_028 — presentation-only helpers shared by the review components.
// Never business logic, never a data source of its own — purely mechanical
// string formatting over values the repository already delivered.

/**
 * Turns a snake_case/SCREAMING_SNAKE_CASE value (a catalogue id like
 * "bodyweight_squat", or an enum value like "STRENGTH_LOWER") into a
 * readable label. No translation table, nothing invented — the repository
 * never exposes a human-readable exercise/drill name (V0.5_026/027: no
 * catalogue lookup is available to web/), so this is the honest, minimal
 * fallback: reformat the real id/enum string itself, never fabricate a new
 * one.
 */
export function humanizeLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Parses a bare YYYY-MM-DD as a local calendar date — never `new Date(dateString)`, which reads it as UTC midnight and can render the wrong day near a timezone boundary (same discipline as history/HistoryList.tsx). */
export function parseLocalDate(dateISO: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}

const DATE_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "numeric", month: "short" });

export function formatShortDate(dateISO: string): string {
  return DATE_FORMAT.format(parseLocalDate(dateISO));
}
