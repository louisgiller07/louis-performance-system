// UX-03 — athlete-facing session duration, as a rider says it:
// 45 → "45 min", 90 → "1 h 30", 120 → "2 h". Non-breaking spaces so a
// duration never splits across two lines. Presentation only.
const NBSP = " ";

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return `0${NBSP}min`;
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}${NBSP}min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours}${NBSP}h` : `${hours}${NBSP}h${NBSP}${String(rest).padStart(2, "0")}`;
}
