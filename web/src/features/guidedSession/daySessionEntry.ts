// P0-3 (HPM 2026-10-13) — Today's entry into the guided session, from the executions really recorded for the
// day, with the same priority as guidedSessionLoader (R9-UI-01): an OPEN execution first (with its own frozen
// prescription, whatever the day's current decision has become — new plan, re-run, blocked), then a COMPLETED
// one, else the current decision's created prescription. Never a second start after a completion, never a resume
// of an abandoned attempt, never a resume under a health suspension.
import { isTerminal, phaseOf, selectDayExecution, type ExecutionRow } from "./executionState";

export type DaySessionEntryKind = "resume" | "suspended" | "completed" | "start" | "none";

export function daySessionEntryKind(input: { executions: readonly ExecutionRow[]; finalPrescriptionCreated: boolean; healthSuspended: boolean }): DaySessionEntryKind {
  const day = selectDayExecution(input.executions);
  if (day && !isTerminal(day.phase)) return input.healthSuspended ? "suspended" : "resume";
  if (input.executions.some((e) => phaseOf(e) === "completed")) return "completed";
  if (input.healthSuspended) return "none";
  return input.finalPrescriptionCreated ? "start" : "none";
}
