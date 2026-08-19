import { CONFIDENCE_LABELS, DECISION_LABELS, TRAINING_MODE_LABELS } from "./dailyPlanLabels";
import type { DailyPlan } from "./dailyPlanTypes";

// The one thing that must be understood in a few seconds: what to do
// today, how confident the coach is, and why — nothing else competes for
// attention at the top of the screen.
export function DecisionHero({ dailyPlan }: { dailyPlan: DailyPlan }) {
  const decisionLabel = DECISION_LABELS[dailyPlan.decision] ?? dailyPlan.decision;
  const confidenceLabel = CONFIDENCE_LABELS[dailyPlan.confidence] ?? dailyPlan.confidence;
  const modeLabel = TRAINING_MODE_LABELS[dailyPlan.active_mode] ?? dailyPlan.active_mode;

  return (
    <div className="rounded-xl bg-gray-900 p-4 text-white">
      <p className="text-2xl font-bold">{decisionLabel}</p>
      <p className="mt-1 text-sm text-gray-300">
        Confiance {confidenceLabel.toLowerCase()} · {modeLabel}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-gray-100">{dailyPlan.reasoning}</p>
    </div>
  );
}
