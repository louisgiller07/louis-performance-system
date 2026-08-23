/**
 * M5_004 pure data shapes — the exact input_snapshot/outcome_signals
 * contracts persisted via persist_decision_outcome. Deliberately restricted
 * (never a timeline dump, never prose) — see docs/11_DECISION_LOG.md
 * (M5_004) for the design record. As with types/sources.ts, these are pure
 * facts: `{state:"observed", value:false}` is not "bad", `execution.state
 * === "same_day_session_unlinked"` is not "non-adherent" — interpretation
 * belongs to a future M5_005 detector layer, never here.
 */
import type { CompletionStatus, DbSessionType, DecisionOutcomeHorizon, HealthFlagStatus, HealthFlagType } from "../types/sources.js";

// ===========================================================================
// Signal primitives
// ===========================================================================

export type SignalValue<T> =
  | { readonly state: "observed"; readonly value: T }
  | { readonly state: "observed_null" }
  | { readonly state: "missing_observation" };

export type DeltaUnavailableReason = "baseline_missing" | "baseline_field_null" | "target_missing" | "target_field_null";

export type DeltaValue = { readonly state: "computed"; readonly value: number } | { readonly state: "unavailable"; readonly reason: DeltaUnavailableReason };

/** Minimal, non-clinical health-flag reference — identity + lifecycle only, never the narrative fields (description/bodyLocation/resolutionNote). Full detail remains joinable directly against health_flags. */
export interface HealthFlagRef {
  readonly id: string;
  readonly flagDate: string;
  readonly flagType: HealthFlagType;
  readonly status: HealthFlagStatus;
  readonly resolvedAt: string | null;
}

// ===========================================================================
// Execution — strict discriminated union (M5_004 final lock, point 15)
// ===========================================================================

export type ExecutionSignal =
  | {
      readonly state: "explicit";
      readonly completedSessionId: string;
      readonly sessionType: DbSessionType;
      readonly completionStatus: CompletionStatus;
      readonly actualDurationMin: number | null;
      readonly rpe: number | null;
      readonly sessionLoad: number | null;
      readonly postLegFatigue: number | null;
      readonly postGripFatigue: number | null;
      readonly newPain: boolean;
    }
  | { readonly state: "no_completed_session" }
  | { readonly state: "same_day_session_unlinked" }
  | { readonly state: "same_day_session_linked_elsewhere" };

// ===========================================================================
// Response / delta / health-context signal groups
// ===========================================================================

export interface ResponseSignals {
  readonly energy: SignalValue<number>;
  readonly legFatigue: SignalValue<number>;
  readonly gripFatigue: SignalValue<number>;
  readonly motivation: SignalValue<number>;
  readonly workStress: SignalValue<number>;
  readonly pain: SignalValue<boolean>;
  readonly painIntensity: SignalValue<number>;
  readonly illness: SignalValue<boolean>;
  readonly suspectedConcussion: SignalValue<boolean>;
  readonly sleepHours: SignalValue<number>;
  readonly sleepQuality: SignalValue<number>;
  readonly sleepWakeUps: SignalValue<number>;
}

export interface DeltaSignals {
  readonly energyDelta: DeltaValue;
  readonly legFatigueDelta: DeltaValue;
  readonly gripFatigueDelta: DeltaValue;
  readonly painIntensityDelta: DeltaValue;
}

export interface HealthContextSignals {
  readonly activeOnTargetDate: readonly HealthFlagRef[];
  readonly newSinceDecision: readonly HealthFlagRef[];
  readonly unresolvedAtTarget: readonly HealthFlagRef[];
}

export interface OutcomeSignals {
  readonly schemaVersion: 1;
  readonly horizon: DecisionOutcomeHorizon;
  readonly targetDate: string;
  readonly execution: ExecutionSignal;
  readonly response: ResponseSignals;
  readonly delta: DeltaSignals;
  readonly healthContext: HealthContextSignals;
}

// ===========================================================================
// input_snapshot — replay record, may include fields outcome_signals omits
// (e.g. newPainNote — prose, excluded from outcome_signals but kept here).
// ===========================================================================

export interface CheckinSnapshot {
  readonly id: string;
  readonly checkinDate: string;
  readonly energy: number | null;
  readonly legFatigue: number | null;
  readonly gripFatigue: number | null;
  readonly motivation: number | null;
  readonly workStress: number | null;
  readonly pain: boolean;
  readonly painIntensity: number | null;
  readonly feverOrIllness: boolean;
  readonly suspectedConcussion: boolean;
  readonly sleepHours: number | null;
  readonly sleepQuality: number | null;
  readonly sleepWakeUps: number | null;
}

/** The same-day (decisionDate) completed_sessions row, if any — regardless of link state, so input_snapshot always explains why outcome_signals.execution landed on whichever state it did. */
export interface SameDaySessionSnapshot {
  readonly id: string;
  readonly sessionDate: string;
  readonly sessionType: DbSessionType;
  readonly completionStatus: CompletionStatus;
  readonly actualDurationMin: number | null;
  readonly rpe: number | null;
  readonly sessionLoad: number | null;
  readonly postLegFatigue: number | null;
  readonly postGripFatigue: number | null;
  readonly newPain: boolean;
  readonly newPainNote: string | null;
  readonly linkedDecisionId: string | null;
}

export interface InputSnapshot {
  readonly decisionId: string;
  readonly decisionDate: string;
  readonly horizon: DecisionOutcomeHorizon;
  readonly targetDate: string;
  readonly sourceCheckin: CheckinSnapshot | null;
  readonly targetCheckin: CheckinSnapshot | null;
  readonly sameDaySession: SameDaySessionSnapshot | null;
  readonly healthFlagsInWindow: readonly HealthFlagRef[];
}

export interface DecisionOutcomeCalculation {
  readonly inputSnapshot: InputSnapshot;
  readonly outcomeSignals: OutcomeSignals;
}
