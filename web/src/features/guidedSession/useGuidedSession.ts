// UX-11C.1 — guided-session controller. State is always re-read from the
// database after a confirmed write (no optimistic state). Each logical action
// builds its batch ONCE (device ids + timestamps); a retry re-sends exactly
// the same batch, so the backend's idempotence absorbs replays and a network
// error never creates a second execution or event.
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGuidedSession, type GuidedSessionSnapshot } from "./guidedSessionLoader";
import { postSessionExecutionBatch, type ExecutionEventType, type SessionExecutionBatch } from "./sessionExecutionClient";

export type GuidedActionKind = "start" | "pause" | "resume" | "abandon";

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
    async (action: GuidedActionKind, batch: SessionExecutionBatch) => {
      if (inFlight.current) return; // double click: the first send owns the action
      inFlight.current = true;
      pending.current = { action, batch };
      setBusy(true);
      setActionError(null);
      try {
        const result = await deps.post(batch);
        if (result.ok) {
          pending.current = null;
        } else if (result.error.retryable) {
          // Keep the same batch (same ids) for the retry; keep the last confirmed state on screen.
          setActionError({ action, code: result.error.code, retryable: true });
          return;
        } else {
          // Business refusal (e.g. final_prescription_not_current, active_execution_exists):
          // nothing was written; the database decides what is shown next.
          pending.current = null;
          setActionError({ action, code: result.error.code, retryable: false });
        }
        await reload();
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
  const lifecycle = (action: Exclude<GuidedActionKind, "start">, type: ExecutionEventType) => (executionId: string) =>
    send(action, batchFor(action, () => ({ events: [event(executionId, type)] })));

  const retry = () => (pending.current ? send(pending.current.action, pending.current.batch) : Promise.resolve());

  return {
    load,
    busy,
    actionError,
    reload,
    start,
    pause: lifecycle("pause", "paused"),
    resume: lifecycle("resume", "resumed"),
    abandon: lifecycle("abandon", "abandoned"),
    retry,
  };
}
