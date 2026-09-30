import type { FormEvent, ReactNode } from "react";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { CHAPTERS, SHELL, type Chapter } from "./firstRunPresentation";

// UX-09 — the one frame of the first run, from the welcome to the first plan:
// the NALYNT mark, where the rider is in the four chapters, one question at a
// time (same rhythm as the guided check-in), one action at the bottom.
export function FirstRunShell({
  chapter,
  title,
  question,
  hint,
  children,
  onBack,
  onNext,
  nextLabel = SHELL.next,
  nextDisabled = false,
  busy = false,
  error = null,
  stepKey,
}: {
  chapter: Chapter;
  title: string;
  question?: string;
  hint?: string;
  children?: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Re-triggers the entrance animation when the step changes. */
  stepKey?: string;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!nextDisabled && !busy) onNext?.();
  }

  return (
    <div className="min-h-screen bg-bg">
      <form onSubmit={submit} aria-label={title} className="mx-auto flex min-h-screen max-w-md flex-col px-5 pt-[calc(1rem+env(safe-area-inset-top))]">
        <div className="flex min-h-12 items-center">
          <span className="font-display text-lg font-extrabold uppercase tracking-[0.28em] text-ink">Nalynt</span>
        </div>

        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          {CHAPTERS.map((label, index) => (
            <span key={label} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${index <= chapter ? "bg-gold" : "bg-line"}`} />
          ))}
        </div>
        <p className="mt-4 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted">{CHAPTERS[chapter]}</p>

        <div key={stepKey ?? title} className="ux-enter mt-2 flex flex-1 flex-col gap-6">
          <div>
            <h1 className="font-display text-5xl font-extrabold uppercase leading-none text-ink">{title}</h1>
            {question && <p className="mt-3 text-base text-ink/75">{question}</p>}
            {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
          </div>
          {children}
        </div>

        {onNext && (
          <div className="sticky bottom-0 -mx-5 mt-8 flex flex-col gap-3 border-t border-line bg-bg/95 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur-md">
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              {onBack && (
                <SecondaryButton onClick={onBack} disabled={busy} className="min-h-12 px-5">
                  {SHELL.back}
                </SecondaryButton>
              )}
              <PrimaryButton type="submit" disabled={nextDisabled || busy} className="flex-1 tracking-[0.08em]">
                {busy ? SHELL.saving : nextLabel}
              </PrimaryButton>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

/** One choice among a few (single or multiple), large targets. */
export function ChoiceList<T extends string>({
  options,
  labels,
  descriptions,
  selected,
  onToggle,
  label,
  columns = 1,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  descriptions?: Partial<Record<T, string>>;
  selected: readonly T[];
  onToggle: (value: T) => void;
  label: string;
  columns?: 1 | 2;
}) {
  return (
    <div role="group" aria-label={label} className={`grid gap-2 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {options.map((option) => {
        const pressed = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(option)}
            className={`ux-press min-h-12 rounded-lg border px-4 py-3 text-left ${pressed ? "border-gold bg-gold/12 text-ink" : "border-line text-ink/85 hover:border-gold/50"}`}
          >
            <span className="block text-base font-medium">{labels[option]}</span>
            {descriptions?.[option] && <span className="mt-0.5 block text-sm text-muted">{descriptions[option]}</span>}
          </button>
        );
      })}
    </div>
  );
}
