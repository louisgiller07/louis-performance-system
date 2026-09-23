/**
 * Pure, deterministic precondition check for PlanInputSnapshot (M0 Issue 4 /
 * M1 §7/§8). Recurring availability is REQUIRED before first generation —
 * never a permissive "assume fully available" default. This is a distinct
 * failure mode from PlanningEngineValidationError's "malformed data" —
 * GenerationBlockedError represents "the data is validly absent (or
 * unconfirmable), and that absence is itself the reason generation cannot
 * proceed," matching the M0 decision's own "positive-confirmation-only"
 * rule: any failure to positively confirm availability blocks generation
 * identically, whether the cause is "never configured" or "could not be
 * read" — this package has no I/O of its own, so callers are expected to
 * translate a read failure into simply not calling this function with a
 * confirmed snapshot, or to catch their own read error and raise this same
 * error type for consistency.
 */
import { PlanningEngineValidationError } from "./errors.js";
import type { StrengthExperienceTier } from "../types/planInputSnapshot.js";
import { EXERCISE_CATALOG_ENTRIES, DRILL_CATALOG_ENTRIES } from "../catalog/index.js";

/**
 * `missing_performance_profile`/`missing_discipline` are reserved for
 * head-coach-engine's future `buildPlanInputSnapshot()` (V0.5_003/V0.5_004
 * decision lock) — not yet thrown by this package itself, which has no I/O
 * of its own (see module doc above). Added ahead of their consumer, same
 * precedent as `athlete_onboarding_profiles`' "collecte en avance de la
 * personnalisation."
 *
 * `missing_strength_experience_tier` (V0.5_009) is deliberately DISTINCT
 * from `missing_performance_profile`: a `athlete_performance_profiles` row
 * can exist (Performance Setup started) while `strength_experience_tier`
 * itself stays individually NULL (that column has no DB default, unlike
 * `equipment`/`terrain_access`/`declared_limitations`, which always default
 * to `[]`) — an incomplete configuration must never be masked as an absent
 * one.
 */
export type GenerationBlockedReason =
  | "missing_availability"
  | "missing_performance_profile"
  | "missing_discipline"
  | "missing_strength_experience_tier";

export class GenerationBlockedError extends Error {
  constructor(public readonly blockedReason: GenerationBlockedReason) {
    super(`Plan generation blocked: ${blockedReason}`);
    this.name = "GenerationBlockedError";
  }
}

/**
 * Throws {@link GenerationBlockedError} if `availability.windows` is empty —
 * "explicitly declared full availability" produces real window entries
 * (even a single "all day, every day" entry counts); zero entries always
 * means "never configured," never "unlimited."
 */
export function assertAvailabilityDeclared(availability: { windows: readonly unknown[] }): void {
  if (availability.windows.length === 0) {
    throw new GenerationBlockedError("missing_availability");
  }
}

const VALID_STRENGTH_EXPERIENCE_TIERS: ReadonlySet<string> = new Set(["beginner", "intermediate", "advanced"]);

/**
 * V0.5_009 — `athlete_performance_profiles.strength_experience_tier` is a
 * plain `text` column with only a non-blank CHECK (never a Postgres enum),
 * so a genuinely invalid value is structurally possible at the DB level.
 * Distinct failure mode from {@link GenerationBlockedError}: the data is
 * PRESENT but malformed, not validly absent — same distinction this
 * module's own doc draws against `PlanningEngineValidationError`. Never
 * silently coerced to a plausible tier.
 */
export function assertValidStrengthExperienceTier(value: string): asserts value is StrengthExperienceTier {
  if (!VALID_STRENGTH_EXPERIENCE_TIERS.has(value)) {
    throw new PlanningEngineValidationError(
      "PlanInputSnapshot.strengthExperienceTier",
      `must be one of beginner/intermediate/advanced (got "${value}")`,
      value
    );
  }
}

/**
 * V0.5_019 — unlike `strengthExperienceTier` (a fixed 3-value enum with no
 * underlying data source), `equipment`/`terrainAccess`/`priorityAreas` are
 * validated against the SAME catalogue data prescription-engine's own
 * selectors already filter by (`isEquipmentCompatible`/`terrainAccess.
 * includes(terrainRequirement)`/`priorityAreas[0]` used directly as a
 * skillTarget — see prescription-engine's exerciseSelection.ts/
 * drillSelection.ts/skillTargetSelection.ts, confirmed identical vocabulary,
 * V0.5_018 §3). Derived directly from EXERCISE_CATALOG_ENTRIES/
 * DRILL_CATALOG_ENTRIES rather than hand-duplicated a second time within
 * this same package — a value the catalogue actually uses today is by
 * definition valid, and a future catalogue change is picked up automatically,
 * with no separate list to keep in sync here. This is a same-package
 * reference (validation/ -> catalog/), not a boundary crossing — web/ still
 * never imports either.
 */
const VALID_EQUIPMENT: ReadonlySet<string> = new Set(EXERCISE_CATALOG_ENTRIES.flatMap((entry) => entry.equipmentRequirements));
const VALID_TERRAIN: ReadonlySet<string> = new Set(DRILL_CATALOG_ENTRIES.map((entry) => entry.terrainRequirement));
const VALID_SKILL_TARGETS: ReadonlySet<string> = new Set(DRILL_CATALOG_ENTRIES.map((entry) => entry.skillTarget));

function assertEachKnown(context: string, values: readonly string[], known: ReadonlySet<string>): void {
  const unrecognized = values.filter((value) => !known.has(value));
  if (unrecognized.length > 0) {
    throw new PlanningEngineValidationError(
      context,
      `contains unrecognized value(s): ${unrecognized.join(", ")}`,
      values
    );
  }
}

/** Every declared equipment item must match a value at least one exercise's `equipmentRequirements` actually references — an unrecognized item is malformed data, never silently ignored. */
export function assertValidEquipment(equipment: readonly string[]): void {
  assertEachKnown("PlanInputSnapshot.equipment", equipment, VALID_EQUIPMENT);
}

/** Every declared terrain item must match a value at least one drill's `terrainRequirement` actually references. */
export function assertValidTerrainAccess(terrainAccess: readonly string[]): void {
  assertEachKnown("PlanInputSnapshot.terrainAccess", terrainAccess, VALID_TERRAIN);
}

/** Every declared priority area must match a real drill `skillTarget` — `priorityAreas[0]` is used directly as a skillTarget by prescription-engine's skillTargetSelection.ts, with no translation step. */
export function assertValidPriorityAreas(priorityAreas: readonly string[]): void {
  assertEachKnown("PlanInputSnapshot.technicalPriorities.priorityAreas", priorityAreas, VALID_SKILL_TARGETS);
}
