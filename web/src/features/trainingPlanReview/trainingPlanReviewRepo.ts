// V0.5_027 — Training Plan Review, read-only repository. Same discipline as
// athleteOnboardingRepo.ts/performanceSetupRepo.ts: the authenticated user's
// own Supabase client only, RLS (training_plan_versions_own_select and the
// 4 sibling `_own_select` policies) is the sole authority on which rows are
// visible — never a service/secret key, never an Edge Function (confirmed
// V0.5_025/026: all 5 tables + the lifecycle transitions table carry a real
// `for select to authenticated using (athlete_id in ...)`/`plan_version_id
// in (...)` policy — reading a draft needs no elevated access at all).
//
// `training_plan_versions` carries no `status` column by design (M0 lock,
// see the migration's own module doc: "content-only, insert-once, no status
// field — lifecycle lives entirely in training_plan_version_lifecycle_
// transitions"). This file never invents one — the current state of a
// version is always reconstructed as its transition with the highest
// transition_number (see latestStateByVersion below), exactly the same rule
// `accept_training_plan_version` itself uses server-side.
//
// Column selection is deliberately narrower than each table's full column
// set — see V0.5_027's own ticket: training_plan_versions omits
// input_snapshot/input_snapshot_hash/input_snapshot_schema_version/
// planner_version/ruleset_version/catalog_version/prescription_schema_
// version/generation_request_id (internal generation metadata, never
// meaningful to an athlete); training_plan_generated_sessions omits `focus`/
// `generation_note` (real columns, deliberately excluded — not in this
// ticket's explicit field list, not silently forgotten); training_plan_
// planned_prescriptions omits schema_version/catalog_version.
//
// V0.5_028 — getActivePlanVersionId() added (extends this same file, within
// this ticket's authorized directory): the acceptance confirmation step
// needs to know whether accepting a draft would replace an already-active
// plan (training_plan_current_version, RLS-readable — confirmed V0.5_025).
// Not part of the V0.5_027 read tree itself (a version/block/week/session/
// prescription concern) — a separate, minimal read, same "own_select" RLS
// idiom as everything else in this file.
import { supabase } from "../../lib/supabase";
import type {
  TrainingPlanReview,
  TrainingPlanReviewVersion,
  TrainingPlanReviewBlock,
  TrainingPlanReviewWeek,
  TrainingPlanReviewSession,
  TrainingPlanReviewPrescription,
  TrainingPlanReviewDoseSummary,
  TrainingPlanReviewRelaxedConstraint,
  TrainingPlanLifecycleState,
  TrainingPlanDraftSummary,
} from "./trainingPlanReviewTypes";

export class TrainingPlanReviewError extends Error {
  constructor() {
    super("Impossible de charger ton plan d'entraînement. Réessaie dans un instant.");
    this.name = "TrainingPlanReviewError";
  }
}

/** Thrown by getTrainingPlanReview() for an id that does not exist OR is not visible to the current athlete under RLS — the two are structurally indistinguishable (RLS denial is silently zero rows, never a Supabase `error`), and deliberately never told apart here, same reasoning as every other "not found" case in this codebase (never leak whether a foreign id exists). */
export class TrainingPlanVersionNotFoundError extends Error {
  readonly planVersionId: string;

  constructor(planVersionId: string) {
    super(`Training plan version ${planVersionId} was not found.`);
    this.name = "TrainingPlanVersionNotFoundError";
    this.planVersionId = planVersionId;
  }
}

const VERSION_COLUMNS = "id, horizon_start_date, horizon_end_date, generation_trigger, rationale, relaxed_constraints, generated_at";
const BLOCK_COLUMNS = "id, plan_version_id, sequence_number, name, mode, primary_focus, start_date, end_date";
const WEEK_COLUMNS = "id, block_id, plan_version_id, week_number, start_date, end_date, week_type, dose_summary, rationale";
const SESSION_COLUMNS = "id, week_id, plan_version_id, date, kind, load_profile, duration_min, dose_target, rationale";
const PRESCRIPTION_COLUMNS = "id, generated_plan_session_id, plan_version_id, structure";
const TRANSITION_COLUMNS = "plan_version_id, transition_number, state";

export interface TrainingPlanVersionRawRow {
  id: string;
  horizon_start_date: string;
  horizon_end_date: string;
  generation_trigger: string;
  rationale: string;
  relaxed_constraints: unknown;
  generated_at: string;
}

export interface TrainingPlanLifecycleTransitionRawRow {
  plan_version_id: string;
  transition_number: number;
  state: string;
}

export interface TrainingPlanBlockRawRow {
  id: string;
  plan_version_id: string;
  sequence_number: number;
  name: string;
  mode: string;
  primary_focus: string;
  start_date: string;
  end_date: string;
}

export interface TrainingPlanWeekRawRow {
  id: string;
  block_id: string;
  plan_version_id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  week_type: string;
  dose_summary: unknown;
  rationale: string;
}

export interface TrainingPlanGeneratedSessionRawRow {
  id: string;
  week_id: string;
  plan_version_id: string;
  date: string;
  kind: string;
  load_profile: string | null;
  duration_min: number | null;
  dose_target: unknown;
  rationale: string;
}

export interface TrainingPlanPlannedPrescriptionRawRow {
  id: string;
  generated_plan_session_id: string;
  plan_version_id: string;
  structure: unknown;
}

function mapRelaxedConstraints(value: unknown): TrainingPlanReviewRelaxedConstraint[] {
  return Array.isArray(value) ? (value as TrainingPlanReviewRelaxedConstraint[]) : [];
}

function mapDoseSummary(value: unknown): TrainingPlanReviewDoseSummary {
  const obj = (value !== null && typeof value === "object" ? value : {}) as Partial<TrainingPlanReviewDoseSummary>;
  return {
    plannedStrengthSessionCount: obj.plannedStrengthSessionCount ?? 0,
    plannedDhTechnicalSessionCount: obj.plannedDhTechnicalSessionCount ?? 0,
    plannedAerobicSessionCount: obj.plannedAerobicSessionCount ?? 0,
    plannedRestOrRecoveryDayCount: obj.plannedRestOrRecoveryDayCount ?? 0,
    totalPlannedMinutes: obj.totalPlannedMinutes ?? 0,
  };
}

function mapVersion(row: TrainingPlanVersionRawRow): TrainingPlanReviewVersion {
  return {
    id: row.id,
    horizonStartDate: row.horizon_start_date,
    horizonEndDate: row.horizon_end_date,
    generationTrigger: row.generation_trigger,
    rationale: row.rationale,
    relaxedConstraints: mapRelaxedConstraints(row.relaxed_constraints),
    generatedAt: row.generated_at,
  };
}

function mapDraftSummary(row: TrainingPlanVersionRawRow): TrainingPlanDraftSummary {
  return {
    id: row.id,
    horizonStartDate: row.horizon_start_date,
    horizonEndDate: row.horizon_end_date,
    generationTrigger: row.generation_trigger,
    rationale: row.rationale,
    generatedAt: row.generated_at,
  };
}

/**
 * Reduces a flat list of lifecycle transitions to "current state per
 * plan_version_id" — the transition with the highest transition_number wins
 * for each version, exactly the rule `accept_training_plan_version` itself
 * uses server-side ("current lifecycle state" = latest transition). Pure,
 * no I/O — independently testable.
 */
export function latestStateByVersion(
  rows: readonly TrainingPlanLifecycleTransitionRawRow[]
): Map<string, TrainingPlanLifecycleState> {
  const latest = new Map<string, TrainingPlanLifecycleTransitionRawRow>();
  for (const row of rows) {
    const current = latest.get(row.plan_version_id);
    if (!current || row.transition_number > current.transition_number) {
      latest.set(row.plan_version_id, row);
    }
  }
  const result = new Map<string, TrainingPlanLifecycleState>();
  for (const [versionId, row] of latest) {
    result.set(versionId, row.state as TrainingPlanLifecycleState);
  }
  return result;
}

function mapPrescription(row: TrainingPlanPlannedPrescriptionRawRow): TrainingPlanReviewPrescription {
  return { id: row.id, generatedPlanSessionId: row.generated_plan_session_id, structure: row.structure };
}

function mapSession(
  row: TrainingPlanGeneratedSessionRawRow,
  prescriptionBySessionId: ReadonlyMap<string, TrainingPlanPlannedPrescriptionRawRow>
): TrainingPlanReviewSession {
  const prescriptionRow = prescriptionBySessionId.get(row.id);
  return {
    id: row.id,
    weekId: row.week_id,
    date: row.date,
    kind: row.kind,
    loadProfile: row.load_profile,
    durationMin: row.duration_min,
    doseTarget: row.dose_target,
    rationale: row.rationale,
    prescription: prescriptionRow ? mapPrescription(prescriptionRow) : null,
  };
}

function mapWeek(
  row: TrainingPlanWeekRawRow,
  sessionsByWeekId: ReadonlyMap<string, TrainingPlanGeneratedSessionRawRow[]>,
  prescriptionBySessionId: ReadonlyMap<string, TrainingPlanPlannedPrescriptionRawRow>
): TrainingPlanReviewWeek {
  const sessions = (sessionsByWeekId.get(row.id) ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((session) => mapSession(session, prescriptionBySessionId));

  return {
    id: row.id,
    blockId: row.block_id,
    weekNumber: row.week_number,
    startDate: row.start_date,
    endDate: row.end_date,
    weekType: row.week_type,
    rationale: row.rationale,
    doseSummary: mapDoseSummary(row.dose_summary),
    sessions,
  };
}

function mapBlock(
  row: TrainingPlanBlockRawRow,
  weeksByBlockId: ReadonlyMap<string, TrainingPlanWeekRawRow[]>,
  sessionsByWeekId: ReadonlyMap<string, TrainingPlanGeneratedSessionRawRow[]>,
  prescriptionBySessionId: ReadonlyMap<string, TrainingPlanPlannedPrescriptionRawRow>
): TrainingPlanReviewBlock {
  const weeks = (weeksByBlockId.get(row.id) ?? [])
    .slice()
    .sort((a, b) => a.week_number - b.week_number)
    .map((week) => mapWeek(week, sessionsByWeekId, prescriptionBySessionId));

  return {
    id: row.id,
    sequenceNumber: row.sequence_number,
    name: row.name,
    mode: row.mode,
    primaryFocus: row.primary_focus,
    startDate: row.start_date,
    endDate: row.end_date,
    weeks,
  };
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * Pure assembly — no I/O, never mutates any input row. Reconstructs the full
 * version -> blocks -> weeks -> sessions -> prescription tree from the flat
 * rows already fetched from each of the 5 tables, so no page has to
 * reconstruct these relations itself (V0.5_026 lock). A block/week/session
 * with no children resolves to an empty array, never an error — legitimate
 * (e.g. an aerobic session's `prescription: null`).
 */
export function assembleTrainingPlanReview(
  versionRow: TrainingPlanVersionRawRow,
  lifecycleState: TrainingPlanLifecycleState,
  blockRows: readonly TrainingPlanBlockRawRow[],
  weekRows: readonly TrainingPlanWeekRawRow[],
  sessionRows: readonly TrainingPlanGeneratedSessionRawRow[],
  prescriptionRows: readonly TrainingPlanPlannedPrescriptionRawRow[]
): TrainingPlanReview {
  const weeksByBlockId = groupBy(weekRows, (w) => w.block_id);
  const sessionsByWeekId = groupBy(sessionRows, (s) => s.week_id);
  const prescriptionBySessionId = new Map(prescriptionRows.map((p) => [p.generated_plan_session_id, p] as const));

  const blocks = blockRows
    .slice()
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map((block) => mapBlock(block, weeksByBlockId, sessionsByWeekId, prescriptionBySessionId));

  return { version: mapVersion(versionRow), lifecycleState, blocks };
}

async function fetchLifecycleStates(planVersionIds: readonly string[]): Promise<Map<string, TrainingPlanLifecycleState>> {
  if (planVersionIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("training_plan_version_lifecycle_transitions")
    .select(TRANSITION_COLUMNS)
    .in("plan_version_id", planVersionIds);

  if (error) {
    console.error("trainingPlanReviewRepo.fetchLifecycleStates failed", error.code);
    throw new TrainingPlanReviewError();
  }

  return latestStateByVersion((data ?? []) as TrainingPlanLifecycleTransitionRawRow[]);
}

/**
 * All of the athlete's training plan versions currently in `draft` state,
 * most recently generated first (matches idx_training_plan_versions_athlete_
 * generated's own ordering). Never assumes at most one — the DB has no
 * constraint preventing several simultaneous drafts (confirmed V0.5_025).
 * An athlete with none returns an empty array, never an error.
 */
export async function getTrainingPlanDrafts(): Promise<TrainingPlanDraftSummary[]> {
  const { data, error } = await supabase
    .from("training_plan_versions")
    .select(VERSION_COLUMNS)
    .order("generated_at", { ascending: false });

  if (error) {
    console.error("trainingPlanReviewRepo.getTrainingPlanDrafts failed", error.code);
    throw new TrainingPlanReviewError();
  }

  const versionRows = (data ?? []) as TrainingPlanVersionRawRow[];
  if (versionRows.length === 0) return [];

  const states = await fetchLifecycleStates(versionRows.map((v) => v.id));

  return versionRows.filter((v) => states.get(v.id) === "draft").map(mapDraftSummary);
}

/**
 * The full review tree for exactly one version, regardless of its current
 * lifecycle state (an explicit id is a deliberate choice by the caller, not
 * necessarily a draft — e.g. reviewing an already-accepted version later).
 * Throws {@link TrainingPlanVersionNotFoundError} if the id does not exist
 * or is not visible to the current athlete under RLS.
 */
export async function getTrainingPlanReview(planVersionId: string): Promise<TrainingPlanReview> {
  const { data: versionRow, error: versionError } = await supabase
    .from("training_plan_versions")
    .select(VERSION_COLUMNS)
    .eq("id", planVersionId)
    .maybeSingle();

  if (versionError) {
    console.error("trainingPlanReviewRepo.getTrainingPlanReview: version read failed", versionError.code);
    throw new TrainingPlanReviewError();
  }
  if (!versionRow) {
    throw new TrainingPlanVersionNotFoundError(planVersionId);
  }

  const [states, blocksResult, weeksResult, sessionsResult, prescriptionsResult] = await Promise.all([
    fetchLifecycleStates([planVersionId]),
    supabase.from("training_plan_blocks").select(BLOCK_COLUMNS).eq("plan_version_id", planVersionId),
    supabase.from("training_plan_weeks").select(WEEK_COLUMNS).eq("plan_version_id", planVersionId),
    supabase.from("training_plan_generated_sessions").select(SESSION_COLUMNS).eq("plan_version_id", planVersionId),
    supabase.from("training_plan_planned_prescriptions").select(PRESCRIPTION_COLUMNS).eq("plan_version_id", planVersionId),
  ]);

  if (blocksResult.error) {
    console.error("trainingPlanReviewRepo.getTrainingPlanReview: blocks read failed", blocksResult.error.code);
    throw new TrainingPlanReviewError();
  }
  if (weeksResult.error) {
    console.error("trainingPlanReviewRepo.getTrainingPlanReview: weeks read failed", weeksResult.error.code);
    throw new TrainingPlanReviewError();
  }
  if (sessionsResult.error) {
    console.error("trainingPlanReviewRepo.getTrainingPlanReview: sessions read failed", sessionsResult.error.code);
    throw new TrainingPlanReviewError();
  }
  if (prescriptionsResult.error) {
    console.error("trainingPlanReviewRepo.getTrainingPlanReview: prescriptions read failed", prescriptionsResult.error.code);
    throw new TrainingPlanReviewError();
  }

  const lifecycleState = states.get(planVersionId);
  if (lifecycleState === undefined) {
    // A version row exists but has no lifecycle transition at all — every
    // real version always gets its transition 1 inserted atomically by
    // generate_training_plan_version, so this is a data-integrity violation,
    // never silently defaulted to "draft".
    console.error(`trainingPlanReviewRepo.getTrainingPlanReview: ${planVersionId} has no lifecycle transition`);
    throw new TrainingPlanReviewError();
  }

  return assembleTrainingPlanReview(
    versionRow as TrainingPlanVersionRawRow,
    lifecycleState,
    (blocksResult.data ?? []) as TrainingPlanBlockRawRow[],
    (weeksResult.data ?? []) as TrainingPlanWeekRawRow[],
    (sessionsResult.data ?? []) as TrainingPlanGeneratedSessionRawRow[],
    (prescriptionsResult.data ?? []) as TrainingPlanPlannedPrescriptionRawRow[]
  );
}

/**
 * Convenience wrapper: the most recently generated draft's full review, or
 * `null` if the athlete has none. Never throws for "no draft" — a real,
 * legitimate state (see getTrainingPlanDrafts()).
 */
export async function getLatestDraft(): Promise<TrainingPlanReview | null> {
  const drafts = await getTrainingPlanDrafts();
  if (drafts.length === 0) return null;
  // drafts[0] is already the most recent — getTrainingPlanDrafts() orders by generated_at desc.
  return getTrainingPlanReview(drafts[0]!.id);
}

/**
 * The athlete's currently active plan version id, or `null` if none has
 * ever been accepted — a real, legitimate state (mirrors head-coach-engine's
 * own trainingPlanCurrentVersionRepo.getCurrentPlanVersion, the RLS-scoped
 * equivalent for the web client).
 */
export async function getActivePlanVersionId(): Promise<string | null> {
  const { data, error } = await supabase.from("training_plan_current_version").select("plan_version_id").maybeSingle();

  if (error) {
    console.error("trainingPlanReviewRepo.getActivePlanVersionId failed", error.code);
    throw new TrainingPlanReviewError();
  }

  return (data as { plan_version_id: string } | null)?.plan_version_id ?? null;
}
