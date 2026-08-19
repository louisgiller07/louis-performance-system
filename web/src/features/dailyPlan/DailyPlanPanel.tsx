import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { runDailyRun } from "./runDailyRun";
import { DailyPlanResult } from "./DailyPlanResult";
import type { DailyRunError } from "./dailyRunErrors";
import type { DailyRunResponse } from "./dailyPlanTypes";

type RequestState = "idle" | "running" | "success" | "error";

interface DailyPlanPanelProps {
  date: string;
  hasCheckin: boolean;
  /**
   * Bumped by TodayPage every time a checkin is actually *saved* (not
   * merely loaded) — see CheckinForm's onCheckinAvailabilityChange vs. a
   * dedicated save signal. A plan generated from an older checkin must
   * never keep being shown as if it were still current.
   */
  checkinRevision: number;
}

// M4_004 request/state orchestration (invocation, concurrency guard,
// checkin-revision invalidation, error mapping) — the actual rendering of
// a successful result lives in DailyPlanResult.tsx (M4_005). No history,
// no coaching/safety logic here — the decision and any safety signal come
// only from the server response.
export function DailyPlanPanel({ date, hasCheckin, checkinRevision }: DailyPlanPanelProps) {
  const { signOut } = useAuth();
  const [state, setState] = useState<RequestState>("idle");
  const [result, setResult] = useState<DailyRunResponse | null>(null);
  const [error, setError] = useState<DailyRunError | null>(null);
  const [showInvalidatedNotice, setShowInvalidatedNotice] = useState(false);

  // A ref, not `state`, guards against concurrent submits: `state` is only
  // updated on the next render, so several rapid clicks fired before that
  // render all still see the same stale "idle" closure. `inFlightRef`
  // updates synchronously, so the second click's handler sees it
  // immediately — decisions are append-only server-side (M3), so this is
  // about not creating an accidental extra decision, not idempotency.
  const inFlightRef = useRef(false);

  // Always current, unlike a value captured inside handleGenerate's own
  // closure — used after `await` to detect that a newer checkin revision
  // has superseded this in-flight request.
  const latestRevisionRef = useRef(checkinRevision);
  latestRevisionRef.current = checkinRevision;

  const previousRevisionRef = useRef(checkinRevision);
  const hadVisibleResultRef = useRef(false);
  useEffect(() => {
    if (result !== null || error !== null) hadVisibleResultRef.current = true;
  }, [result, error]);

  useEffect(() => {
    if (previousRevisionRef.current === checkinRevision) return;
    previousRevisionRef.current = checkinRevision;

    if (hadVisibleResultRef.current) setShowInvalidatedNotice(true);
    hadVisibleResultRef.current = false;
    setResult(null);
    setError(null);
    setState("idle");
  }, [checkinRevision]);

  async function handleGenerate() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    // The revision this specific request is "for" — compared against
    // latestRevisionRef.current after the await, not against this same
    // closed-over value (which would just equal itself and never detect a
    // change that happened while the request was in flight).
    const requestRevision = checkinRevision;

    // Clear immediately: a previous SUCCESS must never remain visible
    // alongside a new attempt's error, and vice versa.
    setResult(null);
    setError(null);
    setShowInvalidatedNotice(false);
    setState("running");
    try {
      const outcome = await runDailyRun(date);

      if (latestRevisionRef.current !== requestRevision) {
        // The checkin was saved again while this request was in flight.
        // The server-side decision already happened (M3 is append-only —
        // we never try to cancel or undo it), but showing its result here
        // would misrepresent it as current for a checkin it wasn't
        // generated from. UI consistency only.
        return;
      }

      if (outcome.ok) {
        setResult(outcome.data);
        setState("success");
        return;
      }

      setError(outcome.error);
      setState("error");
      // Conservative: only a real 401 from the function call signs the user
      // out. A network/relay/fetch error never triggers a logout.
      if (outcome.error.action === "session_issue") {
        void signOut();
      }
    } finally {
      inFlightRef.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={!hasCheckin || state === "running"}
        className="rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {state === "running" ? "Analyse en cours…" : "Générer mon plan"}
      </button>

      {!hasCheckin && <p className="text-xs text-gray-400">Enregistre d'abord ton check-in du jour.</p>}

      {showInvalidatedNotice && <p className="text-xs text-gray-400">Ton check-in a changé. Génère un nouveau plan.</p>}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error.message}
        </p>
      )}

      {result && <DailyPlanResult result={result} />}
    </div>
  );
}
