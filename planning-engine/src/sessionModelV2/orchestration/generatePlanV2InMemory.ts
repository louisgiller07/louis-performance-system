/**
 * UX-11A.5b.5a — in-memory V2 plan generation (no persistence).
 *
 * PlanInputSnapshotV2 → shared planning pipeline with the V2 dose model
 * (BUG-V2-2: block progression — each week's role and dose, fitted to the
 * availability → final durations → placement) → generated
 * sessions → V2 builders (Force, DH, AEROBIC_BASE) → assignPrescriptionIds
 * (injected mintId) → validatePrescriptionV2 → sport fingerprints.
 *
 * - Explicit only: nothing here is reached unless a caller asks for a V2
 *   plan; V1 generation is untouched.
 * - Everything comes from the snapshot (no live profile read); strengths
 *   and weaknesses never select content.
 * - Every session of the plan gets exactly one valid V2 prescription; an
 *   unsupported kind or an invalid prescription is a contract error.
 * - Locked V2 blocks (missing DH data, unavailable terrain, unsupported
 *   duration, no compatible exercise…) return a "blocked" result: no plan,
 *   no partial plan.
 * - Ids: all minted by the injected `mintId`, in a deterministic order; the
 *   pure Session Model never creates an id itself.
 */
import { runPlanningPipeline, PLANNING_ENGINE_VERSION } from "../../pipeline/planningPipelineOrchestrator.js";
import type { TrainingPlanBlock } from "../../types/planBlock.js";
import type { LoadProfile, SessionKind } from "../../types/sharedVocabulary.js";
import type { SessionDoseTarget } from "../../types/generatedSession.js";
import type { WeekDoseSummary, WeekType } from "../../types/planWeek.js";
import type { RelaxedConstraint } from "../../types/planVersion.js";
import { buildSessionModelV2CatalogManifest, type SessionModelV2CatalogManifest } from "../catalogManifest.js";
import { assignPrescriptionIds } from "../assignPrescriptionIds.js";
import { validatePrescriptionV2 } from "../validatePrescriptionV2.js";
import { sportFingerprint } from "../sportFingerprint.js";
import { toSessionModelV2Input, type PlanInputSnapshotV2 } from "../planInputSnapshotV2.js";
import { SessionModelV2ContractError, SessionModelV2GenerationBlockedError, type SessionModelV2GenerationBlockCode } from "../generationErrors.js";
import type { ExerciseItemV2Content, PrescriptionV2, PrescriptionV2Content } from "../prescriptionV2.js";
import { buildDhPrescriptionV2Content } from "../builders/dhPrescriptionV2.js";
import { deriveDhSessionOrdinals } from "../builders/dhSessionOrdinals.js";
import { buildAerobicBasePrescriptionV2Content } from "../builders/aerobicBasePrescriptionV2.js";
import { buildStrengthPrescriptionV2Content } from "../builders/strengthPrescriptionV2.js";
import { PLAN_DOSE_MODEL_V2 } from "./planDoseModelV2.js";
import { isActivityAvailableOn } from "../../pipeline/availabilityActivity.js";
import type { PlanInputAvailability, PlanInputLockedDate } from "../../types/planInputSnapshot.js";
import type { StrengthDoseStepV2 } from "../../catalog/strengthDoseCatalogV2.js";

export const V2_SUPPORTED_SESSION_KINDS: readonly SessionKind[] = ["STRENGTH_LOWER", "STRENGTH_UPPER", "DH_TECHNICAL", "AEROBIC_BASE"];

export interface GeneratePlanV2InMemoryInput {
  /** Block content only — id / planVersionId are minted here. */
  block: Omit<TrainingPlanBlock, "id" | "planVersionId">;
  snapshot: PlanInputSnapshotV2;
  /** Identity strategy, injected (random UUIDs at runtime, deterministic in tests). */
  mintId: () => string;
}

export interface PlannedPrescriptionV2InMemory {
  id: string;
  schemaVersion: "v2";
  catalogVersion: string;
  structure: PrescriptionV2;
}

export interface PlanSessionV2InMemory {
  generatedPlanSessionId: string;
  date: string;
  kind: SessionKind;
  loadProfile?: LoadProfile;
  durationMin: number;
  /** Planner dose target; V2 builders only read the DH passages from it. */
  doseTarget: SessionDoseTarget;
  rationale: string;
  plannedPrescription: PlannedPrescriptionV2InMemory;
  /** Fingerprint of the session's sport content (date, kind, duration, prescription without ids). */
  sportFingerprint: string;
}

export interface PlanWeekV2InMemory {
  id: string;
  weekNumber: number;
  startDate: string;
  endDate: string;
  weekType: WeekType;
  /** Planner week rationale and dose summary (transported as-is to persistence). */
  rationale: string;
  doseSummary: WeekDoseSummary;
  /** Planner relaxations of this week, e.g. a session not placed because no window fits its V2 duration. */
  relaxedConstraints: readonly RelaxedConstraint[];
  sessions: PlanSessionV2InMemory[];
}

export interface PlanV2InMemory {
  planningModel: "v2";
  inputSnapshotSchemaVersion: "v2";
  prescriptionSchemaVersion: "v2";
  plannerVersion: string;
  /** = catalog.aggregate */
  catalogVersion: string;
  catalog: SessionModelV2CatalogManifest;
  planVersionId: string;
  blockId: string;
  /** Block content the plan was generated for (ids above). */
  block: Omit<TrainingPlanBlock, "id" | "planVersionId">;
  horizon: { startDate: string; endDate: string };
  weeks: PlanWeekV2InMemory[];
  /** Fingerprint of the whole plan's sport content (ids excluded). */
  planSportFingerprint: string;
}

export type GeneratePlanV2InMemoryResult =
  | { status: "generated"; plan: PlanV2InMemory }
  | { status: "blocked"; code: SessionModelV2GenerationBlockCode; detail: Readonly<Record<string, unknown>> };

export function generatePlanV2InMemory(input: GeneratePlanV2InMemoryInput): GeneratePlanV2InMemoryResult {
  const { snapshot, mintId } = input;
  const catalog = buildSessionModelV2CatalogManifest();
  const modelInput = toSessionModelV2Input(snapshot);

  const planVersionId = mintId();
  const blockId = mintId();
  const planning = runPlanningPipeline({
    block: { ...input.block, id: blockId, planVersionId },
    races: snapshot.races,
    availability: snapshot.availability,
    terrainAccess: snapshot.terrainAccess,
    lockedDates: snapshot.lockedDates,
    strengthExperienceTier: snapshot.strengthExperienceTier,
    // Kept only because the pipeline input requires it: with the V2 dose model
    // HistoryAdjuster (its only reader) is never applied.
    recentHistory: snapshot.recentHistory,
    sessionDoseModel: PLAN_DOSE_MODEL_V2,
  });

  const flat = planning.weeks.flatMap((week) => week.sessions.map((session) => ({ week, session })));
  for (const { session } of flat) {
    if (!V2_SUPPORTED_SESSION_KINDS.includes(session.kind)) throw new SessionModelV2ContractError(`no V2 builder for session kind ${session.kind}`);
  }
  const dhOrdinals = deriveDhSessionOrdinals(flat.map(({ session }) => ({ date: session.date, kind: session.kind })));

  // Sport content of every session first (pure); any locked block stops the whole plan before any id.
  let contents: PrescriptionV2Content[];
  try {
    contents = flat.map(({ week, session }) =>
      buildContent(session, modelInput, dhOrdinals, catalog, snapshot.availability, snapshot.lockedDates, week.doseSummary.progression?.targets.forceDoseStep ?? undefined)
    );
  } catch (error) {
    if (error instanceof SessionModelV2GenerationBlockedError) return { status: "blocked", code: error.code, detail: error.detail };
    throw error;
  }
  assertStableStrengthComposition(flat.map(({ session }) => session.kind), contents);

  // Identities and validation.
  const weeks: PlanWeekV2InMemory[] = [];
  let index = 0;
  for (const week of planning.weeks) {
    const weekId = mintId();
    const sessions: PlanSessionV2InMemory[] = week.sessions.map((session) => {
      const content = contents[index++]!;
      const structure = assignPrescriptionIds(content, mintId);
      const validation = validatePrescriptionV2(structure);
      if (!validation.ok) {
        throw new SessionModelV2ContractError(`invalid V2 prescription for ${session.kind} on ${session.date}: ${validation.issues.map((i) => `${i.path} ${i.code}`).join(", ")}`);
      }
      return {
        generatedPlanSessionId: mintId(),
        date: session.date,
        kind: session.kind,
        ...(session.loadProfile !== undefined ? { loadProfile: session.loadProfile } : {}),
        durationMin: session.durationMin,
        doseTarget: session.doseTarget,
        rationale: session.rationale,
        plannedPrescription: { id: mintId(), schemaVersion: "v2", catalogVersion: catalog.aggregate, structure },
        sportFingerprint: sportFingerprint({ date: session.date, kind: session.kind, durationMin: session.durationMin, prescription: content }),
      };
    });
    weeks.push({
      id: weekId,
      weekNumber: week.weekNumber,
      startDate: week.startDate,
      endDate: week.endDate,
      weekType: week.weekType,
      rationale: week.rationale,
      doseSummary: week.doseSummary,
      relaxedConstraints: week.relaxedConstraints,
      sessions,
    });
  }

  const horizon = { startDate: input.block.startDate, endDate: input.block.endDate };
  return {
    status: "generated",
    plan: {
      planningModel: "v2",
      inputSnapshotSchemaVersion: "v2",
      prescriptionSchemaVersion: "v2",
      plannerVersion: PLANNING_ENGINE_VERSION,
      catalogVersion: catalog.aggregate,
      catalog,
      planVersionId,
      blockId,
      block: { ...input.block },
      horizon,
      weeks,
      planSportFingerprint: sportFingerprint({
        plannerVersion: PLANNING_ENGINE_VERSION,
        catalog,
        horizon,
        weeks: weeks.map((w) => ({ weekNumber: w.weekNumber, startDate: w.startDate, endDate: w.endDate, weekType: w.weekType, relaxedConstraints: w.relaxedConstraints, sessions: w.sessions.map((s) => s.sportFingerprint) })),
      }),
    },
  };
}

function buildContent(
  session: { date: string; kind: SessionKind; loadProfile?: LoadProfile; durationMin: number; doseTarget: SessionDoseTarget },
  modelInput: ReturnType<typeof toSessionModelV2Input>,
  dhOrdinals: ReadonlyMap<string, number>,
  catalog: SessionModelV2CatalogManifest,
  availability: PlanInputAvailability,
  lockedDates: readonly PlanInputLockedDate[],
  /** BUG-V2-2 — the week's Force dose step (absent = the load profile's own step). */
  forceDoseStep: StrengthDoseStepV2 | undefined
): PrescriptionV2Content {
  switch (session.kind) {
    case "STRENGTH_LOWER":
    case "STRENGTH_UPPER": {
      if (session.loadProfile !== "LIGHT" && session.loadProfile !== "MODERATE") {
        throw new SessionModelV2ContractError(`strength session on ${session.date} has no V2 load (${session.loadProfile})`);
      }
      return buildStrengthPrescriptionV2Content({
        sessionKind: session.kind,
        athleteTier: modelInput.strengthExperienceTier,
        equipment: modelInput.equipment,
        loadProfile: session.loadProfile,
        ...(forceDoseStep !== undefined ? { doseStep: forceDoseStep } : {}),
        catalog,
      });
    }
    case "DH_TECHNICAL": {
      if (session.doseTarget.domain !== "dh_technical") throw new SessionModelV2ContractError(`DH session on ${session.date} without DH dose target`);
      const ordinal = dhOrdinals.get(session.date);
      if (ordinal === undefined) throw new SessionModelV2ContractError(`DH session on ${session.date} has no ordinal`);
      return buildDhPrescriptionV2Content({
        sessionKind: session.kind,
        dhSessionOrdinal: ordinal,
        dhTechnicalTier: modelInput.dhTechnicalTier,
        priorityAreas: modelInput.priorityAreas,
        terrainAccess: modelInput.terrainAccess,
        focusedRunsCount: session.doseTarget.focusedRunsCount,
        catalog,
        // P0 — a LIGHT DH week never carries a race-intensity drill.
        ...(session.loadProfile !== undefined ? { loadProfile: session.loadProfile } : {}),
      });
    }
    case "AEROBIC_BASE":
      return buildAerobicBasePrescriptionV2Content({
        sessionKind: session.kind,
        durationMin: session.durationMin,
        catalog,
        // BUG-V2-1 — no riding window that day: off-terrain endurance only.
        ridingAvailable: isActivityAvailableOn(session.date, "riding", availability, lockedDates),
      });
    default:
      throw new SessionModelV2ContractError(`no V2 builder for session kind ${session.kind}`);
  }
}

/** Same strength kind → same template and same exercises for the whole plan version (only the dose may differ). */
function assertStableStrengthComposition(kinds: readonly SessionKind[], contents: readonly PrescriptionV2Content[]): void {
  const reference = new Map<SessionKind, string>();
  kinds.forEach((kind, i) => {
    if (kind !== "STRENGTH_LOWER" && kind !== "STRENGTH_UPPER") return;
    const c = contents[i]!;
    const composition = JSON.stringify([c.templateId, c.blocks.flatMap((b) => b.items.map((item) => (item as ExerciseItemV2Content).exerciseId))]);
    const seen = reference.get(kind);
    if (seen === undefined) reference.set(kind, composition);
    else if (seen !== composition) throw new SessionModelV2ContractError(`${kind} composition changed within the plan version`);
  });
}
