/**
 * V2-PHYS-INTEGRATION-01 (HPM 2026-10-18) — the PHYS switches of the daily run, from the Edge secrets (server only,
 * never from the request). Same parsing as the generation secrets (planningModelRollout.ts): only the exact value
 * "true" turns a switch on; absent, empty, "TRUE", "1"… → off. Every switch off = the production daily behaviour
 * before PHYS (planning-engine physSwitchesV2.ts).
 *
 * - NALYNT_V2_PHYS_DAILY_ENABLED: Force cool-down and Force at the same dose under A10 (PHYS-01.1), endurance
 *   guidance (PHYS-02).
 * - NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED, effective only with the daily switch: load guidance (PHYS-01) and
 *   bodyweight repetitions guidance (PHYS-04) — a progression from real performance, forbidden by docs/03 §10 until
 *   an HPM decision: to stay off.
 * - The generation secrets of PHYS-02 / 03 / 04 also open their family to a manual session or a REPLACE.
 *
 * Never imports planning-engine: the daily-run Edge Function loads this module from the unbundled dist.
 */
import type { ReconcileFinalPrescriptionV2Input } from "./reconcileFinalPrescriptionV2.js";
import { parseV2PlanGenerationFlag, V2_ENDURANCE_INTERVALS_FLAG, V2_MOBILITY_SESSIONS_FLAG, V2_POWER_SESSIONS_FLAG } from "../../generation/planningModelRollout.js";

/** Name of the Edge secret of the PHYS daily additions (PHYS-01.1 Force, PHYS-02 endurance guidance). */
export const V2_PHYS_DAILY_FLAG = "NALYNT_V2_PHYS_DAILY_ENABLED";

/** Name of the Edge secret of the performance-based guidance (PHYS-01 load, PHYS-04 repetitions); requires the daily switch. */
export const V2_PHYS_PERFORMANCE_GUIDANCE_FLAG = "NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED";

/** The switches as the V2 reconciliation takes them (planning-engine PhysSwitchesV2). */
export type PhysDailySwitches = NonNullable<ReconcileFinalPrescriptionV2Input["phys"]>;

export function physSwitchesFromEnv(get: (name: string) => string | undefined): PhysDailySwitches {
  const on = (name: string) => parseV2PlanGenerationFlag(get(name));
  const daily = on(V2_PHYS_DAILY_FLAG);
  return {
    daily,
    performanceGuidance: daily && on(V2_PHYS_PERFORMANCE_GUIDANCE_FLAG),
    intervals: on(V2_ENDURANCE_INTERVALS_FLAG),
    power: on(V2_POWER_SESSIONS_FLAG),
    mobility: on(V2_MOBILITY_SESSIONS_FLAG),
  };
}
