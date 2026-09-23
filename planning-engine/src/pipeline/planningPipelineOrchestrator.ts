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
import { selectWeekTemplate, type TemplateSelectionReason } from "./templateSelector.js";
import { segmentWeek } from "./weekSegmenter.js";
import type { SessionDomain } from "./weekSegmenter.js";
import { assignSessionKinds } from "./sessionKindAssignment.js";
import { deriveLoad, type LoadDerivationOutput } from "./loadDerivation.js";
import { adjustHistory, type HistoryAdjusterOutput } from "./historyAdjuster.js";
import { resolveConstraints, type ConstraintResolverSessionEntry } from "./constraintResolver.js";
import type { PipelineSessionEnvelope } from "../types/pipelineSessionEnvelope.js";
import type { TrainingPlanBlock } from "../types/planBlock.js";
import type {
  PlanInputRace,
  PlanInputAvailability,
  PlanInputLockedDate,
  StrengthExperienceTier,
  PlanInputRecentHistory,
} from "../types/planInputSnapshot.js";
import type { WeekDoseSummary, WeekType } from "../types/planWeek.js";
import type { RelaxedConstraint } from "../types/planVersion.js";

/** Pure technical version stamp — never a coaching value, same convention as EXERCISE_CATALOG_VERSION/DRILL_CATALOG_VERSION. Bumped manually whenever this pipeline's algorithm changes. */
export const PLANNING_ENGINE_VERSION = "v1";

export interface PlanningPipelineOrchestratorInput {
  block: TrainingPlanBlock;
  races: readonly PlanInputRace[];
  availability: PlanInputAvailability;
  terrainAccess: readonly string[];
  lockedDates: readonly PlanInputLockedDate[];
  strengthExperienceTier: StrengthExperienceTier;
  recentHistory: PlanInputRecentHistory;
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
  selectionReason: TemplateSelectionReason,
  adjustmentReason: string | undefined,
  relaxedConstraint: RelaxedConstraint | undefined
): string {
  const parts = [PHRASE_FOR_SELECTION_REASON[selectionReason]];
  if (adjustmentReason !== undefined) parts.push(adjustmentReason);
  if (relaxedConstraint !== undefined) parts.push(relaxedConstraint.reason);
  return parts.join(" ");
}

function composeWeekRationale(selectionReason: TemplateSelectionReason, relaxedConstraintCount: number): string {
  const parts = [PHRASE_FOR_SELECTION_REASON[selectionReason]];
  if (relaxedConstraintCount > 0) parts.push(`${relaxedConstraintCount} constraint(s) relaxed.`);
  return parts.join(" ");
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

export function runPlanningPipeline(input: PlanningPipelineOrchestratorInput): PlanningPipelineOrchestratorResult {
  const { weeks: weekSequence } = buildWeekSequence({ block: input.block });

  const weeks: OrchestratedWeek[] = weekSequence.map((weekEntry, index) => {
    const nextWeekEntry = weekSequence[index + 1];

    // --- Week-level calls: TemplateSelector, WeekSegmenter, SessionKindAssignment, ConstraintResolver ---
    const { weekType, template, selectionReason } = selectWeekTemplate({
      weekStartDate: weekEntry.startDate,
      weekEndDate: weekEntry.endDate,
      ...(nextWeekEntry !== undefined
        ? { nextWeekStartDate: nextWeekEntry.startDate, nextWeekEndDate: nextWeekEntry.endDate }
        : {}),
      races: input.races,
    });

    const { placedSlots, unplaceable } = segmentWeek({
      weekStartDate: weekEntry.startDate,
      weekEndDate: weekEntry.endDate,
      template,
      availability: input.availability,
      terrainAccess: input.terrainAccess,
      lockedDates: input.lockedDates,
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

      const historyAdjusted: HistoryAdjusterOutput = adjustHistory({
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
      return { ...session, rationale: composeSessionRationale(selectionReason, adjustmentReason, relaxedConstraint) };
    });

    return {
      weekNumber: weekEntry.weekNumber,
      startDate: weekEntry.startDate,
      endDate: weekEntry.endDate,
      weekType,
      rationale: composeWeekRationale(selectionReason, relaxedConstraints.length),
      doseSummary: computeDoseSummary(weekEntry.startDate, weekEntry.endDate, sessionsWithRationale),
      sessions: sessionsWithRationale,
      relaxedConstraints,
    };
  });

  return { weeks };
}
