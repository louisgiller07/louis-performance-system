/**
 * V2-PHYS-INTEGRATION-01 (HPM 2026-10-18) — the PHYS switches of the DAILY path, read on the server only (Edge
 * secrets, `head-coach-engine/src/supabase/dailyV2/physDailySwitches.ts`) and passed down. Absent or false: the
 * daily behaviour of production before PHYS (863f3fb), exactly — no cool-down, no guidance written, Force under the
 * rider's time at its LIGHT dose, no new family reachable by a manual session or a REPLACE.
 *
 * The family switches (`intervals`, `power`, `mobility`) are the generation secrets of PHYS-02 / 03 / 04: one secret
 * per family opens it everywhere (placement in a new plan, manual session, REPLACE). Off, they never touch what was
 * already accepted: a session of that family already in the rider's plan keeps its own rules (KEEP, A10, fatigue
 * hold, intervals LIGHT fallback) — closing a family never breaks a current plan.
 */
export interface PhysSwitchesV2 {
  /** NALYNT_V2_PHYS_DAILY_ENABLED — PHYS-01.1 Force cool-down and Force at the same dose under A10; PHYS-02 endurance guidance. */
  daily?: boolean;
  /**
   * NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED, effective only with `daily` — PHYS-01 load guidance and PHYS-04
   * bodyweight repetitions guidance, both a progression from the rider's real performance: not authorised while
   * docs/03 §10 forbids it (HPM, V2-PHYS-INTEGRATION-01 E).
   */
  performanceGuidance?: boolean;
  /** NALYNT_V2_ENDURANCE_INTERVALS_ENABLED — an intervals session from a manual session or a REPLACE. */
  intervals?: boolean;
  /** NALYNT_V2_POWER_ENABLED — a power session from a manual session or a REPLACE. */
  power?: boolean;
  /** NALYNT_V2_MOBILITY_ENABLED — a mobility session from a manual session or a REPLACE. */
  mobility?: boolean;
}

/** Every switch off: the production daily behaviour. */
export const PHYS_SWITCHES_OFF_V2: Readonly<PhysSwitchesV2> = Object.freeze({});
