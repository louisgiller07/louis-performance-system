/**
 * DbSessionType — enum coarse de persistance Supabase V0.2 (déjà déployé).
 * Ne pas modifier / enrichir sans discussion — voir docs/05_DATA_MODEL.md.
 */
export type DbSessionType =
  | "STRENGTH_A"
  | "STRENGTH_B"
  | "AEROBIC_BASE"
  | "AEROBIC_INTERVALS"
  | "DH_TECHNICAL"
  | "DH_PERFORMANCE"
  | "RECOVERY"
  | "REST"
  | "BIKE_MAINTENANCE"
  | "RACE_PREP";
