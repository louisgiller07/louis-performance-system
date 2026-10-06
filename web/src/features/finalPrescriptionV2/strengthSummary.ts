// A02 — what a Force prescription V2 adds up to, derived from the prescription
// itself (never a second source of sets, reps, RPE or exercises). The counts
// say WHAT they count: work sets are the sets of the exercises of the work
// blocks (main / complementary) — never the warm-up, never the ramp-up sets
// of the main movement, which are shown apart.
import type { ExerciseItemView, FinalPrescriptionV2View, RangeView } from "./finalPrescriptionV2Types";
import { span } from "./finalPrescriptionV2Copy";

/** Blocks whose exercises are the session's work (warm-up and ramp-up stay outside the counts). */
export const WORK_BLOCK_ROLES = ["main", "complementary"] as const;

export interface StrengthSummary {
  /** Work exercises, in prescription order. */
  workExercises: ExerciseItemView[];
  /** Sum of the work exercises' prescribed sets. */
  workSets: number;
  warmUpExercises: number;
  /** Ramp-up sets of the main movement (before its work sets), when prescribed. */
  rampUp: RangeView | null;
}

export function strengthSummary(p: FinalPrescriptionV2View): StrengthSummary | null {
  if (p.family !== "strength") return null;
  const workExercises = p.blocks
    .filter((b) => (WORK_BLOCK_ROLES as readonly string[]).includes(b.role))
    .flatMap((b) => b.items)
    .filter((i): i is ExerciseItemView => i.kind === "exercise");
  const warmUpExercises = p.blocks.filter((b) => b.role === "warm_up").flatMap((b) => b.items).length;
  const rampUp = workExercises.find((i) => i.rampUp)?.rampUp?.sets ?? null;
  return { workExercises, workSets: workExercises.reduce((n, i) => n + i.sets, 0), warmUpExercises, rampUp };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** "4 exercices de travail · 12 séries de travail" — never a bare "12 séries". */
export function strengthSummaryLine(s: StrengthSummary): string {
  return `${plural(s.workExercises.length, "exercice de travail", "exercices de travail")} · ${plural(s.workSets, "série de travail", "séries de travail")}`;
}

/** "Non comptés : échauffement (3 exercices), montée en charge (1–2 séries)." — null when there is neither. */
export function strengthExtrasLine(s: StrengthSummary): string | null {
  const parts = [
    s.warmUpExercises > 0 ? `échauffement (${plural(s.warmUpExercises, "exercice", "exercices")})` : null,
    s.rampUp ? `montée en charge (${span(s.rampUp)} ${s.rampUp.max > 1 ? "séries" : "série"})` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? `Non comptés : ${parts.join(", ")}.` : null;
}

/** Work exercise roles, in the rider's words (the role of an exercise in the session, shown with its name). */
export const WORK_ROLE_LABELS: Readonly<Record<string, string>> = {
  principal: "Principal",
  secondary: "Secondaire",
  unilateral: "Unilatéral",
  prevention: "Prévention",
};
