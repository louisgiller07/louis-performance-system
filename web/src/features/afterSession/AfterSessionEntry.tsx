import { StateCard } from "../../components/StateCard";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PrimaryButton } from "../../components/PrimaryButton";
import { CheckinSheet } from "../checkin/CheckinSheet";
import { useCompletedSessionFlow } from "./useCompletedSessionFlow";
import { AfterSessionFlow } from "./AfterSessionFlow";
import { AfterSessionSummary } from "./AfterSessionSummary";
import { ENTRY, GUIDED_DONE } from "./afterSessionPresentation";
import { loadGuidedCompletionsForDates } from "../history/historyRepo";
import { hasGuidedCompletion } from "../completion/dayCompletion";

// UX-08 — Today's after-session moment: an invitation until the session is
// recorded, then what NALYNT keeps from it. The steps open in the same sheet
// as the morning check-in.
/** UX-11R.9 (F-5) — whether the day already has a completed guided session ("unknown" while loading or on a read error). */
function useGuidedDone(date: string, athleteId: string): boolean | "unknown" {
  const [done, setDone] = useState<boolean | "unknown">("unknown");
  useEffect(() => {
    let active = true;
    setDone("unknown");
    loadGuidedCompletionsForDates(athleteId, [date]).then(
      (rows) => active && setDone(hasGuidedCompletion(date, rows)),
      () => active && setDone("unknown")
    );
    return () => {
      active = false;
    };
  }, [athleteId, date]);
  return done;
}

export function AfterSessionEntry({ date, athleteId }: { date: string; athleteId: string }) {
  const flow = useCompletedSessionFlow(date, athleteId);
  const guidedDone = useGuidedDone(date, athleteId);
  const [fresh, setFresh] = useState(false);
  const [isNew, setIsNew] = useState(true);

  function open() {
    setIsNew(flow.record === null);
    setFresh(false);
    void flow.startEdit();
  }

  if (flow.loadState === "loading" || guidedDone === "unknown") return <div className="ux-skeleton h-28 rounded-2xl" aria-hidden="true" />;
  if (flow.loadState === "error") {
    return (
      <StateCard tone="error" title={ENTRY.kicker}>
        {flow.loadError?.message ?? ENTRY.loadError}
      </StateCard>
    );
  }

  // UX-11R.9 (F-5) — a guided session completed today closes the legacy debrief (no invitation, no edit:
  // the server refuses it too, completed_session_v2_exists). A legacy record that already exists stays readable.
  if (guidedDone) {
    return flow.record ? (
      <AfterSessionSummary record={flow.record} planned={flow.recordPlanned} fresh={false} />
    ) : (
      <section aria-labelledby="after-session-guided-title" className="ux-enter rounded-2xl border border-line bg-card p-5" data-testid="after-session-guided-done">
        <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          {ENTRY.kicker}
        </p>
        <h2 id="after-session-guided-title" className="mt-3 font-display text-2xl font-extrabold uppercase leading-none text-ink">
          {GUIDED_DONE.title}
        </h2>
        <p className="mt-2 text-sm text-ink/80">{GUIDED_DONE.body}</p>
        <Link to="/today/session" className="ux-press mt-3 inline-flex min-h-12 items-center text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
          {GUIDED_DONE.link}
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
