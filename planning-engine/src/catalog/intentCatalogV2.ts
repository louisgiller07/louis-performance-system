/**
 * UX-11A.5a.2a — Session Model V2 intent catalogue.
 *
 * An intent DESCRIBES why a session exists; it never selects content.
 * The engine picks an existing intentId; the athlete-facing text lives in
 * coachingTextCatalog.ts (`intent.<intentId>`), never written on the fly.
 *
 * Selection rules (future V2 engines — not implemented here):
 * - "session_kind": selectable from the session kind alone;
 * - "declared_priority": DH only — selectable only when the matching skill
 *   comes from a priority the rider explicitly declared; the skill → intent
 *   mapping is the single table DH_SKILL_TO_INTENT_V2 below (the priority
 *   chooses the skill, the tier and terrain choose the drill, the skill
 *   determines the intent: no duplicated logic);
 * - "candidate": kept for later, never selectable until a validated rule
 *   exists (no rule to choose between them today);
 * - "inactive_until_validated_rule": never selectable — in particular never
 *   from a hypothesis or a declared weakness (grip_endurance_full_run).
 *
 * Every entry: PROVISIONAL — coaching validation required.
 */
import type { ContentValidationStatus } from "./coachingTextCatalog.js";
import type { DhSkillV2 } from "./sessionDrillCatalogV2.js";

export const INTENT_CATALOG_V2_VERSION = "session-intents-v2.0";

/** The six Session Model V1 families (03). */
export const SESSION_FAMILIES_V2 = ["strength", "power", "dh_technical", "endurance", "mobility", "recovery"] as const;
export type SessionFamilyV2 = (typeof SESSION_FAMILIES_V2)[number];

/** Existing TrainingInterventionKind values covered by the six families (03 §4). */
export const INTENT_SESSION_KINDS_V2 = [
  "STRENGTH_LOWER",
  "STRENGTH_UPPER",
  "STRENGTH_FULL_LIGHT",
  "GRIP_WORK",
  "POWER",
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "DH_LIGHT",
  "PUMPTRACK",
  "AEROBIC_BASE",
  "AEROBIC_INTERVALS",
  "MOBILITY",
  "RECOVERY_ACTIVE",
] as const;
export type IntentSessionKindV2 = (typeof INTENT_SESSION_KINDS_V2)[number];

export type IntentSelectionV2 =
  | { type: "session_kind" }
  | { type: "declared_priority"; skill: DhSkillV2 }
  | { type: "candidate" }
  | { type: "inactive_until_validated_rule" };

export interface SessionIntentV2 {
  intentId: string;
  family: SessionFamilyV2;
  sessionKinds: readonly IntentSessionKindV2[];
  selection: IntentSelectionV2;
  /** True only for "session_kind" and "declared_priority". */
  selectable: boolean;
  textId: string;
  validationStatus: ContentValidationStatus;
}

const DH_KINDS: readonly IntentSessionKindV2[] = ["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT", "PUMPTRACK"];

function intent(intentId: string, family: SessionFamilyV2, sessionKinds: readonly IntentSessionKindV2[], selection: IntentSelectionV2): SessionIntentV2 {
  return {
    intentId,
    family,
    sessionKinds,
    selection,
    selectable: selection.type === "session_kind" || selection.type === "declared_priority",
    textId: `intent.${intentId}`,
    validationStatus: "PROVISIONAL",
  };
}

const ENTRIES: SessionIntentV2[] = [
  // Strength — one generic selectable lower-body intent in V1; the two specific ones stay candidates.
  intent("lower_body_strength_control", "strength", ["STRENGTH_LOWER"], { type: "session_kind" }),
  intent("leg_strength_corner_exit", "strength", ["STRENGTH_LOWER"], { type: "candidate" }),
  intent("leg_stability_rough_terrain", "strength", ["STRENGTH_LOWER"], { type: "candidate" }),
  intent("upper_bike_control", "strength", ["STRENGTH_UPPER"], { type: "session_kind" }),
  intent("strength_maintenance_light", "strength", ["STRENGTH_FULL_LIGHT"], { type: "session_kind" }),
  intent("grip_endurance_full_run", "strength", ["GRIP_WORK"], { type: "inactive_until_validated_rule" }),
  // Power
  intent("corner_exit_power", "power", ["POWER"], { type: "session_kind" }),
  // DH — one intent per skill, only from a declared priority.
  intent("dh_braking_control", "dh_technical", DH_KINDS, { type: "declared_priority", skill: "braking" }),
  intent("dh_corner_exit_speed", "dh_technical", DH_KINDS, { type: "declared_priority", skill: "cornering" }),
  intent("dh_line_reading", "dh_technical", DH_KINDS, { type: "declared_priority", skill: "line_choice" }),
  intent("dh_steep_confidence", "dh_technical", DH_KINDS, { type: "declared_priority", skill: "steep_terrain" }),
  intent("dh_rough_terrain_flow", "dh_technical", DH_KINDS, { type: "declared_priority", skill: "roots_rocks" }),
  intent("dh_jump_control", "dh_technical", DH_KINDS, { type: "declared_priority", skill: "jumps" }),
  intent("dh_race_pace", "dh_technical", DH_KINDS, { type: "declared_priority", skill: "race_execution" }),
  // Endurance, mobility, recovery
  intent("aerobic_base_lucidity", "endurance", ["AEROBIC_BASE"], { type: "session_kind" }),
  intent("aerobic_repeat_efforts", "endurance", ["AEROBIC_INTERVALS"], { type: "session_kind" }),
  intent("mobility_on_bike_range", "mobility", ["MOBILITY"], { type: "session_kind" }),
  intent("recovery_without_fatigue", "recovery", ["RECOVERY_ACTIVE"], { type: "session_kind" }),
];

export const INTENT_CATALOG_V2_ENTRIES: readonly SessionIntentV2[] = ENTRIES;

export const INTENT_CATALOG_V2: Readonly<Record<string, SessionIntentV2>> = Object.fromEntries(ENTRIES.map((i) => [i.intentId, i]));

/** The single skill → intent table (7 skills → 7 DH intents). */
export const DH_SKILL_TO_INTENT_V2: Readonly<Record<DhSkillV2, string>> = Object.fromEntries(
  ENTRIES.flatMap((i) => (i.selection.type === "declared_priority" ? [[i.selection.skill, i.intentId]] : []))
) as Record<DhSkillV2, string>;
