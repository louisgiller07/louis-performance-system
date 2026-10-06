/**
 * PlanningPipelineOrchestrator (V0.4_115) — composes the 7 already-built
 * pure pipeline modules (WeekSequenceBuilder -> TemplateSelector ->
 * WeekSegmenter -> SessionKindAssignment -> LoadDerivation ->
 * HistoryAdjuster -> ConstraintResolver) for one TrainingPlanBlock. Stops
 * before PrescriptionEngine (V0.4_114 §1 — a separate package, called by a
 * future outer/head-coach-engine orchestrator, never from here).
 *
 * Pure composition only: no module's own contract is touched, no business
 * rule is duplicated, no error is ever caught or transformed. This file
 * itself performs zero I/O, consistent with planning-engine's own
 * architecture lock (tests/unit/boundaries.test.ts).
 */
import { buildWeekSequence } from "./weekSequenceBuilder.js";
import { selectWeekTemplate, type TemplateSelectionReason, type TemplateSelectionResult } from "./templateSelector.js";
import { segmentWeek } from "./weekSegmenter.js";
import type { SessionDomain } from "./weekSegmenter.js";
import { assignSessionKinds } from "./sessionKindAssignment.js";
import { deriveLoad, referenceDurationMinFor, type LoadDerivationOutput } from "./loadDerivation.js";
import { adjustHistory, type HistoryAdjusterOutput } from "./historyAdjuster.js";
import { resolveConstraints, type ConstraintResolverSessionEntry } from "./constraintResolver.js";
import { SessionDoseModelContractError, type SessionDoseModel, type WeekShape } from "./sessionDoseModel.js";
import type { PipelineSessionEnvelope } from "../types/pipelineSessionEnvelope.js";
import type { TrainingPlanBlock } from "../types/planBlock.js";
import type {
  PlanInputRace,
  PlanInputAvailability,
  PlanInputLockedDate,
  StrengthExperienceTier,
  PlanInputRecentHistory,
} from "../types/planInputSnapshot.js";
import type { WeekDoseSummary, WeekProgressionSummary, WeekType } from "../types/planWeek.js";
import type { RelaxedConstraint } from "../types/planVersion.js";

/**
 * Pure technical version stamp — never a coaching value, same convention as EXERCISE_CATALOG_VERSION/DRILL_CATALOG_VERSION. Bumped manually whenever this pipeline's algorithm changes.
 * v2 (V06-03): WeekSegmenter only places a slot on a date whose availability window can hold the session's duration.
 */
export const PLANNING_ENGINE_VERSION = "v2";

export interface PlanningPipelineOrchestratorInput {
  block: TrainingPlanBlock;
  races: readonly PlanInputRace[];
  availability: PlanInputAvailability;
  terrainAccess: readonly string[];
  lockedDates: readonly PlanInputLockedDate[];
  strengthExperienceTier: StrengthExperienceTier;
  recentHistory: PlanInputRecentHistory;
  /**
   * UX-11A.5b.5a — absent (default): V1 pipeline, byte-for-byte unchanged.
   * Present (explicit V2 plan): placement durations and session loads come
   * from this model, known before placement; HistoryAdjuster is not applied.
   */
  sessionDoseModel?: SessionDoseModel;
}

export type OrchestratedSession = ConstraintResolverSessionEntry & { rationale: string };

export interface OrchestratedWeek {
  weekNumber: number;
  startDate: string;
  endDate: string;
  weekType: WeekType;
  rationale: string;
  doseSummary: WeekDoseSummary;
  sessions: OrchestratedSession[];
  relaxedConstraints: readonly RelaxedConstraint[];
}

export interface PlanningPipelineOrchestratorResult {
  weeks: OrchestratedWeek[];
}

/**
 * Closed mapping, V0.4_114A decision — never free-text generation. The
 * exact wording is an implementation detail, not an architecture question.
 */
const PHRASE_FOR_SELECTION_REASON: Record<TemplateSelectionReason, string> = {
  race_in_week: "Race week: minimal structured volume, no new strength stimulus.",
  race_in_next_week: "Taper week ahead of an upcoming race: reduced volume versus a normal development week.",
  candidate_hint: "Week type set by an explicit upstream recovery/deload indication.",
  default_development: "Standard development week.",
};

function composeSessionRationale(
  selectionPhrase: string,
  adjustmentReason: string | undefined,
  relaxedConstraint: RelaxedConstraint | undefined
): string {
  const parts = [selectionPhrase];
  if (adjustmentReason !== undefined) parts.push(adjustmentReason);
  if (relaxedConstraint !== undefined) parts.push(relaxedConstraint.reason);
  return parts.join(" ");
}

function composeWeekRationale(selectionPhrase: string, relaxedConstraintCount: number): string {
  const parts = [selectionPhrase];
  if (relaxedConstraintCount > 0) parts.push(`${relaxedConstraintCount} constraint(s) relaxed.`);
  return parts.join(" ");
}

function selectedWeek(selection: TemplateSelectionResult): { weekType: WeekType; template: TemplateSelectionResult["template"]; selectionPhrase: string } {
  return { weekType: selection.weekType, template: selection.template, selectionPhrase: PHRASE_FOR_SELECTION_REASON[selection.selectionReason] };
}

/** BUG-V2-2 — the shape's progression plus what was really placed (physical = strength + endurance, riding = DH). */
function progressionSummary(shape: WeekShape, sessions: readonly OrchestratedSession[]): WeekProgressionSummary {
  const minutes = (domains: readonly SessionDomain[]) => sessions.filter((s) => domains.includes(s.domain)).reduce((sum, s) => sum + s.durationMin, 0);
  return { ...shape.progression, sessionCount: sessions.length, physicalMinutes: minutes(["strength", "aerobic"]), ridingMinutes: minutes(["dh_technical"]) };
}

/** Manual UTC parsing, never `new Date(isoString)` — same discipline as every other date helper already in this package. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

function computeDoseSummary(weekStartDate: string, weekEndDate: string, sessions: readonly OrchestratedSession[]): WeekDoseSummary {
  const dayCount = daysBetween(weekStartDate, weekEndDate) + 1;
  const countFor = (domain: SessionDomain) => sessions.filter((s) => s.domain === domain).length;

  return {
    plannedStrengthSessionCount: countFor("strength"),
    plannedDhTechnicalSessionCount: countFor("dh_technical"),
    plannedAerobicSessionCount: countFor("aerobic"),
    plannedRestOrRecoveryDayCount: dayCount - sessions.length,
    totalPlannedMinutes: sessions.reduce((sum, s) => sum + s.durationMin, 0),
  };
}

function placementDurationsFromModel(
  model: SessionDoseModel,
  weekType: WeekType,
  template: { strengthSlotCount: number; dhTechnicalSlotCount: number; aerobicSlotCount: number },
  shape: WeekShape | undefined
): Readonly<Record<SessionDomain, number>> {
  const durations = shape !== undefined ? shape.placementDurationMinByDomain : model.placementDurationMinByDomain(weekType);
  if (durations !== null) return durations;
  if (template.strengthSlotCount + template.dhTechnicalSlotCount + template.aerobicSlotCount > 0) {
    throw new SessionDoseModelContractError(`${model.modelId} gives no duration for week type "${weekType}", whose template places sessions`);
  }
  // No slot in this week: no duration is ever read.
  return { strength: 0, dh_technical: 0, aerobic: 0 };
}

/**
 * The model's final load for a placed session (HistoryAdjuster is not applied).
 * Its duration must be the one the session was placed with.
 */
function resolveWithModel(
  model: SessionDoseModel,
  identity: { date: string; domain: SessionDomain; kind: PipelineSessionEnvelope<unknown>["kind"] },
  weekType: WeekType,
  baseline: LoadDerivationOutput,
  placementDurations: Readonly<Record<SessionDomain, number>>,
  shape: WeekShape | undefined
): HistoryAdjusterOutput {
  const resolved = model.resolveSessionLoad({ kind: identity.kind, domain: identity.domain, weekType, baseline, ...(shape !== undefined ? { shape } : {}) });
  if (resolved.durationMin !== placementDurations[identity.domain]) {
    throw new SessionDoseModelContractError(
      `${model.modelId}: ${identity.kind} on ${identity.date} resolves to ${resolved.durationMin} min but was placed with ${placementDurations[identity.domain]} min`
    );
  }
  return { ...resolved, adjusted: false };
}

export function runPlanningPipeline(input: PlanningPipelineOrchestratorInput): PlanningPipelineOrchestratorResult {
  const { weeks: weekSequence } = buildWeekSequence({ block: input.block });

  // BUG-V2-2 — a dose model that shapes the block decides every week's role,
  // type, template and durations up front (it sees the whole block: races
  // ahead, cycle position); otherwise each week is selected alone, as before.
  const shapes = input.sessionDoseModel?.shapeWeeks?.({
    weeks: weekSequence.map((w) => ({ weekNumber: w.weekNumber, startDate: w.startDate, endDate: w.endDate })),
    races: input.races,
    availability: input.availability,
    terrainAccess: input.terrainAccess,
    lockedDates: input.lockedDates,
    strengthExperienceTier: input.strengthExperienceTier,
    recentHistory: input.recentHistory,
  });
  if (shapes !== undefined && shapes.length !== weekSequence.length) {
    throw new SessionDoseModelContractError(`${input.sessionDoseModel?.modelId}: ${shapes.length} week shape(s) for ${weekSequence.length} week(s)`);
  }

  const weeks: OrchestratedWeek[] = weekSequence.map((weekEntry, index) => {
    const nextWeekEntry = weekSequence[index + 1];
    const shape = shapes?.[index];

    // --- Week-level calls: TemplateSelector, WeekSegmenter, SessionKindAssignment, ConstraintResolver ---
    const { weekType, template, selectionPhrase } =
      shape !== undefined
        ? { weekType: shape.weekType, template: shape.template, selectionPhrase: shape.rationale }
        : selectedWeek(
            selectWeekTemplate({
              weekStartDate: weekEntry.startDate,
              weekEndDate: weekEntry.endDate,
              ...(nextWeekEntry !== undefined
                ? { nextWeekStartDate: nextWeekEntry.startDate, nextWeekEndDate: nextWeekEntry.endDate }
                : {}),
              races: input.races,
            })
          );

    // UX-11A.5b.5a — with a dose model (V2), placement uses the model's FINAL
    // durations; without one (V1), the legacy reference durations, unchanged.
    const sessionDurationMinByDomain = input.sessionDoseModel
      ? placementDurationsFromModel(input.sessionDoseModel, weekType, template, shape)
      : {
          // V06-03 — the same reference figures deriveLoad() assigns below
          // (HistoryAdjuster can only lower them), so a placed slot always fits.
          strength: referenceDurationMinFor("strength", weekType),
          dh_technical: referenceDurationMinFor("dh_technical", weekType),
          aerobic: referenceDurationMinFor("aerobic", weekType),
        };

    const { placedSlots, unplaceable } = segmentWeek({
      weekStartDate: weekEntry.startDate,
      weekEndDate: weekEntry.endDate,
      template,
      availability: input.availability,
      terrainAccess: input.terrainAccess,
      lockedDates: input.lockedDates,
      sessionDurationMinByDomain,
    });

    const { assignments } = assignSessionKinds({ placedSlots });

    // --- Session-level calls: LoadDerivation then HistoryAdjuster, threaded via PipelineSessionEnvelope ---
    const historyAdjustedEnvelopes: PipelineSessionEnvelope<HistoryAdjusterOutput>[] = assignments.map((assignment) => {
      const identity = { date: assignment.date, domain: assignment.domain, kind: assignment.kind };

      const loadBaseline: LoadDerivationOutput = deriveLoad({
        kind: identity.kind,
        template,
        strengthExperienceTier: input.strengthExperienceTier,
        weekType,
      });
      const afterLoadDerivation: PipelineSessionEnvelope<LoadDerivationOutput> = { ...identity, payload: loadBaseline };

      const historyAdjusted: HistoryAdjusterOutput = input.sessionDoseModel
        ? resolveWithModel(input.sessionDoseModel, identity, weekType, afterLoadDerivation.payload, sessionDurationMinByDomain, shape)
        : adjustHistory({
            baseline: afterLoadDerivation.payload,
            kind: identity.kind,
            recentHistory: input.recentHistory,
          });

      return { ...identity, payload: historyAdjusted };
    });

    // --- Envelope destroyed here: flatten to ConstraintResolverSessionEntry, keep adjustmentReason aside for rationale ---
    const constraintResolverSessions: ConstraintResolverSessionEntry[] = historyAdjustedEnvelopes.map((envelope) => ({
      date: envelope.date,
      domain: envelope.domain,
      kind: envelope.kind,
      ...(envelope.payload.loadProfile !== undefined ? { loadProfile: envelope.payload.loadProfile } : {}),
      durationMin: envelope.payload.durationMin,
      doseTarget: envelope.payload.doseTarget,
    }));

    // --- Week-level call: ConstraintResolver ---
    const { sessions: finalSessions, relaxedConstraints } = resolveConstraints({
      weekStartDate: weekEntry.startDate,
      weekEndDate: weekEntry.endDate,
      sessions: constraintResolverSessions,
      unplaceable,
    });

    const sessionsWithRationale: OrchestratedSession[] = finalSessions.map((session) => {
      const adjustmentReason = historyAdjustedEnvelopes.find((e) => e.date === session.date)?.payload.adjustmentReason;
      const relaxedConstraint = relaxedConstraints.find((rc) => rc.date === session.date);
      return { ...session, rationale: composeSessionRationale(selectionPhrase, adjustmentReason, relaxedConstraint) };
    });

    const doseSummary = computeDoseSummary(weekEntry.startDate, weekEntry.endDate, sessionsWithRationale);
    return {
      weekNumber: weekEntry.weekNumber,
      startDate: weekEntry.startDate,
      endDate: weekEntry.endDate,
      weekType,
      rationale: composeWeekRationale(selectionPhrase, relaxedConstraints.length),
      doseSummary: shape !== undefined ? { ...doseSummary, progression: progressionSummary(shape, sessionsWithRationale) } : doseSummary,
      sessions: sessionsWithRationale,
      relaxedConstraints,
    };
  });

  return { weeks };
}
