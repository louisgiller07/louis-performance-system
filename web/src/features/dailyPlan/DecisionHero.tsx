import { CONFIDENCE_LABELS, DECISION_LABELS, TRAINING_MODE_LABELS } from "./dailyPlanLabels";
import { athleteSafeReasoning } from "./safetyPresentation";
import type { DailyPlan } from "./dailyPlanTypes";

// V0.3 UX PREMIUM REDESIGN — presentation-only accent per decision. REST
// is SAFETY-driven (rules/safety.ts A1-A4) and deliberately stays on the
// existing red safety language, never gold — gold (and, for MODIFY, a
// light gold/amber blend) is reserved for the three non-safety arbitration
// outcomes (KEEP/MODIFY/REPLACE). This never changes which decision is
// computed, only its accent color/border.
const DECISION_ACCENT: Record<string, { border: string; text: string; ring: string; tagline?: string }> = {
  KEEP: {
    border: "border-gold/40",
    text: "text-gold",
    ring: "shadow-[0_0_0_1px_rgba(212,175,55,0.25)]",
    tagline: "Ready to perform",
  },
  MODIFY: {
    border: "border-amber-400/50",
    text: "text-amber-300",
    ring: "shadow-[0_0_0_1px_rgba(245,158,11,0.25)]",
    tagline: "Adjusted — ready to perform",
  },
  REPLACE: {
    border: "border-gold-light",
    text: "text-gold-light",
    ring: "shadow-[0_0_10px_1px_rgba(245,215,110,0.25)]",
    tagline: "New plan — ready to perform",
  },
  REST: { border: "border-red-500/50", text: "text-red-400", ring: "shadow-[0_0_0_1px_rgba(248,113,113,0.25)]" },
};

// The one thing that must be understood in a few seconds: what to do
// today, how confident the coach is, and why — nothing else competes for
// attention at the top of the screen. V0.3 UX PREMIUM — the visually
// dominant, emotional-center element on TodayPage (larger type, gold/
// safety-red accent per decision, standalone confidence line, a closing
// "ready to perform" tagline for non-REST decisions). Still exactly the
// same four underlying DailyPlan fields (decision, confidence, active_mode,
// reasoning) — no new data, presentation only.
export function DecisionHero({ dailyPlan }: { dailyPlan: DailyPlan }) {
  const decisionLabel = DECISION_LABELS[dailyPlan.decision] ?? dailyPlan.decision;
  const confidenceLabel = CONFIDENCE_LABELS[dailyPlan.confidence] ?? dailyPlan.confidence;
  const modeLabel = TRAINING_MODE_LABELS[dailyPlan.active_mode] ?? dailyPlan.active_mode;
  // V0.3_006A1 — the always-visible hero reasoning must never leak internal
  // Safety provenance (e.g. the raw HealthFlagType slug inside A5's
  // triggered_rule.detail); see safetyPresentation.ts.
  const reasoning = athleteSafeReasoning(dailyPlan);
  const accent = DECISION_ACCENT[dailyPlan.decision] ?? DECISION_ACCENT.KEEP;

  return (
    <div className={`rounded-xl border bg-card p-5 ${accent.border} ${accent.ring}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Head Coach Decision</p>
        <p className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">{modeLabel}</p>
      </div>
      <p className={`mt-2 text-3xl font-bold uppercase tracking-tight ${accent.text}`}>{decisionLabel}</p>
      <p className="mt-1.5 text-sm text-muted">Confidence {confidenceLabel.toLowerCase()}</p>
      <p className="mt-4 text-sm leading-relaxed text-ink/90">{reasoning}</p>
      {accent.tagline && (
        <p className={`mt-4 text-xs font-semibold uppercase tracking-wide ${accent.text}`}>✓ {accent.tagline}</p>
      )}
    </div>
  );
}
