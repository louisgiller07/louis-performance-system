// UX-11C.1 — what the guided session shows for the rider's day, derived
// from the database only (never from a link, a cached Today state or the
// plan):
// 1. an OPEN execution of the day (at most one, backend rule) → resume it,
//    with the final prescription it is linked to (frozen: a newer daily
//    decision never replaces it);
// 2. otherwise the day's CURRENT decision (latest valid, still current for
//    its inputs, newest row — the same notion as Today and
//    record_session_execution): a `created` V2 final prescription can be
//    started; a terminal execution of that same prescription is shown read
//    only; REST, blocked, V1, missing or unsupported → unavailable.
// Starting from a planned prescription or planned_sessions is impossible by
// construction.
import { loadLatestDecisionForDate } from "../history/historyRepo";
import { loadDecisionCurrency } from "../dailyPlan/decisionCurrencyRepo";
import { loadFinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2State";
import type { FinalPrescriptionV2State, FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import { loadDayExecutions, loadExecutionPrescription } from "./executionRepo";
import { isTerminal, selectDayExecution, type ExecutionPhase, type ExecutionRow } from "./executionState";

export type UnavailableReason = "no_decision" | "stale_decision" | "rest" | "blocked" | "not_v2" | "missing_prescription" | "unsupported" | "invalid";

export type GuidedSessionSnapshot =
  | { kind: "execution"; execution: ExecutionRow; phase: ExecutionPhase; prescription: FinalPrescriptionV2State }
  | { kind: "ready_to_start"; finalPrescriptionId: string; prescription: FinalPrescriptionV2View }
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

export async function loadGuidedSession(athleteId: string, date: string): Promise<GuidedSessionSnapshot> {
  const executions = await loadDayExecutions(athleteId, date);
  const dayExecution = selectDayExecution(executions);

  if (dayExecution && !isTerminal(dayExecution.phase)) {
    const prescription: FinalPrescriptionV2State = dayExecution.execution.final_prescription_id
      ? await loadExecutionPrescription(dayExecution.execution.final_prescription_id)
      : { kind: "final_prescription_missing" };
    return { kind: "execution", ...dayExecution, prescription };
  }

  const decision = await loadLatestDecisionForDate(athleteId, date);
  if (decision === null) return { kind: "unavailable", reason: "no_decision" };
  const currency = await loadDecisionCurrency(decision.id);
  if (!currency.isCurrent) return { kind: "unavailable", reason: "stale_decision" };
  const state = await loadFinalPrescriptionV2State(decision);
  if (state?.kind !== "created") return { kind: "unavailable", reason: unavailableFor(state) };

  const current = state.prescription;
  if (dayExecution && dayExecution.execution.final_prescription_id === current.id) {
    return { kind: "execution", ...dayExecution, prescription: state };
  }
  return { kind: "ready_to_start", finalPrescriptionId: current.id, prescription: current };
}
