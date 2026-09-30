import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

// UX-10A — full-screen states outside the app shell (app start, auth
// callbacks, configuration errors): the NALYNT mark instead of a bare
// grey "Chargement…" or a raw red line.
export function BrandLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6" aria-busy="true">
      <BrandMark size="md" />
      <div className="mt-6 h-[3px] w-24 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <span className="ux-skeleton block h-full w-full" />
      </div>
      <p className="sr-only">Chargement…</p>
    </div>
  );
}

export function BrandMessage({ title, children, tone = "neutral" }: { title: string; children?: ReactNode; tone?: "neutral" | "error" }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-center">
      <BrandMark size="md" />
      <div role={tone === "error" ? "alert" : undefined} className={`mt-8 w-full max-w-sm rounded-2xl border bg-card p-6 ${tone === "error" ? "border-red-400/40" : "border-line"}`}>
        <h1 className="font-display text-2xl font-extrabold uppercase leading-tight text-ink">{title}</h1>
        {children && <div className="mt-3 text-sm leading-relaxed text-ink/80">{children}</div>}
      </div>
    </div>
  );
}
