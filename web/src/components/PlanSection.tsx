import type { ReactNode } from "react";

interface PlanSectionProps {
  title: string;
  children: ReactNode;
}

// Generic titled card — the one repeated shell for every DailyPlan
// section (training, recovery, sleep, ...). No section-specific logic
// lives here.
export function PlanSection({ title, children }: PlanSectionProps) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted">{title}</h3>
      <div className="mt-2.5 flex flex-col gap-1.5 text-sm leading-relaxed text-ink/90">{children}</div>
    </div>
  );
}
