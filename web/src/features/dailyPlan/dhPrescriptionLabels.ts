/**
 * V0.3_006B — Session Prescription V1 (DH-first), web presentation only.
 * `duration_min` on a DH-family `TrainingIntervention` represents the
 * approximate TOTAL SESSION WINDOW (time at the riding venue: descending,
 * uplift/chairlift/shuttle, pauses, waiting, reconnaissance, normal
 * between-run recovery) — never continuous riding time. Kept in minutes
 * internally (the type is unchanged); this formatter only affects display.
 */
export function formatDhSessionWindow(durationMin: number): string {
  const hours = Math.floor(durationMin / 60);
  const minutes = durationMin % 60;
  return minutes === 0 ? `environ ${hours} h` : `environ ${hours} h ${minutes}`;
}

/** V0.3_006C1 — clarifies that the session window includes uplifts/pauses/waiting, never just descent time. Shown under the session-window line in the "Séance DH" card. */
export const DH_SESSION_WINDOW_CAPTION = "Inclut les remontées, pauses et temps d'attente — pas seulement le temps de descente.";
