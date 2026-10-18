// PHYS-01 — the load guidance of a Force work exercise (read only): the load
// to use today and why, shared by the day's card and the guided session.
import type { ExerciseItemView } from "./finalPrescriptionV2Types";
import { loadGuidanceLines } from "./loadGuidanceCopy";
import { repsGuidanceLines } from "./repsGuidanceCopy";

export function LoadGuidanceNote({ item }: { item: ExerciseItemView }) {
  // PHYS-04 — a bodyweight work exercise: its repetitions guidance instead.
  if (!item.loadGuidance) {
    if (!item.repsGuidance || item.measure.type !== "reps") return null;
    const reps = repsGuidanceLines(item.repsGuidance, item.measure, item.measure.perSide);
    return (
      <div className="flex flex-col gap-0.5" data-testid="reps-guidance" data-mode={item.repsGuidance.mode}>
        <p className="text-sm font-medium text-gold">{reps.headline}</p>
        <p className="text-sm text-ink/80">{reps.detail}</p>
      </div>
    );
  }
  const lines = loadGuidanceLines(item.loadGuidance, item.measure);
  return (
    <div className="flex flex-col gap-0.5" data-testid="load-guidance" data-mode={item.loadGuidance.mode}>
      <p className="text-sm font-medium text-gold">{lines.headline}</p>
      <p className="text-sm text-ink/80">{lines.detail}</p>
    </div>
  );
}
