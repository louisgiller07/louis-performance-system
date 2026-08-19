// Minimal mirror of the real field names in
// head-coach-engine/src/types/{dailyPlan,trainingIntervention,triggeredRule,healthFlag,context}.ts
// — only the parts M4_005 actually renders. head-coach-engine is never
// imported directly from web/ (no shared build boundary between the two
// packages) and never modified from here. `date` and `event_context` exist
// on the real DailyPlan but are not mirrored — TodayPage already shows the
// checkin date, and event_context isn't rendered yet.

export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type ArbitrationDecision = "KEEP" | "MODIFY" | "REPLACE" | "REST";

export type TrainingMode =
  | "RACE_WEEK"
  | "RACE_CLUSTER"
  | "OFF_SEASON_RECOVERY"
  | "OFF_SEASON_DEVELOPMENT"
  | "PRE_SEASON"
  | "IN_SEASON"
  | "INJURY_RECOVERY"
  | "OTHER";

export type HealthFlagType = "concussion_suspect" | "injury_suspect" | "illness" | "pain_persistent";

export interface HealthFlagToCreate {
  type: HealthFlagType;
  reason: string;
}

export type LoadProfile = "HEAVY" | "MODERATE" | "LIGHT";

// The real type is a discriminated union (LoadVariableKind requires
// load_profile, FixedLoadKind forbids it) — the frontend only ever reads
// these fields for display, so a single interface with load_profile
// optional is faithful enough without importing the engine's own
// discriminant machinery.
export type TrainingInterventionKind =
  | "STRENGTH_LOWER"
  | "STRENGTH_UPPER"
  | "STRENGTH_FULL_LIGHT"
  | "POWER"
  | "GRIP_WORK"
  | "AEROBIC_BASE"
  | "AEROBIC_INTERVALS"
  | "DH_TECHNICAL"
  | "DH_PERFORMANCE"
  | "DH_LIGHT"
  | "PUMPTRACK"
  | "MOBILITY"
  | "RECOVERY_ACTIVE"
  | "REST"
  | "BIKE_MAINTENANCE"
  | "RACE_ACTIVITY";

export interface TrainingIntervention {
  kind: TrainingInterventionKind;
  load_profile?: LoadProfile;
  duration_min?: number;
  focus?: string;
  cue?: string;
}

export interface TrainingPlanSection {
  active: boolean;
  session_type?: TrainingIntervention;
  duration_min?: number;
  time_slot?: string;
  content_ref?: string;
  objective?: string;
}

export interface DhTechnicalSection {
  active: boolean;
  focus?: string;
  spot_hint?: string;
}

export interface MentalSection {
  active: boolean;
  focus?: string;
  action_hint?: string;
}

export interface RecoverySection {
  active: boolean;
  actions: string[];
}

export interface NutritionSection {
  active: boolean;
  focus?: string;
  hydration_target_l?: number;
  notes?: string;
}

export interface SleepSection {
  active: boolean;
  target_hours?: number;
  bedtime_hint?: string;
  notes?: string;
}

export interface ProtectionSection {
  do_not_do: string[];
}

export interface MonitoringSection {
  observe: string[];
}

export type RuleLayer = "A" | "B" | "C" | "ARBITRATION";

export interface TriggeredRule {
  layer: RuleLayer;
  rule_id: string;
  detail: string;
  signals_used?: string[];
}

export interface DailyPlan {
  active_mode: TrainingMode;

  training: TrainingPlanSection;
  dh_or_technical: DhTechnicalSection;
  mental: MentalSection;
  recovery: RecoverySection;
  nutrition: NutritionSection;
  sleep: SleepSection;
  protection: ProtectionSection;
  monitoring: MonitoringSection;

  reasoning: string;
  confidence: Confidence;

  triggered_rules: TriggeredRule[];
  health_flag_to_create?: HealthFlagToCreate;

  planned_session_before: TrainingIntervention | null;
  final_session: TrainingIntervention;
  decision: ArbitrationDecision;

  overrode_race_protocol: boolean;
  override_reason?: string;

  engine_version: string;
}

/** Exact response contract of supabase/functions/daily-run — see its index.ts. */
export interface DailyRunResponse {
  dailyPlan: DailyPlan;
  decisionId: string;
  healthFlagId: string | null;
  warnings: string[];
}
