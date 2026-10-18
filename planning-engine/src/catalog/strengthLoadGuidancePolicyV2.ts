/**
 * PHYS-01 — policy of the Force load guidance (double progression from the
 * rider's own recorded sets). Not part of the Session Model manifest: the
 * guidance is not session content (catalogue) but a daily reading of the
 * rider's history, versioned on its own (`ruleVersion` in every guidance).
 *
 * - loadable exercises: those whose required equipment carries an external
 *   load in kilograms; the step is the smallest usual increase of that
 *   equipment (barbell / cable: 2.5 kg, kettlebell: 4 kg, dumbbells: 2 kg in
 *   the rider's own recording convention). Bodyweight and band exercises get
 *   no load guidance;
 * - a reference older than `maxReferenceAgeDays` is shown, never extrapolated
 *   (the rider restarts by effort);
 * - an effort `effortTooHighMargin` RPE points above the target's upper bound
 *   lowers the load one step.
 *
 * Never a 1RM, a % of 1RM or a declared profile value: only loads the rider
 * actually recorded. Every value: PROVISIONAL — qualified strength and
 * conditioning validation required before any commercial use.
 */
export const STRENGTH_LOAD_GUIDANCE_RULES_VERSION = "strength-load-guidance-v1";

/** Equipment carrying an external load, in precedence order, with its load step (kg). */
export const STRENGTH_LOAD_STEPS_KG_V2: readonly { equipment: string; stepKg: number }[] = [
  { equipment: "barbell", stepKg: 2.5 },
  { equipment: "cable_machine", stepKg: 2.5 },
  { equipment: "kettlebell", stepKg: 4 },
  { equipment: "dumbbells", stepKg: 2 },
];

export const STRENGTH_LOAD_GUIDANCE_POLICY_V2 = {
  /** History read before the decision date (days). */
  historyWindowDays: 56,
  /** A reference older than this is shown as a reference only. */
  maxReferenceAgeDays: 28,
  /** RPE points above the target's upper bound from which the load goes down one step. */
  effortTooHighMargin: 2,
} as const;
