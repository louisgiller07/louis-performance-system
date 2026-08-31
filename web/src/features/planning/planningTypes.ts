// Types for the athlete-facing planning write path (V0.3_003B). Reuses the
// existing TrainingIntervention mirror from the dailyPlan feature rather
// than redefining it — see dailyPlanTypes.ts's own comment on why it's a
// local mirror (no shared build boundary between web/ and head-coach-engine).
import type { TrainingIntervention, TrainingInterventionKind, LoadProfile } from "../dailyPlan/dailyPlanTypes";
import type { CoarseSessionType } from "../dailyPlan/trainingInterventionToSessionType";

export type { TrainingIntervention, TrainingInterventionKind, LoadProfile, CoarseSessionType };

// The 4 FixedLoadKind values an athlete may actually plan. RACE_ACTIVITY is
// the 5th FixedLoadKind in head-coach-engine/src/types/trainingIntervention.ts
// but is exclusively race-protocol-derived — never athlete-plannable (locked,
// docs/11_DECISION_LOG.md V0.3_003A).
export const PLANNABLE_FIXED_LOAD_KINDS = ["MOBILITY", "RECOVERY_ACTIVE", "REST", "BIKE_MAINTENANCE"] as const;

// The 11 LoadVariableKind values, all athlete-plannable.
export const PLANNABLE_LOAD_VARIABLE_KINDS = [
  "STRENGTH_LOWER",
  "STRENGTH_UPPER",
  "STRENGTH_FULL_LIGHT",
  "POWER",
  "GRIP_WORK",
  "AEROBIC_BASE",
  "AEROBIC_INTERVALS",
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "DH_LIGHT",
  "PUMPTRACK",
] as const;

// 15 of the 16 TrainingInterventionKind values — everything except RACE_ACTIVITY.
export const PLANNABLE_KINDS: readonly TrainingInterventionKind[] = [
  ...PLANNABLE_LOAD_VARIABLE_KINDS,
  ...PLANNABLE_FIXED_LOAD_KINDS,
];

const LOAD_PROFILES: readonly LoadProfile[] = ["HEAVY", "MODERATE", "LIGHT"];

export function isPlannableFixedLoadKind(kind: string): boolean {
  return (PLANNABLE_FIXED_LOAD_KINDS as readonly string[]).includes(kind);
}

export function isPlannableLoadVariableKind(kind: string): boolean {
  return (PLANNABLE_LOAD_VARIABLE_KINDS as readonly string[]).includes(kind);
}

export function isLoadProfile(value: string): value is LoadProfile {
  return (LOAD_PROFILES as readonly string[]).includes(value);
}

/**
 * Row shape as read from `planned_sessions` — mirrors exactly the columns
 * head-coach-engine's getPlannedSessionFor selects
 * (src/supabase/repositories/plannedSessionsRepo.ts: "session_type,
 * intervention, planned_intent"), plus planned_date to identify the row.
 * The five engine-inert columns (primary_objective, planned_duration_min,
 * planned_time_of_day, training_block_id, notes) are deliberately not read
 * here — out of scope for V0.3_003B (docs/11_DECISION_LOG.md V0.3_003A).
 */
export interface PlannedSessionRow {
  planned_date: string;
  session_type: CoarseSessionType;
  intervention: TrainingIntervention | null;
  planned_intent: string | null;
}
