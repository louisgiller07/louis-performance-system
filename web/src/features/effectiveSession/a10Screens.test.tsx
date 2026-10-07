import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProgramSessionCard } from "../program/ProgramSessionCard";
import { session, TODAY } from "../program/programFixtures";
import { coachWhy } from "../dailyPlan/coachInsights";
import { buildHistoryDays } from "../history/historyDays";
import { HistoryDayCard } from "../history/HistoryDayCard";
import { KEEP_PLAN } from "../history/historyFixtures";
import { executedSessionLabel } from "../afterSession/AfterSessionEntry";
import { effectiveDay, type EffectiveSources } from "./effectiveDay";
import type { DailyPlan, TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import type { DecisionHistoryRow } from "../history/historyTypes";

// A10 — a session fitted into the rider's time is THE effective session (A07): 45 min everywhere.

const FORCE_60: TrainingIntervention = { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 };
const FORCE_LIGHT_45: TrainingIntervention = { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 };
const SENTENCE = "Tu as 45 min aujourd'hui : la séance a été allégée pour tenir dans ce temps.";
const TIME_RULE = { layer: "ARBITRATION", rule_id: "V2_TODAY_TIME_CONSTRAINT", detail: SENTENCE, signals_used: ["available_minutes_today"] };

function timed(date: string): DailyPlan {
  return {
    ...KEEP_PLAN,
    date,
    decision: "MODIFY",
    planned_session_before: FORCE_60,
    final_session: FORCE_LIGHT_45,
    training: { ...KEEP_PLAN.training, session_type: FORCE_LIGHT_45, duration_min: 45, objective: SENTENCE },
    reasoning: SENTENCE,
    decision_reasoning: [TIME_RULE],
    triggered_rules: [{ ...TIME_RULE, detail: "Temps disponible : 45 min. Avant : KEEP STRENGTH_LOWER MODERATE 60 min. Action : adapted → MODIFY STRENGTH_LOWER LIGHT 45 min." }],
  } as DailyPlan;
}
const row = (date: string): DecisionHistoryRow => ({ id: "d1", decisionDate: date, createdAt: "t1", finalSessionDb: "STRENGTH_A", activeModeDb: null, confidenceLevelDb: null, dailyPlan: timed(date) });
const day = (date: string, s: Partial<EffectiveSources>) => effectiveDay(date, { decisions: [], executions: [], legacy: [], planned: [{ date, session: FORCE_60 }], ...s });

describe("A10 — Force 60 → time 45 → Force LIGHT 45, on every screen", () => {
  it("Today: the coach's « why » is the plain time sentence (no engine jargon)", () => {
    expect(coachWhy(timed(TODAY))).toBe(SENTENCE);
  });

  it("Programme: 45 min · charge légère, never the planned 60", () => {
    render(
      <MemoryRouter>
        <ProgramSessionCard session={session(TODAY, { kind: "STRENGTH_LOWER", durationMin: 60 })} today={TODAY} variant="today" effective={day(TODAY, { decisions: [row(TODAY)] })} />
      </MemoryRouter>
    );
    expect(screen.getByText(/45\smin · charge légère/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/1\sh\b/);
  });

  it("History and AfterSession: the executed session is the 45-min one", () => {
    const date = "2026-09-28";
    const executions = [{ executionId: "e1", sessionDate: date, decisionId: "d1", finalPrescriptionId: "fp-1", startedAt: `${date}T17:00:00Z`, events: ["started", "completed"] }];
    const [historyDay] = buildHistoryDays([row(date)], [], [], [], [{ executionId: "e1", sessionDate: date, decisionId: "d1", finalPrescriptionId: "fp-1" }], executions);
    render(
      <MemoryRouter>
        <HistoryDayCard day={historyDay!} today="2026-09-29" />
      </MemoryRouter>
    );
    expect(document.body.textContent).toMatch(/✓ Séance guidée terminée — Renfo bas du corps · 45\smin/);
    expect(executedSessionLabel(day(date, { decisions: [row(date)], executions }))).toMatch(/45\smin/);
  });
});
