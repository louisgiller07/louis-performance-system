/**
 * Longitudinal source-domain types — owned by this package, not aliases or
 * re-exports of head-coach-engine's types. Deliberately narrower than the
 * full DB schema: only the fields longitudinal analysis actually needs.
 * Field names/nullability mirror the real Postgres schema
 * (supabase/migrations/**) as re-inspected directly for M5_002A — never
 * assumed from architecture prose.
 *
 * These are pure data facts, nothing more. No field here means "bad",
 * "good", "high fatigue", "adherent", "correlated", etc. — that
 * interpretation is future detector/calculator logic and does not belong
 * in this package's source layer. `energy: 4` is a fact; "energy is low"
 * is not decided here.
 *
 * Deliberately NOT included anywhere in this file: DH run counts,
 * school-week indicators, GPS/track-condition data, race telemetry — none
 * of these exist as real columns in the current schema, and M5_002A does
 * not invent them.
 */

// ===========================================================================
// Enums — mirrored verbatim from the real Postgres enum definitions.
// ===========================================================================

/** public.pain_location_code (supabase/migrations/20260814095000_baseline_v0_2.sql) */
export type PainLocationCode =
  | "lower_back"
  | "upper_back"
  | "neck"
  | "shoulder_L"
  | "shoulder_R"
  | "elbow_L"
  | "elbow_R"
  | "wrist_L"
  | "wrist_R"
  | "hand_L"
  | "hand_R"
  | "thumb_L"
  | "thumb_R"
  | "forearm_L"
  | "forearm_R"
  | "hip_L"
  | "hip_R"
  | "knee_L"
  | "knee_R"
  | "ankle_L"
  | "ankle_R"
  | "quad_L"
  | "quad_R"
  | "hamstring_L"
  | "hamstring_R"
  | "calf_L"
  | "calf_R"
  | "groin"
  | "chest"
  | "abs"
  | "head"
  | "other";

/**
 * public.session_type — the coarse DB session vocabulary. Deliberately
 * distinct from head-coach-engine's rich TrainingIntervention kinds (never
 * imported here — see the module doc in adapter.ts for the frozen-boundary
 * rule). This is what `decisions.final_session`/`planned_session_before`
 * and `completed_sessions.session_type` actually store.
 */
export type DbSessionType =
  | "STRENGTH_A"
  | "STRENGTH_B"
  | "AEROBIC_BASE"
  | "AEROBIC_INTERVALS"
  | "DH_TECHNICAL"
  | "DH_PERFORMANCE"
  | "RECOVERY"
  | "REST"
  | "BIKE_MAINTENANCE"
  | "RACE_PREP";

/** public.completion_status */
export type CompletionStatus = "done" | "partial" | "skipped" | "replaced";

/** public.health_flag_type */
export type HealthFlagType = "injury_suspect" | "concussion_suspect" | "illness" | "pain_persistent" | "other";

/** public.health_flag_status */
export type HealthFlagStatus = "active" | "monitoring" | "resolved";

/** public.confidence_level (M2_002) */
export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

/** public.training_mode */
export type TrainingMode =
  | "RACE_WEEK"
  | "RACE_CLUSTER"
  | "OFF_SEASON_RECOVERY"
  | "OFF_SEASON_DEVELOPMENT"
  | "PRE_SEASON"
  | "IN_SEASON"
  | "INJURY_RECOVERY"
  | "OTHER";

/** public.decision_outcome_horizon (M5_001B) */
export type DecisionOutcomeHorizon = "J_PLUS_1" | "J_PLUS_3" | "J_PLUS_7";

// ===========================================================================
// Daily check-in source — public.daily_checkins
// ===========================================================================
/**
 * `pain_location` (legacy free-text column, superseded by
 * `pain_location_code`) is deliberately excluded — not consumed anywhere.
 */
export interface DailyCheckinSource {
  id: string;
  athleteId: string;
  /** date, "YYYY-MM-DD" */
  checkinDate: string;
  /** timestamptz, ISO 8601 */
  submittedAt: string;

  sleepHours: number | null;
  sleepQuality: number | null;
  sleepWakeUps: number | null;

  energy: number | null;
  legFatigue: number | null;
  gripFatigue: number | null;
  motivation: number | null;
  workStress: number | null;

  /** NOT NULL DEFAULT false in the DB — never null. */
  pain: boolean;
  painIntensity: number | null;
  /** nullable boolean — no DB default; true tri-state (true/false/unknown). */
  painNew: boolean | null;
  painLocationCode: PainLocationCode | null;
  /** M2_001 — nullable boolean, NULL on rows predating M2 (unknown, never backfilled). */
  painTraumatic: boolean | null;
  painFunctionLoss: boolean | null;
  painGettingWorse: boolean | null;

  /** NOT NULL DEFAULT false. */
  suspectedConcussion: boolean;
  /** NOT NULL DEFAULT false. */
  feverOrIllness: boolean;

  freeComment: string | null;
}

// ===========================================================================
// Decision source — public.decisions
// ===========================================================================
/**
 * Deliberately excluded: `reviewed_after_days`/`outcome_note` (legacy,
 * unused outcome columns — decision_outcomes, M5_001B, is the real outcome
 * mechanism; reviving these would contradict that design) and the pre-M2
 * scalar fields now superseded by `daily_plan` (`reason`, `triggered_rules`,
 * `do_not_do`, `readiness_score`/`zone`, `fatigue_load_7d`/`zone`,
 * `session_content_ref`, legacy `confidence` numeric, `stop_conditions`,
 * `source_state_id`) — none of these are read anywhere in the current
 * application and are not "actually needed" per this package's own
 * minimalism mandate.
 */
export interface DecisionSource {
  id: string;
  athleteId: string;
  /** date, "YYYY-MM-DD" */
  decisionDate: string;
  /** timestamptz */
  computedAt: string;

  finalSession: DbSessionType;
  plannedSessionBefore: DbSessionType | null;

  /** M2 — null on any row predating M2 (see docs/11_DECISION_LOG.md, M2_002). */
  activeMode: TrainingMode | null;
  /** M2 — null on any row predating M2. */
  confidenceLevel: ConfidenceLevel | null;
  /**
   * M2's `daily_plan` JSONB — the canonical rich DailyPlan, verbatim. Kept
   * opaque here: this package only preserves it as a JSON object, it never
   * interprets its internal shape (that belongs to a future calculator,
   * which will validate whatever subset of fields it actually consumes —
   * exactly the same "only mirror what's read" discipline already used by
   * web/src/features/dailyPlan/dailyPlanTypes.ts, but this package does not
   * import that mirror either, since it owns its own types). Null on rows
   * predating M2.
   */
  dailyPlan: Record<string, unknown> | null;

  engineVersion: string;
  overriddenByUser: boolean;
  overrideReason: string | null;

  sourceCheckinId: string | null;
}

// ===========================================================================
// Completed-session source — public.completed_sessions
// ===========================================================================
export interface CompletedSessionSource {
  id: string;
  athleteId: string;
  /** date, "YYYY-MM-DD" */
  sessionDate: string;
  decisionId: string | null;
  plannedSessionId: string | null;

  sessionType: DbSessionType;
  completionStatus: CompletionStatus;

  actualDurationMin: number | null;
  rpe: number | null;
  /** Trigger-derived (`trg_compute_session_load`) — a read-only fact, never computed by this package. */
  sessionLoad: number | null;

  /** M2_004 — rich TrainingIntervention JSON, opaque (see DecisionSource.dailyPlan doc for why). */
  intervention: Record<string, unknown> | null;
  /** Free-form JSONB, no established convention (per M2 audit) — preserved opaque. */
  mainContent: Record<string, unknown> | null;

  postLegFatigue: number | null;
  postGripFatigue: number | null;
  /** NOT NULL DEFAULT false in the DB. */
  newPain: boolean;
  newPainNote: string | null;
}

// ===========================================================================
// Decision-outcome source — public.decision_outcomes (M5_001B)
// ===========================================================================
/** Immutable historical facts — decision_outcomes rows are never updated after insert (see M5_001B). */
export interface DecisionOutcomeSource {
  id: string;
  athleteId: string;
  decisionId: string;
  horizon: DecisionOutcomeHorizon;
  calculatorId: string;
  calculatorVersion: string;
  /** Opaque — the deterministic facts a calculator actually consumed at calculation time. */
  inputSnapshot: Record<string, unknown>;
  /** Opaque — the deterministic results that calculator produced. */
  outcomeSignals: Record<string, unknown>;
  /** timestamptz */
  calculatedAt: string;
  /** timestamptz */
  createdAt: string;
}

// ===========================================================================
// Health-flag source — public.health_flags
// ===========================================================================
/** `updated_at` deliberately excluded — `createdAt` + `resolvedAt` already capture the lifecycle this package needs. */
export interface HealthFlagSource {
  id: string;
  athleteId: string;
  /** date, "YYYY-MM-DD" — when the flag was raised. */
  flagDate: string;
  flagType: HealthFlagType;
  status: HealthFlagStatus;
  description: string;
  bodyLocation: string | null;
  intensity: number | null;
  professionalConsulted: boolean;
  professionalType: string | null;
  /** date, nullable — set once resolved. */
  resolvedAt: string | null;
  resolutionNote: string | null;
  sourceCheckinId: string | null;
  /** timestamptz */
  createdAt: string;
}
