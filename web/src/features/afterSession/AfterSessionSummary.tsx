import type { ReactNode } from "react";
import { SecondaryButton } from "../../components/SecondaryButton";
import type { TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import { CHANGE_REASON_LABELS, TECHNICAL_OUTCOME_LABELS, type CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import { BODY, BUTTONS, ENTRY, SUMMARY, performedLine, plannedLine } from "./afterSessionPresentation";

// UX-08 — what NALYNT keeps from the session: facts the athlete declared,
// side by side with what was asked. Never "bonne / mauvaise séance", never a
// score; a physical signal is recalled neutrally (not a safety warning).
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[0.68rem] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="text-right text-sm text-ink">{children}</dd>
    </div>
  );
}

export function AfterSessionSummary({
  record,
  planned,
  fresh,
  onEdit,
}: {
  record: CompletedSessionRecord;
  planned: TrainingIntervention | null;
  /** Just saved: the check mark pops. */
  fresh: boolean;
  onEdit: () => void;
}) {
  const body = [
    record.post_leg_fatigue !== null ? `${BODY.legs.label} ${record.post_leg_fatigue}/10` : null,
    record.post_grip_fatigue !== null ? `${BODY.forearms.label} ${record.post_grip_fatigue}/10` : null,
  ].filter(Boolean);
  const reason = record.change_reason ? [CHANGE_REASON_LABELS[record.change_reason], record.change_reason_note].filter(Boolean).join(" — ") : null;

  return (
    <section aria-labelledby="after-session-title" className="ux-enter rounded-2xl border border-gold/40 bg-card p-5">
      <p className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        {ENTRY.kicker}
      </p>
      <h2 id="after-session-title" className="mt-3 font-display text-3xl font-extrabold uppercase leading-none text-ink">
        {SUMMARY.title} <span className={`text-gold ${fresh ? "ux-pop inline-block" : ""}`}>✓</span>
      </h2>
      <p className="mt-2 text-sm text-ink/80">{SUMMARY.keeps}</p>

      <p className="mt-5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-gold">{SUMMARY.today}</p>
      <dl className="mt-1">
        {planned && <Row label={SUMMARY.planned}>{plannedLine(planned)}</Row>}
        <Row label={record.completion_status === "skipped" ? SUMMARY.session : SUMMARY.done}>{performedLine(record)}</Row>
        {reason && <Row label={record.completion_status === "skipped" ? SUMMARY.reasonSkipped : SUMMARY.reasonChanged}>{reason}</Row>}
        {record.technical_outcome && <Row label={SUMMARY.task}>{TECHNICAL_OUTCOME_LABELS[record.technical_outcome]}</Row>}
        {record.rpe !== null && <Row label={SUMMARY.effort}>{`${record.rpe}/10`}</Row>}
        {body.length > 0 && <Row label={SUMMARY.body}>{body.join(" · ")}</Row>}
      </dl>

      {record.new_pain && (
        <div className="mt-4 rounded-lg border border-line bg-bg/40 p-3">
          <p className="text-[0.68rem] uppercase tracking-[0.16em] text-muted">{SUMMARY.signal}</p>
          {record.new_pain_note && <p className="mt-1 text-sm text-ink">{record.new_pain_note}</p>}
          <p className="mt-1 text-xs text-ink/70">{SUMMARY.signalReminder}</p>
        </div>
      )}

      <p className="mt-5 border-t border-line pt-4 font-display text-xl font-extrabold uppercase leading-tight text-ink">
        {SUMMARY.promise[0]}
        <br />
        <span className="text-gold">{SUMMARY.promise[1]}</span>
      </p>
      <SecondaryButton onClick={onEdit} className="mt-4 self-start">
        {BUTTONS.edit}
      </SecondaryButton>
    </section>
  );
}
