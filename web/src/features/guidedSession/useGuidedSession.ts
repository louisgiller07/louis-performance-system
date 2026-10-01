// UX-11C.1 — guided-session controller. State is always re-read from the
// database after a confirmed write (no optimistic state). Each logical action
// builds its batch ONCE (device ids + timestamps); a retry re-sends exactly
// the same batch, so the backend's idempotence absorbs replays and a network
// error never creates a second execution, event or set result.
// UX-11C.2 — the session modules write through the same `submit` (set
// results), and completion carries the module's not-yet-sent results in the
// SAME batch as `completed` (one transaction: never "completed" while the
// last result failed).
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGuidedSession, type GuidedSessionSnapshot } from "./guidedSessionLoader";
import { postSessionExecutionBatch, type ExecutionEventType, type SessionExecutionBatch, type SetResultInput } from "./sessionExecutionClient";
import type { SubmitOutcome } from "./sessionModules";

/** start / pause / resume / abandon / complete, or a module action (e.g. `set:<item>#<n>`). */
export type GuidedActionKind = string;

export interface GuidedActionError {
  action: GuidedActionKind;
  code: string;
  /** Re-sending the same batch is the right recovery (network / server error). */
  retryable: boolean;
}

export type GuidedLoadState = { status: "loading" } | { status: "error" } | { status: "ready"; snapshot: GuidedSessionSnapshot };

export interface GuidedSessionDeps {
  load: typeof loadGuidedSession;
  post: typeof postSessionExecutionBatch;
  newId: () => string;
  now: () => string;
}

const DEFAULT_DEPS: GuidedSessionDeps = {
  load: loadGuidedSession,
  post: postSessionExecutionBatch,
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export function useGuidedSession(athleteId: string, date: string, deps: GuidedSessionDeps = DEFAULT_DEPS) {
  const [load, setLoad] = useState<GuidedLoadState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<GuidedActionError | null>(null);
  const pending = useRef<{ action: GuidedActionKind; batch: SessionExecutionBatch } | null>(null);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    try {
      setLoad({ status: "ready", snapshot: await deps.load(athleteId, date) });
    } catch {
      setLoad({ status: "error" });
    }
  }, [athleteId, date, deps]);

  // Initial load (and on a new athlete / day), ignoring a late answer after unmount.
  useEffect(() => {
    let active = true;
    deps.load(athleteId, date).then(
      (snapshot) => active && setLoad({ status: "ready", snapshot }),
      () => active && setLoad({ status: "error" })
    );
    return () => {
      active = false;
    };
  }, [athleteId, date, deps]);

  const send = useCallback(
    async (action: GuidedActionKind, batch: SessionExecutionBatch): Promise<SubmitOutcome> => {
      if (inFlight.current) return "ignored"; // double click: the first send owns the action
      inFlight.current = true;
      pending.current = { action, batch };
      setBusy(true);
      setActionError(null);
      try {
        const result = await deps.post(batch);
        if (!result.ok && result.error.retryable) {
          // Keep the same batch (same ids) for the retry; keep the last confirmed state on screen.
          setActionError({ action, code: result.error.code, retryable: true });
          return "retryable";
        }
        pending.current = null;
        // Business refusal (e.g. final_prescription_not_current, id_conflict): nothing was
        // written; the database decides what is shown next.
        if (!result.ok) setActionError({ action, code: result.error.code, retryable: false });
        await reload();
        return result.ok ? "ok" : "refused";
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [deps, reload]
  );

  /** Same logical action again (after an error) → the same batch; a new action → a new batch. */
  const batchFor = (action: GuidedActionKind, build: () => SessionExecutionBatch) =>
    pending.current?.action === action ? pending.current.batch : build();

  const event = (executionId: string, type: ExecutionEventType) => ({ id: deps.newId(), execution_id: executionId, event_type: type, occurred_at: deps.now() });

  /** Start (or, after an abandoned attempt, restart): always a NEW execution with new ids. */
  const start = (finalPrescriptionId: string) =>
    send(
      "start",
      batchFor("start", () => {
        const id = deps.newId();
        const at = deps.now();
        return {
          execution: { id, session_date: date, started_at: at, final_prescription_id: finalPrescriptionId, comment: null },
          events: [{ id: deps.newId(), execution_id: id, event_type: "started", occurred_at: at }],
        };
      })
    );
  const lifecycle = (action: "pause" | "resume" | "abandon", type: ExecutionEventType) => (executionId: string) =>
    send(action, batchFor(action, () => ({ events: [event(executionId, type)] })));

  /** `completed` + the module's pending results, in one batch (one transaction). */
  const complete = (executionId: string, pendingSets: SetResultInput[]) =>
    send(
      "complete",
      batchFor("complete", () => ({ events: [event(executionId, "completed")], ...(pendingSets.length > 0 ? { sets: pendingSets } : {}) }))
    );

  const retry = () => (pending.current ? send(pending.current.action, pending.current.batch) : Promise.resolve("ignored" as const));

  return {
    load,
    busy,
    actionError,
    reload,
    start,
    pause: lifecycle("pause", "paused"),
    resume: lifecycle("resume", "resumed"),
    abandon: lifecycle("abandon", "abandoned"),
    complete,
    submit: send,
    retry,
    newId: deps.newId,
    now: deps.now,
  };
}
