// V0.5_019 — Performance Setup closed vocabulary. Same discipline as
// athleteOnboarding/onboardingOptions.ts and dailyPlan/dailyPlanTypes.ts:
// web/ never imports planning-engine/prescription-engine/head-coach-engine
// directly (no shared build boundary between web/ and the engine packages,
// see dailyPlanTypes.ts's own comment; confirmed architecture, V0.5_018 —
// Option A retained over a shared package or a config endpoint). Every list
// below is a deliberate, hand-maintained mirror of the corresponding
// planning-engine catalogue values. Kept in sync by hand — a drift here is a
// silently-inert Performance Setup field (an athlete could declare a value
// this UI allows that no catalogue entry ever checks for), never a compile
// error, so any change to the source catalogue must be mirrored here
// deliberately.

/**
 * Kept in sync by hand with planning-engine/src/catalog/exerciseCatalog.ts's
 * `equipmentRequirements` values (distinct values across all 21 entries,
 * V0.5_017/018 audit). Backend-enforced identically —
 * planning-engine/src/validation/validatePlanInputSnapshot.ts's
 * `assertValidEquipment()` derives its own accepted set from the same
 * catalogue at runtime, so this list and the backend's real source of truth
 * can never silently diverge in the athlete's favor: an out-of-sync value
 * here would be rejected at generation time, not just structurally inert.
 */
export const EQUIPMENT_OPTIONS = [
  "barbell",
  "squat_rack",
  "dumbbells",
  "bench",
  "resistance_bands",
  "cable_machine",
  "pull_up_bar",
] as const;
export type Equipment = (typeof EQUIPMENT_OPTIONS)[number];

/**
 * Kept in sync by hand with planning-engine/src/catalog/drillCatalog.ts's
 * `terrainRequirement` values (distinct values across all 12 entries,
 * V0.5_017/018 audit). Backend-enforced identically by
 * `assertValidTerrainAccess()`, same reasoning as EQUIPMENT_OPTIONS above.
 */
export const TERRAIN_OPTIONS = [
  "any_groomed_trail",
  "flow_trail",
  "bermed_trail",
  "technical_trail",
  "rock_garden",
  "steep_technical_trail",
  "root_rock_trail",
  "bike_park_jump_line",
  "full_dh_track",
] as const;
export type Terrain = (typeof TERRAIN_OPTIONS)[number];

/**
 * Kept in sync by hand with planning-engine/src/catalog/drillCatalog.ts's
 * `skillTarget` values (distinct values across all 12 entries, V0.5_017/018
 * audit) — the same vocabulary PlanInputSnapshot.technicalPriorities.
 * priorityAreas already shares with DrillCatalogEntry.skillTarget, no
 * translation step (confirmed directly in prescription-engine's
 * skillTargetSelection.ts, V0.5_018 §3). Backend-enforced identically by
 * `assertValidPriorityAreas()`.
 */
export const TECHNICAL_PRIORITY_OPTIONS = [
  "braking",
  "cornering",
  "line_choice",
  "steep_terrain",
  "roots_rocks",
  "jumps",
  "race_execution",
] as const;
export type TechnicalPriority = (typeof TECHNICAL_PRIORITY_OPTIONS)[number];

/**
 * Kept in sync by hand with planning-engine/src/types/planInputSnapshot.ts's
 * `StrengthExperienceTier` union — a fixed 3-value product enum, not derived
 * from catalogue data (unlike the three lists above, there is no underlying
 * runtime data structure this type was itself derived from). Backend-enforced
 * identically by `assertValidStrengthExperienceTier()`
 * (planning-engine/src/validation/validatePlanInputSnapshot.ts, V0.5_009).
 */
export const STRENGTH_EXPERIENCE_TIER_OPTIONS = ["beginner", "intermediate", "advanced"] as const;
export type StrengthExperienceTier = (typeof STRENGTH_EXPERIENCE_TIER_OPTIONS)[number];
