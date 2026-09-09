import type { LoadProfile } from "../types/trainingIntervention.js";

/**
 * Session Prescription V1 — DH-first (V0.3_006B). PROVISIONAL generic
 * coaching targets, never individualized physiology, never exact limits.
 * See docs/03_COACHING_MODEL.md §Domaine 1 — Technique DH (Session
 * Prescription V1) for the full canonical rationale.
 *
 * `duration_min` for a DH-family kind represents the approximate TOTAL
 * SESSION WINDOW / time at the riding venue — descending, uplift/chairlift/
 * shuttle, pauses, waiting, reconnaissance, and normal between-run recovery
 * all included conceptually. It is explicitly NOT continuous physical work,
 * wheels-moving time, accumulated descent time, or physiological work
 * duration. A ~6h window (e.g. 09:30-16:00) can contain far less actual
 * riding time than that.
 *
 * LoadProfile (HEAVY/MODERATE/LIGHT) remains the existing qualitative
 * overall training-load concept — this table does NOT redefine it as
 * duration. It only selects a typical total session window for a given
 * final kind/load combination; a long DH day can still contain substantial
 * uplift/waiting/recovery time.
 *
 * DH_LIGHT/HEAVY: this combination is legitimately reachable today (an
 * athlete can plan DH_LIGHT with any load via Planning, and no current
 * adaptation rule forbids it) even though DH_LIGHT is otherwise the
 * "lighter" family member. A coherent provisional value is defined here
 * (270 min) rather than silently making the combination impossible —
 * flagged explicitly for architecture review, see V0.3_006B implementation
 * result.
 */
export const DH_DURATION_MIN: Readonly<Record<"DH_PERFORMANCE" | "DH_TECHNICAL" | "DH_LIGHT" | "PUMPTRACK", Record<LoadProfile, number>>> = {
  DH_PERFORMANCE: { LIGHT: 180, MODERATE: 270, HEAVY: 360 },
  DH_TECHNICAL: { LIGHT: 180, MODERATE: 240, HEAVY: 330 },
  DH_LIGHT: { LIGHT: 150, MODERATE: 210, HEAVY: 270 },
  PUMPTRACK: { LIGHT: 60, MODERATE: 105, HEAVY: 150 },
} as const;

/**
 * Generic fallback technical focus — used only when the athlete has no
 * `athlete_coaching_profiles.technique_primary_focus` configured. Never
 * presented as learned personalization; the caller (domains/technique.ts)
 * uses the exact same string whether personal or generic — the DailyPlan
 * itself never distinguishes the two sources.
 */
export const DH_GENERIC_FOCUS: Readonly<Record<"DH_PERFORMANCE" | "DH_TECHNICAL" | "DH_LIGHT" | "PUMPTRACK", string>> = {
  DH_PERFORMANCE: "Précision des lignes et vitesse maîtrisée",
  DH_TECHNICAL: "Précision et qualité d'exécution",
  DH_LIGHT: "Fluidité, relâchement et marge",
  PUMPTRACK: "Pompage, trajectoires et conservation de vitesse",
} as const;

/** One concise, deterministic operational note added to `monitoring.observe` when a DH-family session was adapted for meaningful fatigue (C3.3/C3.5/C3.6) and the final session remains DH-family. No numeric threshold — see docs/03_COACHING_MODEL.md. */
export const DH_FATIGUE_MONITORING_NOTE =
  "Réduis encore la séance ou arrête la partie DH si ta précision se dégrade nettement ou si la fatigue jambes/grip augmente pendant la session.";
