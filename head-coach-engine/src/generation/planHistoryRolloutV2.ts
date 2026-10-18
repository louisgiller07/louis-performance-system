/**
 * V2-L2-01a — name of the Edge secret feeding a V2 plan generation with the V2 recent history (guided results,
 * explicit missed sessions; canon docs/05 « Historique de la génération V2 »). Same parsing as the other switches
 * (parseV2PlanGenerationFlag): only "true" turns it on; absent = the previous snapshots exactly. Read on the server
 * only, never from the request; V2 plans only, V1 never reads it.
 *
 * Its own module, not planningModelRollout.ts: that one is also in daily-run's Edge graph, which this ticket leaves
 * byte for byte unchanged.
 */
export const V2_L2_HISTORY_FLAG = "NALYNT_V2_L2_HISTORY_ENABLED";
