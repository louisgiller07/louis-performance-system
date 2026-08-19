// Minimal mirror of the real field names in
// head-coach-engine/src/types/dailyPlan.ts, healthFlag.ts, context.ts —
// only the fields M4_004 actually renders. head-coach-engine is never
// imported directly from web/ (no shared build boundary between the two
// packages) and never modified from here.

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

/** Real DailyPlan has more sections (training, recovery, nutrition, sleep, protection, monitoring, triggered_rules, ...) — not needed until M4_005. */
export interface DailyPlan {
  date: string;
  active_mode: TrainingMode;
  decision: ArbitrationDecision;
  confidence: Confidence;
  reasoning: string;
  health_flag_to_create?: HealthFlagToCreate;
}

/** Exact response contract of supabase/functions/daily-run — see its index.ts. */
export interface DailyRunResponse {
  dailyPlan: DailyPlan;
  decisionId: string;
  healthFlagId: string | null;
  warnings: string[];
}
