import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoachStateCard } from "./CoachStateCard";
import { coachWhy, retainedSignals } from "./coachInsights";
import { KEEP_PLAN } from "../history/historyFixtures";
import type { DailyPlan } from "./dailyPlanTypes";

// P0 adapted-session coherence — never « no adaptation » once the effective session differs from the plan.

const TIME_SENTENCE = "Tu as 30 min aujourd'hui : la séance prévue ne tient pas dans ce temps, récupération active à la place.";
const timeRule = { layer: "ARBITRATION", rule_id: "V2_TODAY_TIME_CONSTRAINT", detail: TIME_SENTENCE, signals_used: ["available_minutes_today"] };

function plan(over: Partial<DailyPlan>): DailyPlan {
  return { ...KEEP_PLAN, ...over } as DailyPlan;
}

describe("P0 — the coach's explanation follows the effective result", () => {
  it("A10 adapted the session: « Temps disponible limité » is retained, the « why » is the validated time sentence", () => {
    const p = plan({
      decision: "REPLACE",
      planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 },
      final_session: { kind: "RECOVERY_ACTIVE" },
      decision_reasoning: [timeRule as DailyPlan["triggered_rules"][number]],
      triggered_rules: [timeRule as DailyPlan["triggered_rules"][number]],
      reasoning: TIME_SENTENCE,
    });
    expect(retainedSignals(p).map((s) => s.label)).toEqual(["Temps disponible limité"]);
    expect(coachWhy(p)).toBe(TIME_SENTENCE);
    render(<CoachStateCard dailyPlan={p} hasHealthSignal={false} checkin={null} />);
    expect(screen.getByText("Temps disponible limité")).toBeInTheDocument();
    expect(screen.queryByText(/Aucun signal de ton check-in n'a demandé d'adapter/)).toBeNull();
  });

  it("an adaptation without a check-in signal (context): « adaptée / remplacée », never « aucune adaptation »", () => {
    for (const [decision, text] of [
      ["MODIFY", "Ta séance a été ajustée au contexte du jour."],
      ["REPLACE", "Ta séance a été remplacée selon le contexte du jour."],
      ["REST", "Le contexte du jour demande du repos."],
    ] as const) {
      const { unmount } = render(<CoachStateCard dailyPlan={plan({ decision, decision_reasoning: [], triggered_rules: [] })} hasHealthSignal={false} checkin={null} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.queryByText(/Aucun signal de ton check-in n'a demandé d'adapter/)).toBeNull();
      unmount();
    }
  });

  it("KEEP without a signal: the neutral message is unchanged", () => {
    render(<CoachStateCard dailyPlan={plan({ decision: "KEEP", decision_reasoning: [], triggered_rules: [] })} hasHealthSignal={false} checkin={null} />);
    expect(screen.getByText("Aucun signal de ton check-in n'a demandé d'adapter ta séance.")).toBeInTheDocument();
  });

  it("a time constraint that only « fits » (KEEP) is not retained as a signal (it lives in triggered_rules only)", () => {
    const fits = { ...timeRule, detail: "Temps disponible : 120 min. Avant : KEEP DH_TECHNICAL MODERATE 90 min. Action : fits." };
    const p = plan({ decision: "KEEP", decision_reasoning: [], triggered_rules: [fits as DailyPlan["triggered_rules"][number]] });
    expect(retainedSignals(p)).toEqual([]);
  });
});
