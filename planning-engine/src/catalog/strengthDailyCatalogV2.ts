/**
 * PHYS-01.1 — what the DAILY final prescription adds to a planned Force
 * session. Kept out of the Session Model manifest on purpose: a plan
 * (planned prescription) is byte-identical to the one the previous runtime
 * writes, and every final prescription uses only ids the previous runtime
 * already knows, so a release can be rolled back without any unreadable
 * document (same precedent as the daily adaptation rules A04 / A10, which are
 * identified by their rule ids, never by a manifest version).
 *
 * - cool-down: appended to every Force final prescription — the mobility of
 *   the zone the session loaded first (never an exercise of the warm-up),
 *   then a long-exhale breathing hold; existing exercises holding the
 *   `cool_down` role and an existing instruction only;
 * - the rider's time today (A10): a Force session keeps its dose; it drops
 *   its last accessory exercises (never the principal, never a rest, never a
 *   warm-up item) and keeps the cool-down's mobility only;
 * - timing: how long a Force prescription really takes (conservative upper
 *   bounds of every range).
 *
 * Every value: PROVISIONAL — qualified strength and conditioning validation
 * required before any commercial use.
 */
export const STRENGTH_DAILY_CATALOG_V2_VERSION = "strength-daily-v1";

export interface StrengthCoolDownItemV2 {
  exerciseId: string;
  sets: number;
}

export const STRENGTH_COOL_DOWN_INSTRUCTION_ID = "instruction.recovery.light_mobility";

/** First item = the session's mobility (kept when the session is shortened), last = breathing. */
export const STRENGTH_COOL_DOWN_V2: Readonly<Record<"STRENGTH_LOWER" | "STRENGTH_UPPER", readonly StrengthCoolDownItemV2[]>> = {
  STRENGTH_LOWER: [
    { exerciseId: "hip_flexor_mobility", sets: 1 },
    { exerciseId: "breathing_long_exhale", sets: 1 },
  ],
  STRENGTH_UPPER: [
    { exerciseId: "cat_cow", sets: 1 },
    { exerciseId: "breathing_long_exhale", sets: 1 },
  ],
};

/** A shortened Force keeps at least the principal; its cool-down keeps its first (mobility) item. */
export const STRENGTH_SHORTENED_V2 = { minWorkSlots: 1, coolDownItems: 1 } as const;

/**
 * Estimator inputs. A set = setup + work (reps at a controlled tempo, or the
 * hold's duration; per side doubles it; a carry is walked at about 1 m/s);
 * the rest between the sets of an exercise; one transition after each
 * exercise; the ramp-up sets of the principal movement with their own rest.
 */
export const STRENGTH_TIMING_V2 = {
  repSeconds: 4,
  setSetupSeconds: 10,
  metersPerSecond: 1,
  transitionSeconds: 60,
  rampUpSetSeconds: 30,
  rampUpRestSeconds: 60,
} as const;
