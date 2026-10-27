/**
 * V2-DH-UNIT-01 (HPM 2026-10-26) — the daily run requires a reliable DH unit exactly while V2 is on: the same Edge
 * secret as the V2 generation (NALYNT_V2_PLAN_GENERATION_ENABLED, exact value "true"), read on the server only. V2 on,
 * no executable DH count without its drill's signed unit, whatever the document's origin (KEEP, MODIFY, REPLACE,
 * manual); V2 off, the production daily behaviour exactly. Turning V2 on cannot leave the DH protection off.
 *
 * Never imports planning-engine: the daily-run Edge Function loads this module from the unbundled dist.
 */
import { parseV2PlanGenerationFlag, V2_PLAN_GENERATION_FLAG } from "../../generation/planningModelRollout.js";

export function dhUnitRequirementFromEnv(get: (name: string) => string | undefined): { dhUnit?: "required" } {
  return parseV2PlanGenerationFlag(get(V2_PLAN_GENERATION_FLAG)) ? { dhUnit: "required" } : {};
}
