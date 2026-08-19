// Mirrors only the public.decisions columns this feature actually reads
// (see supabase/migrations/20260814095000_baseline_v0_2.sql and
// .../20260816195000_M2_002_decisions_daily_plan.sql). `daily_plan` is the
// M2 JSONB source of truth (head-coach-engine's real DailyPlan, verbatim —
// see dailyPlanToDecisionRow.ts) but is `unknown` at this layer: an older
// row's shape isn't guaranteed to match the current DailyPlan contract, so
// it's only trusted after isValidDailyPlan() passes (dailyPlanValidation.ts).
//
// `finalSessionDb` is the coarse legacy `session_type` enum column
// (STRENGTH_A, RECOVERY, ...) — a different vocabulary from the engine's
// rich TrainingInterventionKind (STRENGTH_LOWER, RECOVERY_ACTIVE, ...) and
// never run through dailyPlanLabels.ts's TRAINING_KIND_LABELS.
//
// `activeModeDb`/`confidenceLevelDb` are the M2 columns added alongside
// daily_plan (same migration) — the DAL writes them verbatim from
// dailyPlan.active_mode/.confidence (dailyPlanToDecisionRow.ts), so unlike
// finalSessionDb they DO share the rich vocabulary and can go through
// TRAINING_MODE_LABELS/CONFIDENCE_LABELS. Both are `null` on any row
// predating M2 (CLAUDE.md: "restent NULL sur les rows antérieures à M2") —
// never assumed present.
//
// These three DB columns are the last-resort, always-available fallback
// used only when daily_plan can't be trusted (a legacy/malformed row) —
// never a "second source" consulted alongside a valid daily_plan.
export interface DecisionHistoryRow {
  id: string;
  decisionDate: string;
  createdAt: string;
  finalSessionDb: string;
  activeModeDb: string | null;
  confidenceLevelDb: string | null;
  dailyPlan: unknown;
}
