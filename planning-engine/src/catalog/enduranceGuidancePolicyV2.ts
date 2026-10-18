/**
 * PHYS-02 — endurance guidance from the rider's own recorded sessions
 * (PROVISIONAL sport parameter, coaching validation required). Outside the
 * Session Model V2 manifest: an advisory addition to a daily final
 * prescription (never a planned dose), traced by its rules version.
 */
export const ENDURANCE_GUIDANCE_RULES_VERSION = "endurance-guidance-v1";

export const ENDURANCE_GUIDANCE_POLICY_V2 = {
  /** How far back the history is read (days before today). */
  historyWindowDays: 28,
  validationStatus: "PROVISIONAL",
} as const;
