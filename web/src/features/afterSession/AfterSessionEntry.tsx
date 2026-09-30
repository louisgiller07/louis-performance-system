import { StateCard } from "../../components/StateCard";
import { useState } from "react";
import { PrimaryButton } from "../../components/PrimaryButton";
import { CheckinSheet } from "../checkin/CheckinSheet";
import { useCompletedSessionFlow } from "./useCompletedSessionFlow";
import { AfterSessionFlow } from "./AfterSessionFlow";
import { AfterSessionSummary } from "./AfterSessionSummary";
import { ENTRY } from "./afterSessionPresentation";

// UX-08 — Today's after-session moment: an invitation until the session is
// recorded, then what NALYNT keeps from it. The steps open in the same sheet
// as the morning check-in.
export function AfterSessionEntry({ date, athleteId }: { date: string; athleteId: string }) {
  const flow = useCompletedSessionFlow(date, athleteId);
  const [fresh, setFresh] = useState(false);
  const [isNew, setIsNew] = useState(true);

  function open() {
    setIsNew(flow.record === null);
    setFresh(false);
    void flow.startEdit();
  }

  if (flow.loadState === "loading") return <div className="ux-skeleton h-28 rounded-2xl" aria-hidden="true" />;
  if (flow.loadState === "error") {
    return (
      <StateCard tone="error" title={ENTRY.kicker}>
        {flow.loadError?.message ?? ENTRY.loadError}
      </StateCard>
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
