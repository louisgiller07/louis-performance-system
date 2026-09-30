import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PrimaryButton } from "./PrimaryButton";
import { SecondaryButton } from "./SecondaryButton";

// UX-10B-2A — every in-app empty, error or "not found" state, in the app's
// words and identity: a title, one sentence, at most one action. Never a
// raw red line, never an error code, never something that looks like a log.
export interface StateCardAction {
  label: string;
  /** A route to go to… */
  to?: string;
  /** …or something to do (e.g. retry). */
  onClick?: () => void;
}

export function StateCard({
  title,
  children,
  action,
  tone = "neutral",
  kicker,
}: {
  title: string;
  children?: ReactNode;
  action?: StateCardAction;
  tone?: "neutral" | "error";
  kicker?: string;
}) {
  const button =
    action &&
    (action.to ? (
      <Link to={action.to} className="mt-4 block">
        <PrimaryButton className="w-full">{action.label}</PrimaryButton>
      </Link>
    ) : tone === "error" ? (
      <SecondaryButton onClick={action.onClick} className="mt-4 w-full">
        {action.label}
      </SecondaryButton>
    ) : (
      <PrimaryButton onClick={action.onClick} className="mt-4 w-full">
        {action.label}
      </PrimaryButton>
    ));
  return (
    <section role={tone === "error" ? "alert" : undefined} className={`ux-enter rounded-2xl border bg-card p-5 ${tone === "error" ? "border-red-400/35" : "border-line"}`}>
      {kicker && <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold">{kicker}</p>}
      <h2 className={`font-display text-2xl font-extrabold uppercase leading-tight text-ink ${kicker ? "mt-2" : ""}`}>{title}</h2>
      {children && <div className="mt-2 text-sm leading-relaxed text-ink/80">{children}</div>}
      {button}
    </section>
  );
}

/** In-page loading placeholders (instead of a bare "Chargement…"). */
export function StateSkeleton({ blocks = [28, 40] }: { blocks?: number[] }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <p className="sr-only">Chargement…</p>
      {blocks.map((height, index) => (
        <div key={index} className="ux-skeleton rounded-2xl" style={{ height: `${height * 4}px` }} />
      ))}
    </div>
  );
}
