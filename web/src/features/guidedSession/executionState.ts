// UX-11C.1 — the guided-session state is a PROJECTION of the backend ledger
// (session_executions + execution_events), never a second state machine.
// The last event (server insertion order, event_seq) decides:
//   started | resumed → active · paused → paused · completed → completed ·
//   abandoned → abandoned · no execution → not_started.

export type ExecutionPhase = "not_started" | "active" | "paused" | "completed" | "abandoned";

export interface ExecutionEventRow {
  event_type: string;
  event_seq: number;
}

export interface ExecutionRow {
  id: string;
  session_date: string;
  final_prescription_id: string | null;
  started_at: string;
  recorded_at: string;
  execution_events: ExecutionEventRow[];
}

const PHASE_BY_LAST_EVENT: Readonly<Record<string, ExecutionPhase>> = {
  started: "active",
  resumed: "active",
  paused: "paused",
  completed: "completed",
  abandoned: "abandoned",
};

export function phaseOf(execution: ExecutionRow): ExecutionPhase {
  const last = [...execution.execution_events].sort((a, b) => a.event_seq - b.event_seq).at(-1);
  if (!last) return "not_started";
  const phase = PHASE_BY_LAST_EVENT[last.event_type];
  if (!phase) throw new Error(`unknown execution event type ${last.event_type}`);
  return phase;
}

export const isTerminal = (phase: ExecutionPhase) => phase === "completed" || phase === "abandoned";

/**
 * The execution the guided session shows for the day: the one still open
 * (the backend allows at most one per athlete and day), else the most
 * recently started one (terminal state, read only), else none.
 */
export function selectDayExecution(executions: readonly ExecutionRow[]): { execution: ExecutionRow; phase: ExecutionPhase } | null {
  const withPhase = executions.map((execution) => ({ execution, phase: phaseOf(execution) }));
  const open = withPhase.filter((e) => !isTerminal(e.phase));
  if (open.length > 1) throw new Error("several open executions for one day (the backend allows one)");
  if (open.length === 1) return open[0]!;
  const latest = [...withPhase].sort((a, b) => (a.execution.recorded_at < b.execution.recorded_at ? 1 : a.execution.recorded_at > b.execution.recorded_at ? -1 : a.execution.id < b.execution.id ? 1 : -1))[0];
  return latest ?? null;
}
