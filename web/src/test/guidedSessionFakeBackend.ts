// UX-11C.1 / 11C.2 — test-only in-memory backend for the guided session UI.
// It reproduces the record_session_execution rules the UI relies on (one
// batch = one transaction; idempotent device ids; one open execution per day;
// current final prescription checked at start only; events before sets; set
// item / measure checked against the execution's OWN prescription; a
// correction supersedes one original, once, never a correction) and the
// loader's reading of the day (open execution with its frozen prescription,
// else the current decision; abandoned attempt restartable while current).
// The real rules are covered against the real database by the integration
// tests; this double only keeps the UI tests fast and deterministic.
import { vi } from "vitest";
import type { GuidedSessionDeps } from "../features/guidedSession/useGuidedSession";
import { isTerminal, phaseOf, selectDayExecution, type ExecutionRow, type SetResultRow } from "../features/guidedSession/executionState";
import type { GuidedSessionSnapshot } from "../features/guidedSession/guidedSessionLoader";
import type { SessionExecutionBatch, SessionExecutionResult } from "../features/guidedSession/sessionExecutionClient";
import type { ExerciseItemView, FinalPrescriptionV2View } from "../features/finalPrescriptionV2/finalPrescriptionV2Types";
import { decodeFinalPrescriptionV2 } from "../features/finalPrescriptionV2/decodeFinalPrescriptionV2";
import { keepFinalPrescription, type FixtureKind } from "./fixtures/finalPrescriptionV2Fixtures";

export const DAY = "2026-10-09";

export function prescriptionView(kind: FixtureKind, mutate?: (structure: Record<string, any>) => void): FinalPrescriptionV2View {
  const fp = keepFinalPrescription(kind);
  mutate?.(fp.record.structure);
  const r = decodeFinalPrescriptionV2(fp.record);
  if (!r.ok) throw new Error(r.reason);
  return r.view;
}

type Refusal = { ok: false; error: { code: string; status: number; retryable: false } };
const refuse = (code: string, status = 409): Refusal => ({ ok: false, error: { code, status, retryable: false } });
class Rejected extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(refusal.error.code);
    this.refusal = refusal;
  }
}

export interface FakeCurrent {
  prescription: FinalPrescriptionV2View | null;
  unavailable?: GuidedSessionSnapshot & { kind: "unavailable" };
}

export function fakeBackend(initial: FakeCurrent, extra: FinalPrescriptionV2View[] = []) {
  let executions: ExecutionRow[] = [];
  let seq = 0;
  let clock = 0;
  const eventIds = new Map<string, string>();
  const state = {
    current: initial,
    /** Next posts fail with a network error; "landed" = the server committed before the reply was lost. */
    networkFailures: [] as Array<"landed" | "lost">,
    posts: [] as SessionExecutionBatch[],
  };
  const prescriptions = new Map<string, FinalPrescriptionV2View>();
  for (const p of [initial.prescription, ...extra]) if (p) prescriptions.set(p.id, p);

  const itemOf = (fpId: string | null, itemId: string): ExerciseItemView | undefined =>
    fpId === null ? undefined : (prescriptions.get(fpId)?.blocks.flatMap((b) => b.items).find((i) => i.prescriptionItemId === itemId && i.kind === "exercise") as ExerciseItemView | undefined);

  function applyOrThrow(batch: SessionExecutionBatch) {
    const inserted: Record<string, string[]> = { executions: [], events: [], sets: [] };
    const unchanged: Record<string, string[]> = { executions: [], events: [], sets: [] };
    if (batch.execution) {
      const x = batch.execution;
      const existing = executions.find((e) => e.id === x.id);
      if (existing) {
        if (existing.final_prescription_id !== x.final_prescription_id || existing.started_at !== x.started_at) throw new Rejected(refuse("id_conflict"));
        unchanged.executions!.push(x.id);
      } else {
        if (x.final_prescription_id !== state.current.prescription?.id) throw new Rejected(refuse("final_prescription_not_current"));
        if (executions.some((e) => !isTerminal(phaseOf(e)))) throw new Rejected(refuse("active_execution_exists"));
        executions.push({ id: x.id, session_date: DAY, final_prescription_id: x.final_prescription_id, started_at: x.started_at, recorded_at: `2026-10-09T17:${String(++clock).padStart(2, "0")}:00Z`, execution_events: [], exercise_set_results: [] });
        inserted.executions!.push(x.id);
      }
    }
    for (const ev of batch.events) {
      if (eventIds.has(ev.id)) {
        unchanged.events!.push(ev.id);
        continue;
      }
      const exec = executions.find((e) => e.id === ev.execution_id);
      if (!exec) throw new Rejected(refuse("execution_not_found", 404));
      const last = phaseOf(exec);
      const allowed =
        (last === "not_started" && ev.event_type === "started") ||
        (last === "active" && ["paused", "completed", "abandoned"].includes(ev.event_type)) ||
        (last === "paused" && ["resumed", "completed", "abandoned"].includes(ev.event_type));
      if (!allowed) throw new Rejected(refuse("invalid_transition"));
      eventIds.set(ev.id, ev.event_type);
      exec.execution_events.push({ event_type: ev.event_type, event_seq: ++seq });
      inserted.events!.push(ev.id);
    }
    for (const set of batch.sets ?? []) {
      const all = executions.flatMap((e) => e.exercise_set_results);
      const existing = all.find((r) => r.id === set.id);
      if (existing) {
        const same =
          existing.prescription_item_id === set.prescription_item_id &&
          existing.set_number === set.set_number &&
          existing.measure_value === set.measure_value &&
          existing.rpe_actual === set.rpe_actual &&
          existing.load_kg === set.load_kg &&
          existing.supersedes_id === set.supersedes_id &&
          existing.occurred_at === set.occurred_at;
        if (!same) throw new Rejected(refuse("id_conflict"));
        unchanged.sets!.push(set.id);
        continue;
      }
      const exec = executions.find((e) => e.id === set.execution_id);
      if (!exec) throw new Rejected(refuse("execution_not_found", 404));
      const item = itemOf(exec.final_prescription_id, set.prescription_item_id);
      if (!item) throw new Rejected(refuse("invalid_item", 422));
      if (item.measure.type !== set.measure_type) throw new Rejected(refuse("measure_mismatch", 422));
      if (set.supersedes_id) {
        const target = exec.exercise_set_results.find((r) => r.id === set.supersedes_id);
        if (!target || target.supersedes_id !== null || target.prescription_item_id !== set.prescription_item_id || target.set_number !== set.set_number || all.some((r) => r.supersedes_id === set.supersedes_id)) {
          throw new Rejected(refuse("invalid_correction"));
        }
      }
      const row: SetResultRow = { ...set, other_exercise_name: null, recorded_at: `2026-10-09T18:${String(++clock).padStart(2, "0")}:00Z` };
      exec.exercise_set_results.push(row);
      inserted.sets!.push(set.id);
    }
    return { inserted, unchanged };
  }

  /** One batch = one transaction: any refusal rolls everything back. */
  function apply(batch: SessionExecutionBatch): SessionExecutionResult {
    const before = structuredClone(executions);
    const beforeIds = new Map(eventIds);
    const beforeSeq = seq;
    try {
      return { ok: true, value: applyOrThrow(batch) };
    } catch (e) {
      executions = before;
      eventIds.clear();
      for (const [k, v] of beforeIds) eventIds.set(k, v);
      seq = beforeSeq;
      if (e instanceof Rejected) return e.refusal;
      throw e;
    }
  }

  const post = vi.fn(async (batch: SessionExecutionBatch): Promise<SessionExecutionResult> => {
    state.posts.push(structuredClone(batch));
    const failure = state.networkFailures.shift();
    if (failure) {
      if (failure === "landed") apply(batch);
      return { ok: false, error: { code: "network_error", status: null, retryable: true } };
    }
    return apply(batch);
  });

  const load = vi.fn(async (): Promise<GuidedSessionSnapshot> => {
    const snapshotOf = structuredClone(executions);
    const day = selectDayExecution(snapshotOf);
    if (day && !isTerminal(day.phase)) {
      const p = prescriptions.get(day.execution.final_prescription_id!);
      return { kind: "execution", ...day, prescription: p ? { kind: "created", prescription: p } : { kind: "unsupported_schema_or_catalog", reason: "old catalogue" } };
    }
    if (state.current.unavailable) return state.current.unavailable;
    const cur = state.current.prescription!;
    if (day && day.execution.final_prescription_id === cur.id) {
      const completedOnce = snapshotOf.some((e) => e.final_prescription_id === cur.id && phaseOf(e) === "completed");
      return day.phase === "abandoned" && !completedOnce
        ? { kind: "execution", ...day, prescription: { kind: "created", prescription: cur }, restartFinalPrescriptionId: cur.id }
        : { kind: "execution", ...day, prescription: { kind: "created", prescription: cur } };
    }
    return { kind: "ready_to_start", finalPrescriptionId: cur.id, prescription: cur };
  });

  let n = 0;
  const deps: GuidedSessionDeps = { load, post, newId: () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`, now: () => "2026-10-09T17:00:00Z" };
  return {
    deps,
    state,
    get executions() {
      return executions;
    },
    post,
    load,
    prescriptions,
    setCurrent(next: FakeCurrent) {
      state.current = next;
      if (next.prescription) prescriptions.set(next.prescription.id, next.prescription);
    },
  };
}
