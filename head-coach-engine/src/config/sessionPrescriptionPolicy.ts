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

/**
 * V0.3_006C1 — DH Execution Guidance. One concise, deterministic in-session
 * interruption criterion, added to `monitoring.observe` whenever non-Safety
 * pain (PAIN_NON_SAFETY) applies and the final session remains DH-family —
 * distinct from the existing 24-48h post-session follow-up (`painNonSafety.ts`),
 * which this does not replace. Deliberately an interruption criterion only —
 * never a claim that riding is safe, never a starting/clearance instruction,
 * never a numeric pain threshold (Safety A2/A4 already own the one hard
 * numeric gate). See docs/03_COACHING_MODEL.md §Douleur non-SAFETY.
 */
export const DH_IMMEDIATE_PAIN_MONITORING_NOTE =
  "Pendant la séance, arrête la partie DH si la douleur augmente clairement ou si ton contrôle se dégrade.";

/**
 * V0.3_006C1 — generic execution task, paired with `DH_GENERIC_FOCUS`.
 * Populated ONLY when the resolved focus came from this generic fallback
 * (never derived from an athlete's arbitrary personal
 * `technique_primary_focus` free text — see dhPrescription.ts#resolveDhExecutionTask).
 * `focus` = what is being worked on; `execution_task` = how to work on it
 * today. No numeric success threshold.
 */
export const DH_GENERIC_EXECUTION_TASK: Readonly<Record<"DH_PERFORMANCE" | "DH_TECHNICAL" | "DH_LIGHT" | "PUMPTRACK", string>> = {
  DH_PERFORMANCE:
    "Choisis une section que tu connais bien, fixe un ou deux repères et répète la même ligne proprement avant d'augmenter la vitesse.",
  DH_TECHNICAL:
    "Choisis une section technique courte et travaille un seul point à la fois ; répète jusqu'à obtenir une exécution propre avant de changer.",
  DH_LIGHT: "Sur terrain connu, cherche une conduite fluide et relâchée sans objectif de vitesse.",
  PUMPTRACK: "Travaille la conservation de vitesse avec les appuis et le pompage, sans faire de la vitesse maximale l'objectif.",
} as const;

/**
 * V0.3_006C1 (final correction) — deterministic DH riding-behavior guidance
 * per FINAL `load_profile`. Substantive athlete-facing coaching prescription
 * (not a UI label) — was initially web-only, corrected to be engine-emitted
 * and persisted so a historical DailyPlan never retroactively gains this
 * instruction merely because the web bundle changed later (see
 * docs/03_COACHING_MODEL.md §DH Execution Guidance — Canonical history
 * invariant). Purely qualitative: no numeric RPE, no run percentage, no
 * exact run count, no speed percentage. HEAVY does not mean deliberately
 * unsafe or maximal-effort riding.
 */
export const DH_LOAD_GUIDANCE: Readonly<Record<LoadProfile, string>> = {
  LIGHT: "Privilégie la fluidité et l'exécution propre. Ne cherche pas la vitesse et garde de la marge pendant toute la session.",
  MODERATE:
    "Priorise la qualité d'exécution. Engage davantage seulement quand tes lignes restent propres et ton contrôle bon ; ne cherche pas à pousser tous les runs.",
  HEAVY:
    "Séance orientée performance : fais monter l'engagement progressivement et travaille la vitesse sans sacrifier la précision ni le contrôle.",
} as const;

/**
 * V0.3_006C1 — deterministic terrain (spot_hint) guidance, precedence-based
 * (pain > meaningful fatigue > Mental RED > race-proximity > ordinary
 * fresh/default — see domains/technique.ts#selectSpotHint). Descriptive
 * terrain CHARACTERISTICS only, never a named venue/GPS/track database.
 * The two pain variants are deliberately generic risk-reduction language —
 * never a claim of medical safety/clearance for a specific body location.
 */
export const DH_SPOT_HINT = {
  painUpperGrip: "Privilégie un terrain familier, moins cassant et moins exigeant en freinage et en grip.",
  painLower: "Privilégie un terrain familier et moins exigeant physiquement.",
  fatigue: "Choisis un terrain familier et lisible où tu peux garder de la marge et une exécution propre.",
  mentalRed: "Privilégie un terrain familier et lisible pour réduire le nombre de décisions à prendre pendant le run.",
  raceProximate: "Terrain représentatif de la prochaine course.",
  freshDefault: "Choisis un terrain connu ou représentatif où tu maîtrises déjà les lignes et peux travailler la vitesse avec précision.",
} as const;
