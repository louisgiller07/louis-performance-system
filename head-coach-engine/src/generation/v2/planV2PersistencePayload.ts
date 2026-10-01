/**
 * UX-11A.5b.5b — V2 persistence mapper (no sport logic).
 *
 * Input: a COMPLETE, already validated in-memory V2 plan
 * (`generatePlanV2InMemory`). Output: the payload of the existing
 * transactional RPC `generate_training_plan_version`, unchanged contract.
 *
 * The mapper only transforms identities, versions, snapshot, weeks /
 * sessions, planned prescriptions and relaxations. It never chooses an
 * exercise, a dose, an activity, an intent or an ordinal, and never mints or
 * changes an id: the persisted blockId / prescriptionItemId are those of the
 * validated, fingerprinted document.
 *
 * Contract choices (ADR UX-11A.5b.5b):
 * - version: inputSnapshotSchemaVersion "v2", prescriptionSchemaVersion "v2",
 *   catalogVersion = Session Model aggregate, plannerVersion = rulesetVersion
 *   = the real planner version (same convention as V1);
 * - planningModel has no DB column: the trio (input snapshot v2,
 *   prescription v2, Session Model catalogue) discriminates a V2 plan;
 * - relaxations (e.g. a session not placed because no window fits its V2
 *   duration) are kept in the version's existing `relaxedConstraints`;
 * - each session keeps its planner `doseTarget` as legacy compatibility
 *   metadata only — the planned prescription is the V2 dose authority;
 * - the sport fingerprint has no DB column: it is not stored (it stays
 *   recomputable from the persisted sessions and structures).
 */
import { LOAD_VARIABLE_SESSION_KINDS, type GenerationTrigger, type RelaxedConstraint } from "planning-engine";
import { validatePrescriptionV2, type PlanInputSnapshotV2, type PlanV2InMemory, type PrescriptionV2 } from "planning-engine/session-model-v2";
import type { BlockPayload, SessionPayload, WeekPayload } from "../../supabase/mapping/generationResultToPersistencePayload.js";

export interface VersionPayloadV2 {
  id: string;
  baseVersionId?: string;
  horizonStartDate: string;
  horizonEndDate: string;
  inputSnapshot: PlanInputSnapshotV2;
  inputSnapshotSchemaVersion: "v2";
  inputSnapshotHash: string;
  plannerVersion: string;
  rulesetVersion: string;
  catalogVersion: string;
  prescriptionSchemaVersion: "v2";
  generationTrigger: GenerationTrigger;
  rationale: string;
  relaxedConstraints: RelaxedConstraint[];
}

export interface PlannedPrescriptionPayloadV2 {
  id: string;
  generatedPlanSessionId: string;
  schemaVersion: "v2";
  catalogVersion: string;
  structure: PrescriptionV2;
}

export interface GenerateTrainingPlanVersionPayloadV2 {
  athleteId: string;
  generationRequestId: string;
  version: VersionPayloadV2;
  blocks: BlockPayload[];
  weeks: WeekPayload[];
  sessions: SessionPayload[];
  plannedPrescriptions: PlannedPrescriptionPayloadV2[];
}

export interface PlanV2PersistenceContext {
  athleteId: string;
  generationRequestId: string;
  /** The snapshot the plan was generated from (persisted as-is). */
  snapshot: PlanInputSnapshotV2;
  inputSnapshotHash: string;
  generationTrigger: GenerationTrigger;
  rationale: string;
  baseVersionId?: string;
}

export class PlanV2InvariantError extends Error {
  constructor(reason: string) {
    super(`V2 plan invariant violated before persistence: ${reason}`);
    this.name = "PlanV2InvariantError";
  }
}

/**
 * Whole-plan invariants, checked before any write: every placed session has
 * exactly one valid v2 prescription of the plan's catalogue, no duplicate
 * session / prescription id, nothing that is not v2.
 */
export function assertPlanV2Invariants(plan: PlanV2InMemory): void {
  if (plan.planningModel !== "v2" || plan.inputSnapshotSchemaVersion !== "v2" || plan.prescriptionSchemaVersion !== "v2") {
    throw new PlanV2InvariantError("not a v2 plan");
  }
  const sessions = plan.weeks.flatMap((w) => w.sessions);
  if (sessions.length === 0) throw new PlanV2InvariantError("the plan has no placed session");
  const sessionIds = new Set<string>();
  const prescriptionIds = new Set<string>();
  for (const s of sessions) {
    if (sessionIds.has(s.generatedPlanSessionId)) throw new PlanV2InvariantError(`duplicate session id ${s.generatedPlanSessionId}`);
    sessionIds.add(s.generatedPlanSessionId);
    const p = s.plannedPrescription;
    if (!p) throw new PlanV2InvariantError(`session ${s.generatedPlanSessionId} has no prescription`);
    if (prescriptionIds.has(p.id)) throw new PlanV2InvariantError(`duplicate prescription id ${p.id}`);
    prescriptionIds.add(p.id);
    if (p.schemaVersion !== "v2" || p.catalogVersion !== plan.catalogVersion) throw new PlanV2InvariantError(`prescription ${p.id} is not v2 / ${plan.catalogVersion}`);
    if (p.structure.sessionKind !== s.kind) throw new PlanV2InvariantError(`prescription ${p.id} is for ${p.structure.sessionKind}, session is ${s.kind}`);
    // Mirrors training_plan_generated_sessions_load_profile_matches_kind.
    if (LOAD_VARIABLE_SESSION_KINDS.has(s.kind) !== (s.loadProfile !== undefined)) throw new PlanV2InvariantError(`session ${s.generatedPlanSessionId} (${s.kind}) has an inconsistent load profile`);
    const validation = validatePrescriptionV2(p.structure);
    if (!validation.ok) throw new PlanV2InvariantError(`prescription ${p.id} is invalid: ${validation.issues.map((i) => `${i.path} ${i.code}`).join(", ")}`);
  }
}

export function planV2ToPersistencePayload(plan: PlanV2InMemory, context: PlanV2PersistenceContext): GenerateTrainingPlanVersionPayloadV2 {
  assertPlanV2Invariants(plan);
  const sessions = plan.weeks.flatMap((w) => w.sessions.map((s) => ({ weekId: w.id, session: s })));

  return {
    athleteId: context.athleteId,
    generationRequestId: context.generationRequestId,
    version: {
      id: plan.planVersionId,
      ...(context.baseVersionId !== undefined ? { baseVersionId: context.baseVersionId } : {}),
      horizonStartDate: plan.horizon.startDate,
      horizonEndDate: plan.horizon.endDate,
      inputSnapshot: context.snapshot,
      inputSnapshotSchemaVersion: "v2",
      inputSnapshotHash: context.inputSnapshotHash,
      plannerVersion: plan.plannerVersion,
      rulesetVersion: plan.plannerVersion,
      catalogVersion: plan.catalogVersion,
      prescriptionSchemaVersion: "v2",
      generationTrigger: context.generationTrigger,
      rationale: context.rationale,
      relaxedConstraints: plan.weeks.flatMap((w) => [...w.relaxedConstraints]),
    },
    blocks: [
      {
        id: plan.blockId,
        sequenceNumber: plan.block.sequenceNumber,
        name: plan.block.name,
        mode: plan.block.mode,
        primaryFocus: plan.block.primaryFocus,
        startDate: plan.block.startDate,
        endDate: plan.block.endDate,
      },
    ],
    weeks: plan.weeks.map((w) => ({
      id: w.id,
      blockId: plan.blockId,
      weekNumber: w.weekNumber,
      startDate: w.startDate,
      endDate: w.endDate,
      weekType: w.weekType,
      doseSummary: w.doseSummary,
      rationale: w.rationale,
    })),
    sessions: sessions.map(({ weekId, session }) => ({
      id: session.generatedPlanSessionId,
      weekId,
      date: session.date,
      kind: session.kind,
      ...(session.loadProfile !== undefined ? { loadProfile: session.loadProfile } : {}),
      durationMin: session.durationMin,
      // Legacy compatibility metadata only (setVolume / targetRpeOrRir / intensityZone are not a V2 authority).
      doseTarget: session.doseTarget,
      rationale: session.rationale,
    })),
    plannedPrescriptions: sessions.map(({ session }) => ({
      id: session.plannedPrescription.id,
      generatedPlanSessionId: session.generatedPlanSessionId,
      schemaVersion: "v2",
      catalogVersion: session.plannedPrescription.catalogVersion,
      structure: session.plannedPrescription.structure,
    })),
  };
}
