// V0.5_027 — Training Plan Review, frontend-owned read types. Same
// discipline as dailyPlan/dailyPlanTypes.ts: a deliberate, hand-maintained
// mirror of the real backend shapes (planning-engine/src/types/{planVersion,
// planWeek}.ts, the training_plan_* migrations) — never an import from
// planning-engine/prescription-engine (no shared build boundary between
// web/ and the engine packages, V0.5_018/026 lock).
//
// `doseTarget` (training_plan_generated_sessions.dose_target) and
// `structure` (training_plan_planned_prescriptions.structure) are kept as
// `unknown` here, deliberately — both are discriminated unions with several
// domain-specific shapes (strength/dh_technical/aerobic/recovery), and this
// ticket's scope is data access + relation reconstruction, not an exhaustive
// mirror of every nested JSONB shape. A future UI ticket can narrow these
// locally without changing this contract. `doseSummary` and
// `relaxedConstraints` ARE mirrored precisely below — both are small, stable
// shapes already identified as UI-relevant (V0.5_026).

/** The real lifecycle enum (public.training_plan_lifecycle_state) — never a new value invented here. Reconstructed from training_plan_version_lifecycle_transitions; no `status` column exists on training_plan_versions itself. */
export type TrainingPlanLifecycleState = "draft" | "accepted" | "superseded" | "abandoned";

/** Mirrors planning-engine's RelaxedConstraint (planVersion.ts) exactly. */
export interface TrainingPlanReviewRelaxedConstraint {
  constraintId: string;
  reason: string;
  domain?: string;
  date?: string;
}

/** Mirrors planning-engine's WeekDoseSummary (planWeek.ts) exactly. */
export interface TrainingPlanReviewDoseSummary {
  plannedStrengthSessionCount: number;
  plannedDhTechnicalSessionCount: number;
  plannedAerobicSessionCount: number;
  plannedRestOrRecoveryDayCount: number;
  totalPlannedMinutes: number;
}

export interface TrainingPlanReviewPrescription {
  id: string;
  generatedPlanSessionId: string;
  /** Discriminated union (strength blocks vs DH drills) — deliberately not narrowed here, see module doc. */
  structure: unknown;
}

export interface TrainingPlanReviewSession {
  id: string;
  weekId: string;
  date: string;
  kind: string;
  loadProfile: string | null;
  durationMin: number | null;
  /** Discriminated union by domain — deliberately not narrowed here, see module doc. */
  doseTarget: unknown;
  rationale: string;
  /** `null` for a session with no prescription — always true for aerobic/rest/recovery kinds (never generated for them, locked V0.4_119), never a placeholder. */
  prescription: TrainingPlanReviewPrescription | null;
}

export interface TrainingPlanReviewWeek {
  id: string;
  blockId: string;
  weekNumber: number;
  startDate: string;
  endDate: string;
  weekType: string;
  rationale: string;
  doseSummary: TrainingPlanReviewDoseSummary;
  sessions: TrainingPlanReviewSession[];
}

export interface TrainingPlanReviewBlock {
  id: string;
  sequenceNumber: number;
  name: string;
  mode: string;
  primaryFocus: string;
  startDate: string;
  endDate: string;
  weeks: TrainingPlanReviewWeek[];
}

export interface TrainingPlanReviewVersion {
  id: string;
  horizonStartDate: string;
  horizonEndDate: string;
  generationTrigger: string;
  rationale: string;
  relaxedConstraints: TrainingPlanReviewRelaxedConstraint[];
  generatedAt: string;
}

/** The full tree the UI needs for one version — no page has to reconstruct block/week/session/prescription relations itself (V0.5_026 lock). */
export interface TrainingPlanReview {
  version: TrainingPlanReviewVersion;
  lifecycleState: TrainingPlanLifecycleState;
  blocks: TrainingPlanReviewBlock[];
}

/** Lightweight entry for a drafts list/picker — deliberately excludes blocks/weeks/sessions/prescriptions, which getTrainingPlanDrafts() never loads for every draft at once (see trainingPlanReviewRepo.ts's own module doc). */
export interface TrainingPlanDraftSummary {
  id: string;
  horizonStartDate: string;
  horizonEndDate: string;
  generationTrigger: string;
  rationale: string;
  generatedAt: string;
}
