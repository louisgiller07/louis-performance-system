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
  | "OTHER"
  | "UNSPECIFIED";

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

/** V0.3_008B — immutable snapshot of what today's coach actually surfaced from an earlier day. `source_decision_id` is internal provenance only, never rendered athlete-facing. No `age_days` (deliberately never persisted — see head-coach-engine/src/types/dailyPlan.ts's own doc). */
export interface PriorTaskReference {
  source_decision_id: string;
  session_date: string;
  kind: TrainingInterventionKind;
  execution_task: string;
  technical_outcome: "yes" | "partial" | "no";
}

export interface DhTechnicalSection {
  active: boolean;
  focus?: string;
  /** V0.3_006C1, corrected V0.3_008B0 — fixed generic task per DH-family kind, present whenever the final session is DH-family regardless of whether a personal technique_primary_focus is configured. Never derived from that free text. */
  execution_task?: string;
  /** V0.3_006C1 (final correction) — riding-behavior guidance for the final load_profile, engine-emitted/persisted. Render exactly as-is; never recompute from load_profile — a legacy plan predating this field must never gain it retroactively. */
  load_guidance?: string;
  spot_hint?: string;
  /** V0.3_008B — the most recent valid prior technical fact, display-only. Present only when `active === true` AND the engine resolved a candidate — never fabricated, immutable once persisted. */
  prior_task_reference?: PriorTaskReference;
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

/**
 * V0.3_008A — factual J-1 recovery context, never a dimension/score. Mirrors
 * head-coach-engine's RecentRecoveryContext exactly. Present only when a
 * real D-1 `completed_sessions` row was `change_reason = "fatigue_control"`
 * with `completion_status` ∈ {partial, replaced, skipped} — every other
 * reason stays inert, absent from a persisted DailyPlan entirely. Rendered
 * read-only, in its own dedicated section — never merged into `reasoning`.
 */
export type RecentRecoveryCompletionStatus = "partial" | "replaced" | "skipped";

export interface RecentRecoveryContext {
  session_date: string;
  completion_status: RecentRecoveryCompletionStatus;
  change_reason: "fatigue_control";
  post_leg_fatigue: number | null;
  post_grip_fatigue: number | null;
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

  /** V0.3.012 — the subset of triggered_rules that explains the final decision (same rules as `reasoning`/`training.objective`). Absent for any plan predating this field; consumers fall back to triggered_rules. */
  decision_reasoning?: TriggeredRule[];

  health_flag_to_create?: HealthFlagToCreate;

  planned_session_before: TrainingIntervention | null;
  final_session: TrainingIntervention;
  decision: ArbitrationDecision;

  overrode_race_protocol: boolean;
  override_reason?: string;

  /** V0.3_008A — immutable snapshot as persisted at generation time; never re-derived from live completed_sessions. Absent for any plan predating this field, or when no eligible D-1 context existed. */
  recent_recovery_context?: RecentRecoveryContext;

  engine_version: string;
}

// V0.5_047/048 — the athlete's exact, executable prescription for today
// (sets/reps/%, or drills/runs/cues), sourced from the canonical generated
// plan. Mirrors planning-engine's own PlannedPrescription/PrescriptionStructure
// (never imported directly — same "no shared build boundary" discipline as
// the rest of this file). Deliberately a SIBLING of DailyPlan, never a field
// on it: M1's frozen DailyPlan/TrainingIntervention carry no prescription
// concept at all — this is enrichment the backend layers on top, after M1's
// KEEP/MODIFY/REPLACE/REST decision is already final, and ONLY when that
// decision is exactly "KEEP" (see runDailyFor.ts's own lock — the backend
// gates this, not just the frontend).

export type ExecutableRepScheme =
  | { type: "fixed"; reps: number }
  | { type: "range"; min: number; max: number }
  | { type: "time"; seconds: number }
  | { type: "amrap" };

export type ExecutableIntensity =
  | { type: "rpe"; target: number }
  | { type: "rir"; target: number }
  | { type: "percent_1rm"; value: number }
  | { type: "fixed_load_kg"; value: number }
  | { type: "training_max_percent"; value: number }
  | { type: "bodyweight" };

export interface ExecutableStrengthBlock {
  role: string;
  /** Catalogue id, never a display string — no catalogue lookup is available to web/ (same precedent as trainingPlanReview's own exerciseId handling). Humanized mechanically at render time. */
  exerciseId: string;
  sets: number;
  repScheme: ExecutableRepScheme;
  intensity: ExecutableIntensity;
  restSeconds: number;
  tempo?: string;
  unilateral?: boolean;
  substitutionOf?: string;
}

export interface ExecutableStrengthPrescription {
  domain: "strength";
  schemaVersion: string;
  blocks: ExecutableStrengthBlock[];
}

export interface ExecutableDhDrill {
  /** Catalogue id, never a display string — same discipline as exerciseId above. */
  drillId: string;
  skillTarget: string;
  terrainRequirement: string;
  runs: number;
  executionCue: string;
  successCriterion: string;
  progressionCondition?: string;
  regressionCondition?: string;
}

export interface ExecutableDhPrescription {
  domain: "dh_technical";
  schemaVersion: string;
  drills: ExecutableDhDrill[];
}

// Closed union, exactly 2 domains — never "aerobic": that domain
// structurally has no PlannedPrescription anywhere in the system
// (planning-engine's own PRESCRIBABLE_DOMAINS never generates one for it).
export type ExecutablePrescriptionStructure = ExecutableStrengthPrescription | ExecutableDhPrescription;

export interface ExecutablePrescription {
  id: string;
  generatedPlanSessionId: string;
  schemaVersion: string;
  catalogVersion: string;
  structure: ExecutablePrescriptionStructure;
}

/** Exact response contract of supabase/functions/daily-run — see its index.ts. */
export interface DailyRunResponse {
  dailyPlan: DailyPlan;
  decisionId: string;
  healthFlagId: string | null;
  warnings: string[];
  /** Absent/null whenever decision !== "KEEP", the session has no canonical lineage, or the backend lookup itself failed (always best-effort — see runDailyFor.ts). */
  executablePrescription?: ExecutablePrescription | null;
}
