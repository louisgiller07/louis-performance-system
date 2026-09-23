/**
 * Local duplication of planning-engine's strength/DH SessionKind partitions
 * — same discipline as planning-engine's own loadDerivation.ts/
 * constraintResolver.ts: "duplicated deliberately, never imported across
 * pipeline files." Kept as plain data here, not logic, so this package's
 * own domain dispatch stays self-contained.
 */
import type { SessionKind } from "planning-engine";

export const STRENGTH_KINDS: ReadonlySet<SessionKind> = new Set(["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER"]);
export const DH_KINDS: ReadonlySet<SessionKind> = new Set(["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT"]);

/**
 * Pure technical version stamp — never a coaching value, same convention as
 * EXERCISE_CATALOG_VERSION/DRILL_CATALOG_VERSION/PLANNING_ENGINE_VERSION.
 * Single source of truth for both resolvers (strengthResolver.ts/
 * dhResolver.ts) — previously two independent, identically-valued local
 * constants (V0.5_005 centralization).
 */
export const PRESCRIPTION_SCHEMA_VERSION = "v1";
