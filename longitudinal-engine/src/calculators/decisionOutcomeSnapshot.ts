/**
 * M5_004 — pure, deterministic post-decision outcome calculator. No
 * Supabase, no network, no filesystem, no process env, no Date.now(), no
 * randomness, no mutable global state, no coaching/detector logic — see
 * docs/11_DECISION_LOG.md (M5_004) for the full design record this file
 * implements. `calculators/**` never imports Supabase; the only place that
 * touches it is supabase/outcomeOrchestrator.ts (a separate module).
 */
import type { AthleteDay, AthleteTimeline, CompletedSessionOnDay, DecisionThread } from "../timeline/types.js";
import { isFlagActiveOnDay } from "../timeline/healthContext.js";
import { sortedBy } from "../timeline/ordering.js";
import type { DailyCheckinSource, DecisionOutcomeHorizon, HealthFlagSource } from "../types/sources.js";
import {
  DecisionNotFoundInTimelineError,
  DuplicateDecisionThreadError,
  HorizonNotMatureError,
  InconsistentBaselineCheckinError,
  InconsistentExecutionDateError,
  InconsistentExecutionLinkError,
  InconsistentTargetCheckinError,
  InconsistentTimelineDayError,
  InvalidHorizonError,
  OutcomeTimelineCoverageError,
} from "./errors.js";
import { isHorizonMature, targetDateForHorizon, validateObservedThroughDate } from "./horizonDates.js";
import { OUTCOME_SCHEMA_VERSION } from "./constants.js";
import type {
  CheckinSnapshot,
  DecisionOutcomeCalculation,
  DeltaSignals,
  DeltaUnavailableReason,
  DeltaValue,
  ExecutionSignal,
  HealthContextSignals,
  HealthFlagRef,
  InputSnapshot,
  OutcomeSignals,
  ResponseSignals,
  SameDaySessionSnapshot,
  SignalValue,
} from "./types.js";

const KNOWN_HORIZONS: readonly DecisionOutcomeHorizon[] = ["J_PLUS_1", "J_PLUS_3", "J_PLUS_7"];

export interface CalculateDecisionOutcomeSnapshotInput {
  readonly timeline: AthleteTimeline;
  readonly decisionId: string;
  readonly horizon: DecisionOutcomeHorizon;
  /** Latest calendar date ("YYYY-MM-DD") the caller declares fully closed/observable. Never derived from the clock inside this package. */
  readonly observedThroughDate: string;
}

/**
 * Resolves the canonical DecisionThread for `decisionId` by value equality
 * (`thread.decision.id === decisionId`) only — never `.includes()` or any
 * JavaScript reference-identity check (M5_002B explicitly forbids
 * reference-identity invariants).
 */
function resolveDecisionThread(timeline: AthleteTimeline, decisionId: string): DecisionThread {
  const matches = timeline.decisionThreads.filter((t) => t.decision.id === decisionId);
  if (matches.length === 0) throw new DecisionNotFoundInTimelineError(decisionId);
  if (matches.length > 1) throw new DuplicateDecisionThreadError(decisionId, matches.length);
  return matches[0]!;
}

/** M5_002B materializes exactly one AthleteDay per date in range — once `date` is proven inside range, anything other than exactly one match is a malformed timeline, never silently treated as "zero check-ins". */
function resolveUniqueDay(timeline: AthleteTimeline, date: string): AthleteDay {
  const matches = timeline.days.filter((d) => d.date === date);
  if (matches.length !== 1) throw new InconsistentTimelineDayError(date, matches.length);
  return matches[0]!;
}

function numericSignal(checkin: DailyCheckinSource | null, field: (c: DailyCheckinSource) => number | null): SignalValue<number> {
  if (checkin === null) return { state: "missing_observation" };
  const value = field(checkin);
  return value === null ? { state: "observed_null" } : { state: "observed", value };
}

/** For the NOT NULL boolean check-in columns (pain, feverOrIllness, suspectedConcussion) — never observed_null, since the DB column itself cannot be null once a row exists. */
function booleanSignal(checkin: DailyCheckinSource | null, field: (c: DailyCheckinSource) => boolean): SignalValue<boolean> {
  if (checkin === null) return { state: "missing_observation" };
  return { state: "observed", value: field(checkin) };
}

function computeDelta(
  baseline: DailyCheckinSource | null,
  target: DailyCheckinSource | null,
  field: (c: DailyCheckinSource) => number | null
): DeltaValue {
  const reason = ((): DeltaUnavailableReason | null => {
    if (baseline === null) return "baseline_missing";
    if (field(baseline) === null) return "baseline_field_null";
    if (target === null) return "target_missing";
    if (field(target) === null) return "target_field_null";
    return null;
  })();
  if (reason !== null) return { state: "unavailable", reason };
  // Both sides proven non-null numeric above.
  return { state: "computed", value: field(target as DailyCheckinSource)! - field(baseline as DailyCheckinSource)! };
}

function checkinSnapshot(c: DailyCheckinSource): CheckinSnapshot {
  return {
    id: c.id,
    checkinDate: c.checkinDate,
    energy: c.energy,
    legFatigue: c.legFatigue,
    gripFatigue: c.gripFatigue,
    motivation: c.motivation,
    workStress: c.workStress,
    pain: c.pain,
    painIntensity: c.painIntensity,
    feverOrIllness: c.feverOrIllness,
    suspectedConcussion: c.suspectedConcussion,
    sleepHours: c.sleepHours,
    sleepQuality: c.sleepQuality,
    sleepWakeUps: c.sleepWakeUps,
  };
}

function sameDaySessionSnapshot(entry: CompletedSessionOnDay): SameDaySessionSnapshot {
  const s = entry.completedSession;
  return {
    id: s.id,
    sessionDate: s.sessionDate,
    sessionType: s.sessionType,
    completionStatus: s.completionStatus,
    actualDurationMin: s.actualDurationMin,
    rpe: s.rpe,
    sessionLoad: s.sessionLoad,
    postLegFatigue: s.postLegFatigue,
    postGripFatigue: s.postGripFatigue,
    newPain: s.newPain,
    newPainNote: s.newPainNote,
    linkedDecisionId: s.decisionId,
  };
}

function healthFlagRef(f: HealthFlagSource): HealthFlagRef {
  return { id: f.id, flagDate: f.flagDate, flagType: f.flagType, status: f.status, resolvedAt: f.resolvedAt };
}

interface ExecutionResolution {
  readonly signal: ExecutionSignal;
  readonly sameDaySession: SameDaySessionSnapshot | null;
}

/**
 * Execution is anchored on decisionDate, never targetDate (see
 * docs/11_DECISION_LOG.md, M5_004) — the same result is therefore reported
 * identically across J+1/J+3/J+7 for a given decision, which is expected,
 * not a redundancy to fix.
 *
 * Two independent canonical views of the same underlying relationship are
 * cross-checked, never trusted alone (M5_004 final lock, point 13):
 *   - `sameDay` — AthleteDay(decisionDate).completedSessions (date-driven).
 *   - `reverseLinked` — DecisionThread.linkedCompletedSessions (decision_id-driven).
 * Any disagreement between them is a structural inconsistency, never
 * repaired by picking one view over the other.
 */
function resolveExecution(timeline: AthleteTimeline, thread: DecisionThread): ExecutionResolution {
  const decisionId = thread.decision.id;
  const decisionDate = thread.decisionDate;

  const decisionDay = resolveUniqueDay(timeline, decisionDate);
  if (decisionDay.completedSessions.length > 1) {
    throw new InconsistentExecutionLinkError(
      `AthleteDay(${decisionDate}) has ${decisionDay.completedSessions.length} completed sessions — violates the DB's UNIQUE(athlete_id, session_date) invariant`
    );
  }
  const sameDay: CompletedSessionOnDay | null = decisionDay.completedSessions[0] ?? null;

  const reverseLinked = thread.linkedCompletedSessions;
  if (reverseLinked.length > 1) {
    throw new InconsistentExecutionLinkError(
      `decision "${decisionId}" has ${reverseLinked.length} completed sessions explicitly linked via decision_id — expected at most one`
    );
  }
  if (reverseLinked.length === 1) {
    const linkedSession = reverseLinked[0]!;
    if (linkedSession.sessionDate !== decisionDate) {
      throw new InconsistentExecutionDateError(decisionId, decisionDate, linkedSession.id, linkedSession.sessionDate);
    }
  }

  // Bidirectional agreement — three exhaustive cases, matching the sameDay.decisionId classification below one-to-one.
  if (sameDay === null) {
    if (reverseLinked.length !== 0) {
      throw new InconsistentExecutionLinkError(
        `decision "${decisionId}" has a completed session explicitly linked via decision_id, but AthleteDay(${decisionDate}) has no completed session at all`
      );
    }
  } else if (sameDay.completedSession.decisionId === decisionId) {
    if (reverseLinked.length !== 1 || reverseLinked[0]!.id !== sameDay.completedSession.id) {
      throw new InconsistentExecutionLinkError(
        `AthleteDay(${decisionDate})'s completed session "${sameDay.completedSession.id}" claims decision_id "${decisionId}", but the reverse decision_id lookup does not agree`
      );
    }
  } else {
    // sameDay.decisionId is either null (unlinked) or a different decision's id (linked elsewhere).
    if (reverseLinked.length !== 0) {
      throw new InconsistentExecutionLinkError(
        `decision "${decisionId}" has a completed session explicitly linked via decision_id, but AthleteDay(${decisionDate})'s same-day session is not linked to this decision`
      );
    }
  }

  const snapshot = sameDay === null ? null : sameDaySessionSnapshot(sameDay);

  let signal: ExecutionSignal;
  if (snapshot === null) {
    signal = { state: "no_completed_session" };
  } else if (snapshot.linkedDecisionId === null) {
    signal = { state: "same_day_session_unlinked" };
  } else if (snapshot.linkedDecisionId === decisionId) {
    signal = {
      state: "explicit",
      completedSessionId: snapshot.id,
      sessionType: snapshot.sessionType,
      completionStatus: snapshot.completionStatus,
      actualDurationMin: snapshot.actualDurationMin,
      rpe: snapshot.rpe,
      sessionLoad: snapshot.sessionLoad,
      postLegFatigue: snapshot.postLegFatigue,
      postGripFatigue: snapshot.postGripFatigue,
      newPain: snapshot.newPain,
    };
  } else {
    signal = { state: "same_day_session_linked_elsewhere" };
  }

  return { signal, sameDaySession: snapshot };
}

function buildResponseSignals(checkin: DailyCheckinSource | null): ResponseSignals {
  return {
    energy: numericSignal(checkin, (c) => c.energy),
    legFatigue: numericSignal(checkin, (c) => c.legFatigue),
    gripFatigue: numericSignal(checkin, (c) => c.gripFatigue),
    motivation: numericSignal(checkin, (c) => c.motivation),
    workStress: numericSignal(checkin, (c) => c.workStress),
    pain: booleanSignal(checkin, (c) => c.pain),
    painIntensity: numericSignal(checkin, (c) => c.painIntensity),
    illness: booleanSignal(checkin, (c) => c.feverOrIllness),
    suspectedConcussion: booleanSignal(checkin, (c) => c.suspectedConcussion),
    sleepHours: numericSignal(checkin, (c) => c.sleepHours),
    sleepQuality: numericSignal(checkin, (c) => c.sleepQuality),
    sleepWakeUps: numericSignal(checkin, (c) => c.sleepWakeUps),
  };
}

function buildDeltaSignals(baseline: DailyCheckinSource | null, target: DailyCheckinSource | null): DeltaSignals {
  return {
    energyDelta: computeDelta(baseline, target, (c) => c.energy),
    legFatigueDelta: computeDelta(baseline, target, (c) => c.legFatigue),
    gripFatigueDelta: computeDelta(baseline, target, (c) => c.gripFatigue),
    painIntensityDelta: computeDelta(baseline, target, (c) => c.painIntensity),
  };
}

/**
 * Historical activity is always date-derived (isFlagActiveOnDay), never
 * `flag.status` (current/live status) — see M5_004 final lock, point 8.
 * `unresolvedAtTarget` is intentionally a subset of `activeOnTargetDate`
 * (pre-existing/carry-over context that remained unresolved through the
 * horizon), not a disjoint category.
 */
function buildHealthContext(
  healthFlags: readonly HealthFlagSource[],
  decisionDate: string,
  targetDate: string
): { readonly signals: HealthContextSignals; readonly flagsInWindow: readonly HealthFlagRef[] } {
  const active = healthFlags.filter((f) => isFlagActiveOnDay(f, targetDate));
  const newSince = healthFlags.filter((f) => f.flagDate > decisionDate && f.flagDate <= targetDate);
  const unresolved = healthFlags.filter((f) => isFlagActiveOnDay(f, decisionDate) && isFlagActiveOnDay(f, targetDate));

  const activeRefs = sortedBy(active, (f) => f.id).map(healthFlagRef);
  const newSinceRefs = sortedBy(newSince, (f) => f.id).map(healthFlagRef);
  const unresolvedRefs = sortedBy(unresolved, (f) => f.id).map(healthFlagRef);

  const byId = new Map<string, HealthFlagRef>();
  for (const ref of [...activeRefs, ...newSinceRefs, ...unresolvedRefs]) byId.set(ref.id, ref);
  const flagsInWindow = sortedBy([...byId.values()], (f) => f.id);

  return {
    signals: { activeOnTargetDate: activeRefs, newSinceDecision: newSinceRefs, unresolvedAtTarget: unresolvedRefs },
    flagsInWindow,
  };
}

export function calculateDecisionOutcomeSnapshot(input: CalculateDecisionOutcomeSnapshotInput): DecisionOutcomeCalculation {
  const { timeline, decisionId, horizon, observedThroughDate } = input;

  // --- Public runtime input validation, before any timeline lookup. ---
  if (!KNOWN_HORIZONS.includes(horizon)) throw new InvalidHorizonError(String(horizon));
  validateObservedThroughDate(observedThroughDate);

  // --- Canonical decision resolution — by value, never reference identity. ---
  const thread = resolveDecisionThread(timeline, decisionId);
  const decisionDate = thread.decisionDate;

  const targetDate = targetDateForHorizon(decisionDate, horizon);

  if (!isHorizonMature(targetDate, observedThroughDate)) {
    throw new HorizonNotMatureError(decisionId, horizon, targetDate, observedThroughDate);
  }
  if (targetDate < timeline.range.fromDate || targetDate > timeline.range.toDate) {
    throw new OutcomeTimelineCoverageError(targetDate, timeline.range.fromDate, timeline.range.toDate);
  }

  const targetDay = resolveUniqueDay(timeline, targetDate);
  let targetCheckinSource: DailyCheckinSource | null;
  if (targetDay.checkins.length === 0) targetCheckinSource = null;
  else if (targetDay.checkins.length === 1) targetCheckinSource = targetDay.checkins[0]!;
  else throw new InconsistentTargetCheckinError(targetDate, targetDay.checkins.length);

  // --- Baseline — exactly DecisionThread.linkedSourceCheckin, never a nearest/fallback search. ---
  const baselineLink = thread.linkedSourceCheckin;
  let baselineCheckinSource: DailyCheckinSource | null;
  if (baselineLink.kind === "absent") {
    baselineCheckinSource = null;
  } else {
    if (baselineLink.ref.checkinDate !== decisionDate) {
      throw new InconsistentBaselineCheckinError(decisionId, decisionDate, baselineLink.ref.id, baselineLink.ref.checkinDate);
    }
    baselineCheckinSource = baselineLink.ref;
  }

  const execution = resolveExecution(timeline, thread);

  const healthFlags = timeline.healthFlagThreads.map((t) => t.flag);
  const health = buildHealthContext(healthFlags, decisionDate, targetDate);

  const outcomeSignals: OutcomeSignals = {
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    horizon,
    targetDate,
    execution: execution.signal,
    response: buildResponseSignals(targetCheckinSource),
    delta: buildDeltaSignals(baselineCheckinSource, targetCheckinSource),
    healthContext: health.signals,
  };

  const inputSnapshot: InputSnapshot = {
    decisionId,
    decisionDate,
    horizon,
    targetDate,
    sourceCheckin: baselineCheckinSource === null ? null : checkinSnapshot(baselineCheckinSource),
    targetCheckin: targetCheckinSource === null ? null : checkinSnapshot(targetCheckinSource),
    sameDaySession: execution.sameDaySession,
    healthFlagsInWindow: health.flagsInWindow,
  };

  return { inputSnapshot, outcomeSignals };
}
