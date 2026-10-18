// UX-11C.1 — what the guided session shows for the rider's day, derived
// from the database only (never from a link, a cached Today state or the
// plan):
// 1. an OPEN execution of the day (at most one, backend rule) → resume it,
//    with the final prescription it is linked to (frozen: a newer daily
//    decision never replaces it);
// 2. otherwise a COMPLETED execution of the day (UX-11R.9, R9-UI-01) → shown
//    read only with its own frozen final prescription, whatever the day's
//    current decision has become; never a new start or a restart;
// 3. otherwise the day's CURRENT decision (latest valid, still current for
//    its inputs, newest row — the same notion as Today and
//    record_session_execution): a `created` V2 final prescription can be
//    started; an abandoned execution of that same prescription is shown read
//    only and may be restarted as a NEW execution (UX-11C.2);
//    REST, blocked, V1, missing or unsupported → unavailable.
// Starting from a planned prescription or planned_sessions is impossible by
// construction.
// P0-3 (HPM 2026-10-13) — an OPEN execution also carries why it cannot go on
// (`healthBlock`: health suspension, or a day decision that no longer matches
// the check-in), read from the persisted signals and decision: the screen then
// offers no resume and no new result, only a safe stop. The server refuses those
// actions anyway (record_session_execution, migration 20261013160000).
// SPORT-SAFE-01R (HPM 2026-10-18, A1) — a session the rider can start or go on with carries M1's guidance of ITS
// decision (`guidance`: protection and monitoring, see dayGuidance.tsx): the current decision before the start, the
// execution's own decision (decision_id) while it is open. Read only or blocked: no guidance (nothing to train).
import { loadDecisionById, loadLatestDecisionForDate } from "../history/historyRepo";
import { dayGuidanceOf, type DayGuidance } from "../dailyPlan/dayGuidance";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import { loadDecisionCurrency } from "../dailyPlan/decisionCurrencyRepo";
import { loadFinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2State";
import type { FinalPrescriptionV2State, FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import { loadOpenHealthFlags } from "../healthFlags/openHealthFlagsRepo";
import { loadDayExecutions, loadExecutionPrescription } from "./executionRepo";
import { isTerminal, phaseOf, selectDayExecution, type ExecutionPhase, type ExecutionRow } from "./executionState";
import { healthBlockOf, type HealthBlock } from "./healthBlock";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";

export type UnavailableReason = "no_decision" | "stale_decision" | "rest" | "blocked" | "not_v2" | "missing_prescription" | "unsupported" | "invalid";

export type GuidedSessionSnapshot =
  | {
      kind: "execution";
      execution: ExecutionRow;
      phase: ExecutionPhase;
      prescription: FinalPrescriptionV2State;
      /** UX-11C.2 — set only on an abandoned attempt whose final prescription is still the day's current one: a restart creates a NEW execution. */
      restartFinalPrescriptionId?: string;
      /** P0-3 — set only on an OPEN execution that cannot go on (no resume, no new result; a safe stop stays possible). */
      healthBlock?: HealthBlock;
      /** SPORT-SAFE-01R — set only on an OPEN execution that can go on: M1's guidance of the execution's own decision. */
      guidance?: DayGuidance;
    }
  | { kind: "ready_to_start"; finalPrescriptionId: string; prescription: FinalPrescriptionV2View; guidance?: DayGuidance }
  | { kind: "unavailable"; reason: UnavailableReason };

function unavailableFor(state: FinalPrescriptionV2State | undefined): UnavailableReason {
  if (state === undefined) return "not_v2";
  switch (state.kind) {
    case "not_required":
      return "rest";
    case "blocked":
      return "blocked";
    case "final_prescription_missing":
      return "missing_prescription";
    case "unsupported_schema_or_catalog":
      return "unsupported";
    default:
      return "invalid";
  }
}

/** P0-3 — the persisted reasons an open execution of `date` cannot go on (see healthBlock.ts). */
async function openExecutionHealthBlock(athleteId: string, date: string, prescription: FinalPrescriptionV2State): Promise<HealthBlock | null> {
  const [flags, decision] = await Promise.all([loadOpenHealthFlags(athleteId), loadLatestDecisionForDate(athleteId, date)]);
  const isCurrent = decision === null ? true : (await loadDecisionCurrency(decision.id)).isCurrent;
  return healthBlockOf({
    openFlagTypes: flags.map((flag) => flag.type),
    family: prescription.kind === "created" ? prescription.prescription.family : null,
    // loadLatestDecisionForDate only returns a row whose daily plan passed isValidDailyPlan.
    latestDecision: decision === null ? null : { dailyPlan: decision.dailyPlan as DailyPlan, isCurrent },
  });
}

export async function loadGuidedSession(athleteId: string, date: string): Promise<GuidedSessionSnapshot> {
  const executions = await loadDayExecutions(athleteId, date);
  const dayExecution = selectDayExecution(executions);

  if (dayExecution && !isTerminal(dayExecution.phase)) {
    const prescription: FinalPrescriptionV2State = dayExecution.execution.final_prescription_id
      ? await loadExecutionPrescription(dayExecution.execution.final_prescription_id)
      : { kind: "final_prescription_missing" };
    const healthBlock = await openExecutionHealthBlock(athleteId, date, prescription);
    if (healthBlock) return { kind: "execution", ...dayExecution, prescription, healthBlock };
    const guidance = await executionGuidance(athleteId, dayExecution.execution);
    return { kind: "execution", ...dayExecution, prescription, ...(guidance ? { guidance } : {}) };
  }

  // UX-11R.9 (R9-UI-01) — a COMPLETED execution of the day is the day's session (one main session per
  // day): shown read only with ITS OWN frozen final prescription, before and independently of the
  // day's current decision (newer, stale, REST, blocked or linked to another prescription). Never
  // ready_to_start, never a restart. Several completions (historical data only, the server now
  // refuses a second one): selectDayExecution's existing deterministic order — the most recently
  // recorded, then the highest id.
  const completed = selectDayExecution(executions.filter((e) => phaseOf(e) === "completed"));
  if (completed) {
    const prescription: FinalPrescriptionV2State = completed.execution.final_prescription_id
      ? await loadExecutionPrescription(completed.execution.final_prescription_id)
      : { kind: "final_prescription_missing" };
    return { kind: "execution", ...completed, prescription };
  }

  const decision = await loadLatestDecisionForDate(athleteId, date);
  if (decision === null) return { kind: "unavailable", reason: "no_decision" };
  const currency = await loadDecisionCurrency(decision.id);
  if (!currency.isCurrent) return { kind: "unavailable", reason: "stale_decision" };
  const state = await loadFinalPrescriptionV2State(decision);
  if (state?.kind !== "created") {
    // P0-3 — an attempt of the day stopped (abandoned) while the current decision offers no session (e.g. a REST
    // under a health suspension) stays readable with its OWN frozen prescription and results: never restartable.
    if (dayExecution) {
      const prescription: FinalPrescriptionV2State = dayExecution.execution.final_prescription_id
        ? await loadExecutionPrescription(dayExecution.execution.final_prescription_id)
        : { kind: "final_prescription_missing" };
      return { kind: "execution", ...dayExecution, prescription };
    }
    return { kind: "unavailable", reason: unavailableFor(state) };
  }

  const current = state.prescription;
  if (dayExecution && dayExecution.execution.final_prescription_id === current.id) {
    // An abandoned attempt is never resumed; it may be restarted (new execution, new ids) while its
    // prescription is still current and nothing of it was completed. A completed one stays read only.
    const completedOnce = executions.some((e) => e.final_prescription_id === current.id && phaseOf(e) === "completed");
    return dayExecution.phase === "abandoned" && !completedOnce
      ? { kind: "execution", ...dayExecution, prescription: state, restartFinalPrescriptionId: current.id }
      : { kind: "execution", ...dayExecution, prescription: state };
  }
  // loadLatestDecisionForDate only returns a row whose daily plan passed isValidDailyPlan.
  const guidance = dayGuidanceOf(decision.dailyPlan as DailyPlan);
  return { kind: "ready_to_start", finalPrescriptionId: current.id, prescription: current, ...(guidance ? { guidance } : {}) };
}

/** SPORT-SAFE-01R — M1's guidance of the decision the open execution was started from; none without that decision. */
async function executionGuidance(athleteId: string, execution: ExecutionRow): Promise<DayGuidance | null> {
  if (typeof execution.decision_id !== "string") return null;
  const decision = await loadDecisionById(athleteId, execution.decision_id);
  // A row this screen cannot read as a daily plan gives no guidance (never a text of the browser's own).
  return decision !== null && isValidDailyPlan(decision.dailyPlan) ? dayGuidanceOf(decision.dailyPlan as DailyPlan) : null;
}
