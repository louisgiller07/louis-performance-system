import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { runDailyRun } from "./runDailyRun";
import { DailyPlanResult } from "./DailyPlanResult";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { loadLatestDecisionForDate } from "../history/historyRepo";
import { loadDecisionCurrency, type DecisionStaleReason } from "./decisionCurrencyRepo";
import type { DailyRunError } from "./dailyRunErrors";
import type { DailyRunResponse } from "./dailyPlanTypes";
import type { CheckinRow } from "../checkin/checkinTypes";

type RequestState = "idle" | "running" | "success" | "error";
/** NAL-003 — the persisted-decision restore lookup, independent of the generation RequestState above. */
type RestorePhase = "loading" | "ready" | "error";

const CHECKIN_CHANGED_NOTICE = "Ton check-in a changé. Génère un nouveau plan.";
const STALE_NOTICE: Record<DecisionStaleReason, string> = {
  checkin_changed: CHECKIN_CHANGED_NOTICE,
  planned_session_changed: "Ta séance prévue a changé. Génère un nouveau plan.",
};

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
  /**
   * UX-03 — Today's guided flow (all opt-in; every default keeps the
   * historical behavior covered by DailyPlanPanel.test.tsx):
   * - hideIdleWithoutCheckin: render nothing while there is no check-in and
   *   nothing to show (Today's check-in hero is the call to action instead
   *   of a disabled button).
   * - autoGenerateOnCheckinSave: after a check-in is actually saved (a new
   *   checkinRevision), start the daily run right away — the same
   *   handleGenerate() the button calls, same guards.
   * - minAnalysisMs: keep the "analysis" state visible at least this long
   *   before revealing the result (presentation pacing only; the request
   *   itself is never delayed or retried).
   * - runningSlot / loadingSlot: what to show while the run is in flight /
   *   while today's decision is being restored, instead of the plain text.
   */
  hideIdleWithoutCheckin?: boolean;
  autoGenerateOnCheckinSave?: boolean;
  minAnalysisMs?: number;
  runningSlot?: ReactNode;
  loadingSlot?: ReactNode;
  /**
   * UX-04 — opt-in Today presentation: when provided (even null), the result
   * shows "Ce que ton coach a retenu" + "Ton état du jour" with these check-in
   * values, and the longer reveal right after a fresh analysis. Undefined
   * keeps the historical result rendering.
   */
  checkinSnapshot?: CheckinRow | null;
  /** UX-05 — with checkinSnapshot: where the collapsible plan detail goes (bottom of Today). */
  detailsTarget?: HTMLElement | null;
}

// M4_004 request/state orchestration (invocation, concurrency guard,
// checkin-revision invalidation, error mapping) — the actual rendering of
// a successful result lives in DailyPlanResult.tsx (M4_005). No history,
// no coaching/safety logic here — the decision and any safety signal come
// only from the server response.
//
// V0.3_007B — this component no longer reports its currently-displayed
// decisionId/sessionType to its parent (the removed onLiveContextChange/
// LiveDailyPlanContext): useCompletedSessionFlow (UX-08) now resolves which decision a
// performed session corresponds to via its own explicit, athlete-scoped
// lookup of every valid same-day decision (loadValidDecisionsForDate) —
// deliberately never "whatever Today currently shows", which could
// silently point to a DIFFERENT decision than the one the athlete actually
// rode with if a new plan was generated after the fact. See
// docs/11_DECISION_LOG.md V0.3_007B.
export function DailyPlanPanel({
  athleteId,
  date,
  hasCheckin,
  checkinRevision,
  hideIdleWithoutCheckin = false,
  autoGenerateOnCheckinSave = false,
  minAnalysisMs = 0,
  runningSlot,
  loadingSlot,
  checkinSnapshot,
  detailsTarget,
}: DailyPlanPanelProps) {
  const { signOut } = useAuth();
  const [state, setState] = useState<RequestState>("idle");
  const [result, setResult] = useState<DailyRunResponse | null>(null);
  const [error, setError] = useState<DailyRunError | null>(null);
  const [invalidatedNotice, setInvalidatedNotice] = useState<string | null>(null);
  // UX-04 — whether the result on screen comes from a run in this session (vs. a restore).
  const [freshRun, setFreshRun] = useState(false);

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
        // PILOT_022 (REV-01) — the latest decision is not necessarily a valid
        // one: it is restored as today's executable plan only while the
        // check-in and planned session it was computed from are unchanged
        // (persisted provenance, evaluated server-side). A stale decision
        // stays in history but is never shown as current.
        const currency = await loadDecisionCurrency(row.id);
        if (currency.isCurrent) {
          setResult({ dailyPlan: row.dailyPlan, decisionId: row.id, healthFlagId: null, warnings: [] });
          setState("success");
        } else {
          setInvalidatedNotice(STALE_NOTICE[currency.staleReason ?? "checkin_changed"]);
        }
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

    if (hadVisibleResultRef.current) setInvalidatedNotice(CHECKIN_CHANGED_NOTICE);
    hadVisibleResultRef.current = false;
    setResult(null);
    setError(null);
    setState("idle");
    // UX-03 — opt-in: a freshly saved check-in goes straight into the run.
    // handleGenerate (hoisted) is this render's own, so it carries the new
    // checkinRevision; the revision guard above makes re-runs of this effect
    // (handleGenerate is a new function every render) a no-op.
    if (autoGenerateOnCheckinSave) void handleGenerate();
  }, [checkinRevision, autoGenerateOnCheckinSave, handleGenerate]);

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
    setInvalidatedNotice(null);
    setState("running");
    const startedAt = Date.now();
    try {
      const outcome = await runDailyRun(date);

      // UX-03 — presentation pacing only (0 by default): the analysis state
      // stays visible at least minAnalysisMs before the reveal.
      const remaining = minAnalysisMs - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

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
        setFreshRun(true);
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
  // show "Préparer ma séance du jour" while it's still possible a persisted decision
  // is about to replace that state seconds later, and never treat a read
  // failure as "no decision, please generate one".
  if (restorePhase === "loading") {
    return loadingSlot !== undefined ? <>{loadingSlot}</> : <p className="text-sm text-muted">Chargement de ton plan…</p>;
  }

  if (restorePhase === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-sm text-red-400">
          Impossible de charger ton plan du jour. Réessaie.
        </p>
        <SecondaryButton onClick={() => void restoreTodayDecision()} className="self-start">
          Réessayer
        </SecondaryButton>
      </div>
    );
  }

  if (hideIdleWithoutCheckin && !hasCheckin && state === "idle" && result === null && error === null) {
    return null;
  }

  if (runningSlot !== undefined && state === "running") {
    return <>{runningSlot}</>;
  }

  return (
    <div className="flex flex-col gap-3">
      {!(result && runningSlot !== undefined) && (
      <PrimaryButton onClick={() => void handleGenerate()} disabled={!hasCheckin || state === "running"}>
        {state === "running" ? "Analyse en cours…" : "Préparer ma séance du jour"}
      </PrimaryButton>
      )}

      {!hasCheckin && <p className="text-xs text-muted">Enregistre d'abord ton check-in du jour.</p>}

      {invalidatedNotice && <p className="text-xs text-muted">{invalidatedNotice}</p>}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error.message}
        </p>
      )}

      {result && (
        <DailyPlanResult
          result={result}
          today={checkinSnapshot !== undefined ? { checkin: checkinSnapshot, revealed: freshRun, detailsTarget } : undefined}
        />
      )}
    </div>
  );
}
