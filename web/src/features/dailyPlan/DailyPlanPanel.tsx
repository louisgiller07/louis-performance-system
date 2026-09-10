import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { runDailyRun } from "./runDailyRun";
import { DailyPlanResult } from "./DailyPlanResult";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { loadLatestDecisionForDate } from "../history/historyRepo";
import type { DailyRunError } from "./dailyRunErrors";
import type { DailyRunResponse } from "./dailyPlanTypes";

type RequestState = "idle" | "running" | "success" | "error";
/** NAL-003 — the persisted-decision restore lookup, independent of the generation RequestState above. */
type RestorePhase = "loading" | "ready" | "error";

interface DailyPlanPanelProps {
  /** NAL-003 — the caller's own resolved athleteId, used only to restore today's already-persisted decision (RLS-scoped, same read path as /history). */
  athleteId: string;
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
//
// V0.3_007B — this component no longer reports its currently-displayed
// decisionId/sessionType to its parent (the removed onLiveContextChange/
// LiveDailyPlanContext): CompletedSessionCard now resolves which decision a
// performed session corresponds to via its own explicit, athlete-scoped
// lookup of every valid same-day decision (loadValidDecisionsForDate) —
// deliberately never "whatever Today currently shows", which could
// silently point to a DIFFERENT decision than the one the athlete actually
// rode with if a new plan was generated after the fact. See
// docs/11_DECISION_LOG.md V0.3_007B.
export function DailyPlanPanel({ athleteId, date, hasCheckin, checkinRevision }: DailyPlanPanelProps) {
  const { signOut } = useAuth();
  const [state, setState] = useState<RequestState>("idle");
  const [result, setResult] = useState<DailyRunResponse | null>(null);
  const [error, setError] = useState<DailyRunError | null>(null);
  const [showInvalidatedNotice, setShowInvalidatedNotice] = useState(false);

  // NAL-003 — persisted-decision restore, entirely separate from the
  // generation RequestState above: reading what already happened today is
  // never itself a daily-run call, and a read failure must never collapse
  // into "no decision, generate one" (that would hide a real error behind
  // an apparently-normal empty state).
  const [restorePhase, setRestorePhase] = useState<RestorePhase>("loading");

  const restoreTodayDecision = useCallback(async () => {
    setRestorePhase("loading");
    try {
      const row = await loadLatestDecisionForDate(athleteId, date);
      if (row && isValidDailyPlan(row.dailyPlan)) {
        setResult({ dailyPlan: row.dailyPlan, decisionId: row.id, healthFlagId: null, warnings: [] });
        setState("success");
      }
      // No row, or a malformed/legacy row that fails validation: nothing to
      // restore — leaves `state` at its default "idle" so the normal
      // generation flow (existing behavior) is what the athlete sees.
      setRestorePhase("ready");
    } catch {
      setRestorePhase("error");
    }
  }, [athleteId, date]);

  useEffect(() => {
    void restoreTodayDecision();
    // restoreTodayDecision is stable per (athleteId, date) via useCallback's
    // own deps — safe to depend on directly, runs exactly once per mount
    // for a given day, never re-triggered by checkinRevision.
  }, [restoreTodayDecision]);

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

  // NAL-003 — the restore lookup gates everything below it: never briefly
  // show "Générer mon plan" while it's still possible a persisted decision
  // is about to replace that state seconds later, and never treat a read
  // failure as "no decision, please generate one".
  if (restorePhase === "loading") {
    return <p className="text-sm text-gray-400">Chargement de ton plan…</p>;
  }

  if (restorePhase === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger ton plan du jour. Réessaie.
        </p>
        <button
          type="button"
          onClick={() => void restoreTodayDecision()}
          className="self-start rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 active:bg-gray-100"
        >
          Réessayer
        </button>
      </div>
    );
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
