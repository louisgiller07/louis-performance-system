import { StateCard } from "../../components/StateCard";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PrimaryButton } from "../../components/PrimaryButton";
import { CheckinSheet } from "../checkin/CheckinSheet";
import { useCompletedSessionFlow } from "./useCompletedSessionFlow";
import { AfterSessionFlow } from "./AfterSessionFlow";
import { AfterSessionSummary } from "./AfterSessionSummary";
import { BUTTONS, ENTRY, GUIDED_DONE, GUIDED_OPEN } from "./afterSessionPresentation";
import { loadGuidedDayState, type GuidedDayState } from "../history/historyRepo";
import { useEffectiveDays } from "../effectiveSession/effectiveSessionRepo";
import { formatIntervention } from "../dailyPlan/dailyPlanLabels";
import { formatDuration } from "../dailyPlan/durationLabels";
import type { EffectiveDay } from "../effectiveSession/effectiveDay";

/** A07 — the session the guided block is about: the execution's own (effective) session, never the plan's. */
export function executedSessionLabel(day: EffectiveDay | undefined): string | null {
  const session = day?.source === "execution" ? day.session : null;
  if (!session) return null;
  return session.duration_min !== undefined ? `${formatIntervention(session)} · ${formatDuration(session.duration_min)}` : formatIntervention(session);
}

// UX-08 — Today's after-session moment: an invitation until the session is
// recorded, then what NALYNT keeps from it. The steps open in the same sheet
// as the morning check-in.
/**
 * UX-11R.9 (F-5, F-5b) — the day's guided session: completed, open, none ("unknown" while loading).
 * A11 — a read error is an error (with a retry), never an endless skeleton.
 */
function useGuidedDayState(date: string, athleteId: string, reloadKey: number): GuidedDayState | "unknown" | "error" {
  const [state, setState] = useState<GuidedDayState | "unknown" | "error">("unknown");
  useEffect(() => {
    let active = true;
    setState("unknown");
    loadGuidedDayState(athleteId, date).then(
      (loaded) => active && setState(loaded),
      () => active && setState("error")
    );
    return () => {
      active = false;
    };
  }, [athleteId, date, reloadKey]);
  return state;
}

export function AfterSessionEntry({ date, athleteId }: { date: string; athleteId: string }) {
  const flow = useCompletedSessionFlow(date, athleteId);
  const [reloadKey, setReloadKey] = useState(0);
  const guided = useGuidedDayState(date, athleteId, reloadKey);
  const dates = useMemo(() => [date], [date]);
  const executed = executedSessionLabel(useEffectiveDays(athleteId, dates, [])?.[0]);
  const [fresh, setFresh] = useState(false);
  const [isNew, setIsNew] = useState(true);

  function open() {
    setIsNew(flow.record === null);
    setFresh(false);
    void flow.startEdit();
  }

  function retryLoad() {
    flow.reload();
    setReloadKey((key) => key + 1);
  }

  if (flow.loadState === "error" || guided === "error") {
    return (
      <StateCard tone="error" title={ENTRY.kicker} action={{ label: BUTTONS.retry, onClick: retryLoad }}>
        {flow.loadError?.message ?? ENTRY.loadError}
      </StateCard>
    );
  }
  if (flow.loadState === "loading" || guided === "unknown") return <div className="ux-skeleton h-28 rounded-2xl" aria-hidden="true" />;

  // UX-11R.9 (F-5, F-5b) — a guided session completed or open today closes the legacy debrief (no invitation,
  // no edit: the server refuses it too, completed_session_v2_exists). A legacy record that already exists stays readable.
  if (guided !== "none") {
    const copy = guided === "completed" ? GUIDED_DONE : GUIDED_OPEN;
    // Canonical precedence (dayCompletion.ts): a non-skipped legacy record says more and stays readable;
    // a `skipped` one yields to the guided session.
    return flow.record && flow.record.completion_status !== "skipped" ? (
      <AfterSessionSummary record={flow.record} planned={flow.recordPlanned} fresh={false} />
    ) : (
      <section aria-labelledby="after-session-guided-title" className="ux-enter rounded-2xl border border-line bg-card p-5" data-testid="after-session-guided-done">
        <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          {ENTRY.kicker}
        </p>
        <h2 id="after-session-guided-title" className="mt-3 font-display text-2xl font-extrabold uppercase leading-none text-ink">
          {copy.title}
        </h2>
        {executed && (
          <p className="mt-2 font-medium text-ink" data-testid="after-session-executed">
            {executed}
          </p>
        )}
        <p className="mt-2 text-sm text-ink/80">{copy.body}</p>
        <Link to="/today/session" className="ux-press mt-3 inline-flex min-h-12 items-center text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
          {copy.link}
        </Link>
      </section>
    );
  }

  const editing = flow.mode === "editing";
  return (
    <>
      {flow.record ? (
        <AfterSessionSummary record={flow.record} planned={flow.recordPlanned} fresh={fresh} onEdit={open} />
      ) : (
        <section aria-labelledby="after-session-title" className="ux-enter rounded-2xl border border-line bg-card p-5">
          <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
            <span className="h-px w-5 bg-gold" aria-hidden="true" />
            {ENTRY.kicker}
          </p>
          <h2 id="after-session-title" className="mt-3 font-display text-3xl font-extrabold uppercase leading-none text-ink">
            {ENTRY.title}
          </h2>
          <PrimaryButton onClick={open} className="mt-4 w-full">
            {`${ENTRY.action} →`}
          </PrimaryButton>
        </section>
      )}

      <CheckinSheet open={editing} onClose={flow.cancelEdit} title={ENTRY.sheetTitle} label={ENTRY.sheetLabel} closeLabel={ENTRY.closeLabel}>
        {editing &&
          (flow.form ? (
            <AfterSessionFlow
              flow={{
                ...flow,
                submit: async () => {
                  const saved = await flow.submit();
                  if (saved) setFresh(true);
                  return saved;
                },
              }}
              isNew={isNew}
            />
          ) : (
            <div className="ux-skeleton h-64 rounded-2xl" aria-hidden="true" />
          ))}
      </CheckinSheet>
    </>
  );
}
