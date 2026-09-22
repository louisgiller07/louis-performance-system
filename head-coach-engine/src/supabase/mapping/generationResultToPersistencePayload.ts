/**
 * generationResultToPersistencePayload — pure transformation from in-memory
 * generation output to the exact payload `generate_training_plan_version`
 * expects (V0.4_146). Same style as generatedSessionToPlannedSessionCandidate.ts:
 * a pure mapping function, no I/O, no Supabase client. Does not call the RPC
 * — that belongs to a future typed wrapper (same pattern as
 * abandonTrainingPlanVersionRpc.ts), which takes this function's output and
 * spreads it into the `p_*`-prefixed client.rpc() call.
 *
 * Payload shape confirmed from two independent, real sources — never
 * assumed: (1) supabase/migrations/20260921092000_v0_4_001e_generate_training_
 * plan_version_rpc.sql, read directly; (2) tests/supabase/testDb.ts's own
 * generateTrainingPlan(), an already-working, already-tested real call to
 * this exact RPC. Both agree on every camelCase field name used below.
 * plan_version_id is deliberately absent from every block/week/session/
 * prescription entry here — the RPC injects it itself from the version row
 * it creates, never reads it from the payload (confirmed in the SQL).
 *
 * GenerationEngineResult alone cannot fill a complete version row —
 * athleteId, plannerVersion, rulesetVersion, prescriptionSchemaVersion,
 * generationTrigger, rationale, and the original inputSnapshot (+ its hash/
 * schema version) have no other source anywhere in this pipeline. Rather
 * than invent them, this function requires them explicitly via
 * VersionPersistenceContext — "ne jamais générer" applied to missing
 * context, not just missing coaching values. catalogVersion is the one
 * version-level field NOT requested externally: it is read directly from
 * planning-engine's own EXERCISE_CATALOG_VERSION/DRILL_CATALOG_VERSION
 * constants (always available, regardless of whether any session in this
 * generation got a prescription at all), with a defensive check that the
 * two already-real constants still agree — never a silent pick.
 *
 * No randomUUID, no Date.now, no Supabase import, no exercise/drill
 * selection, no load computation — every value here is either read
 * verbatim from GenerationEngineResult/VersionPersistenceContext or
 * mechanically derived (flatten, block-date passthrough) from them.
 */
import type {
  PlanInputSnapshot,
  GenerationTrigger,
  RelaxedConstraint,
  TrainingMode,
  SessionKind,
  LoadProfile,
  SessionDoseTarget,
  WeekType,
  WeekDoseSummary,
  PrescriptionStructure,
} from "planning-engine";
import { EXERCISE_CATALOG_VERSION, DRILL_CATALOG_VERSION } from "planning-engine";
import type { GenerationEngineInput, GenerationEngineResult } from "../../generation/generationEngine.js";

/** Everything a complete p_version row needs that GenerationEngineResult itself cannot provide — never invented, always required. */
export interface VersionPersistenceContext {
  athleteId: string;
  /** Present only when this version supersedes a prior one. */
  baseVersionId?: string;
  plannerVersion: string;
  rulesetVersion: string;
  prescriptionSchemaVersion: string;
  generationTrigger: GenerationTrigger;
  rationale: string;
  inputSnapshot: PlanInputSnapshot;
  inputSnapshotSchemaVersion: string;
  inputSnapshotHash: string;
}

export interface VersionPayload {
  id: string;
  baseVersionId?: string;
  horizonStartDate: string;
  horizonEndDate: string;
  inputSnapshot: PlanInputSnapshot;
  inputSnapshotSchemaVersion: string;
  inputSnapshotHash: string;
  plannerVersion: string;
  rulesetVersion: string;
  catalogVersion: string;
  prescriptionSchemaVersion: string;
  generationTrigger: GenerationTrigger;
  rationale: string;
  relaxedConstraints: RelaxedConstraint[];
}

export interface BlockPayload {
  id: string;
  sequenceNumber: number;
  name: string;
  mode: TrainingMode;
  primaryFocus: string;
  startDate: string;
  endDate: string;
}

export interface WeekPayload {
  id: string;
  blockId: string;
  weekNumber: number;
  startDate: string;
  endDate: string;
  weekType: WeekType;
  doseSummary: WeekDoseSummary;
  rationale: string;
}

export interface SessionPayload {
  id: string;
  weekId: string;
  date: string;
  kind: SessionKind;
  loadProfile?: LoadProfile;
  durationMin: number;
  doseTarget: SessionDoseTarget;
  rationale: string;
}

export interface PlannedPrescriptionPayload {
  id: string;
  generatedPlanSessionId: string;
  schemaVersion: string;
  catalogVersion: string;
  structure: PrescriptionStructure;
}

/**
 * The full domain-shaped payload for generate_training_plan_version — a
 * future RPC wrapper spreads this into client.rpc()'s p_athlete_id/
 * p_generation_request_id/p_version/p_blocks/p_weeks/p_sessions/
 * p_planned_prescriptions parameters verbatim.
 */
export interface GenerateTrainingPlanVersionPayload {
  athleteId: string;
  generationRequestId: string;
  version: VersionPayload;
  blocks: BlockPayload[];
  weeks: WeekPayload[];
  sessions: SessionPayload[];
  plannedPrescriptions: PlannedPrescriptionPayload[];
}

export function generationResultToPersistencePayload(
  result: GenerationEngineResult,
  block: GenerationEngineInput["block"],
  context: VersionPersistenceContext
): GenerateTrainingPlanVersionPayload {
  if (EXERCISE_CATALOG_VERSION !== DRILL_CATALOG_VERSION) {
    throw new Error(
      `generationResultToPersistencePayload: EXERCISE_CATALOG_VERSION ("${EXERCISE_CATALOG_VERSION}") and DRILL_CATALOG_VERSION ("${DRILL_CATALOG_VERSION}") must agree — they are documented as a single combined, released-together version`
    );
  }

  const allSessions = result.weeks.flatMap((week) => week.sessions);

  return {
    athleteId: context.athleteId,
    generationRequestId: result.context.generationRequestId,
    version: {
      id: result.context.planVersionId,
      ...(context.baseVersionId !== undefined ? { baseVersionId: context.baseVersionId } : {}),
      horizonStartDate: block.startDate,
      horizonEndDate: block.endDate,
      inputSnapshot: context.inputSnapshot,
      inputSnapshotSchemaVersion: context.inputSnapshotSchemaVersion,
      inputSnapshotHash: context.inputSnapshotHash,
      plannerVersion: context.plannerVersion,
      rulesetVersion: context.rulesetVersion,
      catalogVersion: EXERCISE_CATALOG_VERSION,
      prescriptionSchemaVersion: context.prescriptionSchemaVersion,
      generationTrigger: context.generationTrigger,
      rationale: context.rationale,
      relaxedConstraints: result.weeks.flatMap((week) => week.relaxedConstraints),
    },
    blocks: [
      {
        id: result.context.blockId,
        sequenceNumber: block.sequenceNumber,
        name: block.name,
        mode: block.mode,
        primaryFocus: block.primaryFocus,
        startDate: block.startDate,
        endDate: block.endDate,
      },
    ],
    weeks: result.weeks.map((week) => ({
      id: week.id,
      blockId: week.blockId,
      weekNumber: week.weekNumber,
      startDate: week.startDate,
      endDate: week.endDate,
      weekType: week.weekType,
      doseSummary: week.doseSummary,
      rationale: week.rationale,
    })),
    sessions: allSessions.map((session) => ({
      id: session.generatedPlanSessionId,
      weekId: session.weekId,
      date: session.date,
      kind: session.kind,
      ...(session.loadProfile !== undefined ? { loadProfile: session.loadProfile } : {}),
      durationMin: session.durationMin,
      doseTarget: session.doseTarget,
      rationale: session.rationale,
    })),
    plannedPrescriptions: allSessions
      .filter((session) => session.prescription !== undefined)
      .map((session) => ({
        id: session.prescription!.prescription.id,
        generatedPlanSessionId: session.prescription!.prescription.generatedPlanSessionId,
        schemaVersion: session.prescription!.prescription.schemaVersion,
        catalogVersion: session.prescription!.prescription.catalogVersion,
        structure: session.prescription!.prescription.structure,
      })),
  };
}
