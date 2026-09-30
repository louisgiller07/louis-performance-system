import type { ReactNode } from "react";
import { PrimaryButton } from "../../components/PrimaryButton";

// UX-03 — Today before the check-in: one clear invitation instead of a
// long form. `planningSlot` shows what is planned for today (read-only).
const STEPS = ["Sommeil", "Énergie", "Fatigue", "Santé"];

// UX-09 — `kicker` / `title` / `text` let the rider's very first day say so ("Ton premier jour avec NALYNT").
export function CheckinHero({
  onStart,
  planningSlot,
  kicker = "Check-in du jour",
  title = "Comment tu te sens aujourd'hui ?",
  text = "Quatre étapes rapides. NALYNT prépare ensuite ta séance du jour.",
}: {
  onStart: () => void;
  planningSlot?: ReactNode;
  kicker?: string;
  title?: string;
  text?: string;
}) {
  return (
    <section aria-labelledby="checkin-hero-title" className="ux-grain relative overflow-hidden rounded-2xl border border-gold/45 bg-card p-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-br from-gold/10 via-transparent to-transparent" aria-hidden="true" />
      <p className="ux-enter flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        {kicker}
      </p>
      <h2 id="checkin-hero-title" className="ux-enter mt-4 font-display text-[clamp(2.5rem,11vw,3.25rem)] font-extrabold uppercase leading-[0.92] text-ink" style={{ ["--d" as string]: "80ms" }}>
        {title}
      </h2>
      <p className="ux-enter mt-3 text-base leading-relaxed text-ink/75" style={{ ["--d" as string]: "160ms" }}>
        {text}
      </p>
      <ol className="ux-enter mt-5 flex flex-wrap gap-2" style={{ ["--d" as string]: "220ms" }} aria-label="Étapes du check-in">
        {STEPS.map((step, index) => (
          <li key={step} className="rounded-sm border border-line px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink/75">
            <span className="text-gold">{index + 1}</span> {step}
          </li>
        ))}
      </ol>
      <PrimaryButton onClick={onStart} className="ux-enter mt-6 w-full" style={{ ["--d" as string]: "300ms" }}>
        Commencer mon check-in
      </PrimaryButton>
      {planningSlot && <div className="mt-5 border-t border-line pt-4">{planningSlot}</div>}
    </section>
  );
}
