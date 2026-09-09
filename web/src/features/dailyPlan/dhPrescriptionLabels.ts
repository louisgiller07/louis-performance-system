import type { LoadProfile } from "./dailyPlanTypes";

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

/**
 * Athlete-facing clarification of the existing qualitative LoadProfile —
 * never a claim these are RPE bands or a redefinition of load as duration.
 */
export const DH_LOAD_DESCRIPTION: Record<LoadProfile, string> = {
  LIGHT: "Charge légère — garde de la marge",
  MODERATE: "Charge modérée — soutenue mais maîtrisée",
  HEAVY: "Charge lourde — séance exigeante",
};
