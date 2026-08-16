/**
 * M2_003 — partial inversion `DbSessionType → TrainingIntervention`.
 *
 * See docs/05_DATA_MODEL.md §planned_sessions and docs/06_ARCHITECTURE.md
 * §Fallback d'intervention en lecture. Used only when a `planned_sessions`
 * row has no `intervention JSONB` (legacy row, or entry made without the
 * rich representation).
 *
 * The `TrainingIntervention → DbSessionType` mapping (src/mapping/, M1
 * frozen) is surjective: several `(kind, load_profile)` combinations
 * collapse onto the same `DbSessionType`. Inversion is therefore only safe
 * for the three fixed-load kinds that map 1↔1 with no ambiguity. Every
 * other `DbSessionType` returns `null` — the caller is responsible for
 * surfacing that as an explicit warning, never for inventing a `kind` or
 * `load_profile`.
 */
import type { DbSessionType } from "../../types/index.js";
import type { TrainingIntervention } from "../../types/index.js";

const DETERMINISTIC_INVERSIONS: Partial<Record<DbSessionType, TrainingIntervention>> = {
  REST: { kind: "REST" },
  BIKE_MAINTENANCE: { kind: "BIKE_MAINTENANCE" },
  RACE_PREP: { kind: "RACE_ACTIVITY" },
};

/**
 * Inverts a `DbSessionType` to a `TrainingIntervention` only for the three
 * mappings that are mathematically unambiguous. Returns `null` for every
 * other (ambiguous) `DbSessionType` — never fabricates a `kind` or
 * `load_profile`.
 */
export function invertDbSessionType(sessionType: DbSessionType): TrainingIntervention | null {
  return DETERMINISTIC_INVERSIONS[sessionType] ?? null;
}
