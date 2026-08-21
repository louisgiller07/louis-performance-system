import type { DecisionOutcomeHorizon } from "../types/sources.js";

/**
 * Bumped whenever buildTimeline's output shape or derivation rules change,
 * so a consumer persisting/comparing timelines across versions can detect
 * drift. Deliberately not a build timestamp — this package has no clock.
 */
export const TIMELINE_BUILDER_VERSION = "1.0.0";

/**
 * Runtime enumeration of DecisionOutcomeHorizon — mirrored locally (same
 * convention as supabase/rowMapping.ts's enum allow-lists) since the
 * type-level union in types/sources.ts has no runtime representation of
 * its own. Used to always materialize all three horizon buckets, even
 * empty ones.
 */
export const DECISION_OUTCOME_HORIZONS: readonly DecisionOutcomeHorizon[] = ["J_PLUS_1", "J_PLUS_3", "J_PLUS_7"];
