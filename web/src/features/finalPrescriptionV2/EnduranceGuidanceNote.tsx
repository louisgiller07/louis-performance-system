// PHYS-02 — the endurance guidance of a session (read only): the rider's last
// session of the same protocol and, for base endurance, the effort reminder.
import type { EnduranceGuidanceView } from "./finalPrescriptionV2Types";
import { enduranceGuidanceLines } from "./enduranceCoachingCopy";

export function EnduranceGuidanceNote({ guidance, intervals }: { guidance: EnduranceGuidanceView; intervals: boolean }) {
  const lines = enduranceGuidanceLines(guidance, intervals);
  return (
    <div className="flex flex-col gap-0.5" data-testid="endurance-guidance">
      <p className="text-sm text-ink/80">{lines.headline}</p>
      {lines.detail && <p className="text-sm font-medium text-gold">{lines.detail}</p>}
    </div>
  );
}
