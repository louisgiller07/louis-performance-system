/**
 * generationEngine — head-coach-engine's first assembly layer (V0.4_142),
 * connecting planning-engine (session placement/load) and prescription-engine
 * (exercise/drill selection) into one generation pass.
 *
 * Assembles only. Never recomputes loadProfile/doseTarget, never chooses
 * kind/exercise/drill, never reads recentHistory directly — it is forwarded
 * unchanged from the caller's PlanInputSnapshot straight to planning-engine.
 *
 * Identity ownership (V0.4_144, completed here V0.4_145): head-coach-engine
 * mints every id in the hierarchy — planVersionId, generationRequestId,
 * blockId, each week's id, generatedPlanSessionId, plannedPrescriptionId —
 * all via randomUUID(). planning-engine and prescription-engine never
 * generate an id; both stay pure/deterministic.
 *
 * `block` is accepted WITHOUT id/planVersionId — those are minted here,
 * not supplied by the caller, so there is exactly one place that decides
 * them (no risk of a caller-supplied block.planVersionId silently
 * disagreeing with the version id this same call mints).
 *
 * generationRequestId is the one exception: optionally caller-supplied,
 * because the future persistence RPC's idempotency check keys on
 * (athleteId, generationRequestId) and a genuine retry of the same logical
 * request must reuse the same value (V0.4_144 §5) — omit it for a new
 * request and a fresh one is minted.
 *
 * prescription-engine is only called for strength/DH sessions
 * (session.domain === "strength" | "dh_technical"). Aerobic sessions never
 * get a PlannedPrescription — PrescriptionStructure is bounded to exactly
 * those two domains by design (V0.4_119), not an oversight here.
 *
 * Still no Supabase, no RPC, no migration — this is in-memory assembly
 * only. The PersistenceMapper (a later ticket) flattens GenerationContext +
 * AssembledWeek[] into the RPC's payload shape (V0.4_144 §4).
 */
import { randomUUID } from "node:crypto";
import type {
  PlanInputSnapshot,
  TrainingPlanBlock,
  OrchestratedSession,
  SessionKind,
  LoadProfile,
  SessionDoseTarget,
  RelaxedConstraint,
  WeekType,
  WeekDoseSummary,
} from "planning-engine";
import { runPlanningPipeline } from "planning-engine";
import type { PrescriptionRequest, PrescriptionResult } from "prescription-engine";
import { prescriptionEngine } from "prescription-engine";

export interface GenerationEngineInput {
  /** Block content only — id/planVersionId are minted by this function, never supplied. */
  block: Omit<TrainingPlanBlock, "id" | "planVersionId">;
  planInputSnapshot: PlanInputSnapshot;
  /** Idempotency key for the future persistence RPC. Reuse the same value across retries of one logical request; omit to mint a fresh one for a new request (V0.4_144 §5). */
  generationRequestId?: string;
}

/** The identity envelope this call mints — everything the future PersistenceMapper needs to fill TrainingPlanVersion/TrainingPlanBlock's own ids. */
export interface GenerationContext {
  planVersionId: string;
  generationRequestId: string;
  blockId: string;
}

export interface AssembledSession {
  generatedPlanSessionId: string;
  weekId: string;
  date: string;
  kind: SessionKind;
  loadProfile?: LoadProfile;
  durationMin: number;
  doseTarget: SessionDoseTarget;
  rationale: string;
  /** Absent for non-prescribable domains (aerobic) — never a placeholder. */
  prescription?: PrescriptionResult;
}

export interface AssembledWeek {
  id: string;
  blockId: string;
  weekNumber: number;
  startDate: string;
  endDate: string;
  weekType: WeekType;
  rationale: string;
  doseSummary: WeekDoseSummary;
  sessions: AssembledSession[];
  relaxedConstraints: readonly RelaxedConstraint[];
}

export interface GenerationEngineResult {
  context: GenerationContext;
  weeks: AssembledWeek[];
}

/** Only these two domains ever get a PlannedPrescription (V0.4_119). */
const PRESCRIBABLE_DOMAINS: ReadonlySet<string> = new Set(["strength", "dh_technical"]);

function buildPrescriptionRequest(
  session: OrchestratedSession,
  generatedPlanSessionId: string,
  plannedPrescriptionId: string,
  snapshot: PlanInputSnapshot
): PrescriptionRequest {
  return {
    generatedPlanSessionId,
    plannedPrescriptionId,
    kind: session.kind,
    durationMin: session.durationMin,
    doseTarget: session.doseTarget,
    equipment: snapshot.equipment,
    technicalPriorities: snapshot.technicalPriorities,
    terrainAccess: snapshot.terrainAccess,
    strengthExperienceTier: snapshot.strengthExperienceTier,
    ...(session.loadProfile !== undefined ? { loadProfile: session.loadProfile } : {}),
    date: session.date,
  };
}

function assembleSession(session: OrchestratedSession, weekId: string, snapshot: PlanInputSnapshot): AssembledSession {
  const generatedPlanSessionId = randomUUID();

  let prescription: PrescriptionResult | undefined;
  if (PRESCRIBABLE_DOMAINS.has(session.domain)) {
    const plannedPrescriptionId = randomUUID();
    const request = buildPrescriptionRequest(session, generatedPlanSessionId, plannedPrescriptionId, snapshot);
    prescription = prescriptionEngine(request);
  }

  return {
    generatedPlanSessionId,
    weekId,
    date: session.date,
    kind: session.kind,
    ...(session.loadProfile !== undefined ? { loadProfile: session.loadProfile } : {}),
    durationMin: session.durationMin,
    doseTarget: session.doseTarget,
    rationale: session.rationale,
    ...(prescription !== undefined ? { prescription } : {}),
  };
}

export function runGenerationEngine(input: GenerationEngineInput): GenerationEngineResult {
  const planVersionId = randomUUID();
  const blockId = randomUUID();
  const generationRequestId = input.generationRequestId ?? randomUUID();

  const block: TrainingPlanBlock = {
    ...input.block,
    id: blockId,
    planVersionId,
  };

  const planningResult = runPlanningPipeline({
    block,
    races: input.planInputSnapshot.races,
    availability: input.planInputSnapshot.availability,
    terrainAccess: input.planInputSnapshot.terrainAccess,
    lockedDates: input.planInputSnapshot.lockedDates,
    strengthExperienceTier: input.planInputSnapshot.strengthExperienceTier,
    recentHistory: input.planInputSnapshot.recentHistory,
  });

  const weeks: AssembledWeek[] = planningResult.weeks.map((week) => {
    const weekId = randomUUID();
    return {
      id: weekId,
      blockId,
      weekNumber: week.weekNumber,
      startDate: week.startDate,
      endDate: week.endDate,
      weekType: week.weekType,
      rationale: week.rationale,
      doseSummary: week.doseSummary,
      relaxedConstraints: week.relaxedConstraints,
      sessions: week.sessions.map((session) => assembleSession(session, weekId, input.planInputSnapshot)),
    };
  });

  return {
    context: { planVersionId, generationRequestId, blockId },
    weeks,
  };
}
