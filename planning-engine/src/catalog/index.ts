export { EXERCISE_CATALOG_VERSION, EXERCISE_CATALOG, EXERCISE_CATALOG_ENTRIES } from "./exerciseCatalog.js";
export type { MovementCategory, PrescriptionModality, ExerciseCatalogEntry } from "./exerciseCatalog.js";

export { DRILL_CATALOG_VERSION, DRILL_CATALOG, DRILL_CATALOG_ENTRIES } from "./drillCatalog.js";
export type { DrillDifficultyTier, DrillCatalogEntry } from "./drillCatalog.js";

export { WEEK_TEMPLATE_CATALOG_VERSION, WEEK_TEMPLATE_CATALOG, WEEK_TEMPLATE_CATALOG_ENTRIES } from "./weekTemplateCatalog.js";
export type { WeekTemplateCatalogEntry } from "./weekTemplateCatalog.js";

// UX-11A.5a.1 — Session Model V2 content (separate from the V1 catalogues
// above, own versions, not read by any engine yet).
export {
  SESSION_EXERCISE_CATALOG_V2_VERSION,
  SESSION_EXERCISE_CATALOG_V2,
  SESSION_EXERCISE_CATALOG_V2_ENTRIES,
  SESSION_EXERCISE_ROLES_V2,
  SESSION_EXERCISE_FAMILIES_V2,
  SESSION_TIERS_V2,
  SESSION_MEASURE_TYPES_V2,
  MOBILITY_ZONES_V2,
} from "./sessionExerciseCatalogV2.js";
export type {
  SessionExerciseV2,
  SessionExerciseRoleV2,
  SessionExerciseFamilyV2,
  SessionMeasureTypeV2,
  ReferencePrescriptionV2,
  RangeV2,
  MobilityZoneV2,
} from "./sessionExerciseCatalogV2.js";
export {
  COACHING_TEXT_CATALOG_VERSION,
  COACHING_TEXT_CATALOG,
  COACHING_TEXT_CATALOG_ENTRIES,
  CANONICAL_COACHING_LOCALE,
  PROVISIONAL_NOTICE,
} from "./coachingTextCatalog.js";
export type { CoachingTextEntry, CoachingTextKind, CoachingLocale, ContentValidationStatus } from "./coachingTextCatalog.js";

// UX-11A.5a.2a — DH drills V2, intents V2, block roles and DH frame (not read by any engine yet).
export {
  SESSION_DRILL_CATALOG_V2_VERSION,
  SESSION_DRILL_CATALOG_V2,
  SESSION_DRILL_CATALOG_V2_ENTRIES,
  DH_SKILLS_V2,
  DH_TECHNICAL_TIERS_V2,
  DH_DRILL_PASSES_RANGE_V2,
} from "./sessionDrillCatalogV2.js";
export type { SessionDrillV2, DhSkillV2, DhTechnicalTierV2 } from "./sessionDrillCatalogV2.js";
export {
  INTENT_CATALOG_V2_VERSION,
  INTENT_CATALOG_V2,
  INTENT_CATALOG_V2_ENTRIES,
  DH_SKILL_TO_INTENT_V2,
  SESSION_FAMILIES_V2,
  INTENT_SESSION_KINDS_V2,
} from "./intentCatalogV2.js";
export type { SessionIntentV2, IntentSelectionV2, SessionFamilyV2, IntentSessionKindV2 } from "./intentCatalogV2.js";
export { SESSION_BLOCK_ROLES_V2, DH_SESSION_FRAME_V2 } from "./sessionFrameV2.js";
export type { SessionBlockRoleV2, DhFrameBlockV2 } from "./sessionFrameV2.js";

// UX-11A.5a.3 — session protocols V2 (templates, not read by any engine yet).
export {
  PROTOCOL_CATALOG_V2_VERSION,
  PROTOCOL_CATALOG_V2,
  PROTOCOL_CATALOG_V2_ENTRIES,
  PROTOCOL_SCOPES_V2,
  ENDURANCE_ACTIVITIES_V2,
  PROTOCOL_BLOCK_FOCUS_V2,
} from "./protocolCatalogV2.js";
export type {
  SessionProtocolV2,
  ProtocolBlockV2,
  ProtocolItemV2,
  ProtocolExerciseItemV2,
  ProtocolExerciseChoiceItemV2,
  ProtocolIntervalsItemV2,
  IntervalVariantV2,
  ProtocolScopeV2,
  ProtocolBlockFocusV2,
  EnduranceActivityV2,
} from "./protocolCatalogV2.js";

// UX-11A.5a.4 — strength templates, strength doses and plan dose policy V2 (content, not read by any engine yet).
export {
  STRENGTH_TEMPLATE_CATALOG_V2_VERSION,
  STRENGTH_TEMPLATE_CATALOG_V2,
  STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES,
  STRENGTH_TEMPLATE_SESSION_KINDS_V2,
  STRENGTH_FAMILIES_V2,
  STRENGTH_TRANSVERSAL_FAMILIES_V2,
  STRENGTH_EXCLUDED_FAMILIES_V2,
  STRENGTH_WORK_SLOT_ROLES_V2,
} from "./strengthTemplateCatalogV2.js";
export type { StrengthTemplateV2, StrengthWorkSlotV2, StrengthWarmUpV2, StrengthWorkSlotRoleV2, StrengthTemplateSessionKindV2 } from "./strengthTemplateCatalogV2.js";
export { STRENGTH_DOSE_CATALOG_V2_VERSION, STRENGTH_DOSE_CATALOG_V2, STRENGTH_LOAD_LEVELS_V2 } from "./strengthDoseCatalogV2.js";
export type { StrengthRoleDoseV2, StrengthLoadLevelV2 } from "./strengthDoseCatalogV2.js";
export { PLAN_DOSE_POLICY_V2_VERSION, PLAN_DOSE_POLICY_V2 } from "./planDosePolicyV2.js";
export type { PlanDosePolicyV2, PlanWeekDoseV2 } from "./planDosePolicyV2.js";
