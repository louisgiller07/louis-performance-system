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
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      <div className="mt-2 flex flex-col gap-1.5 text-sm text-gray-700">{children}</div>
    </div>
  );
}
