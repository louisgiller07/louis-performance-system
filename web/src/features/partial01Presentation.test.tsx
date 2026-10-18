// PARTIAL-01 (HPM 2026-10-18) — a session partly done never reads as fully done. A COMPLETED guided session carries
// its realisation (« complete » / « partial », from its own frozen prescription and its active results — the rules the
// session itself used to ask for a confirmation), a V1 debrief its completion_status; every screen that shows the day
// says it: Today's week and entry card, Programme's week and session card, History. A stopped attempt reads « Arrêtée »,
// a session not started is never done; a realisation that could not be read stays neutral (« Terminée »).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WeekDaysPicker } from "../components/WeekDaysPicker";
import { weekSummary, type WeekDay } from "./today/todayContext";
import { programWeekDays } from "./program/programPresentation";
import { ProgramSessionCard } from "./program/ProgramSessionCard";
import { plan as programPlan, session } from "./program/programFixtures";
import { buildHistoryDays } from "./history/historyDays";
import { HistoryDayCard } from "./history/HistoryDayCard";
import { KEEP_PLAN } from "./history/historyFixtures";
import { DaySessionEntryCard } from "./guidedSession/DaySessionEntryCard";
import { effectiveDay, type EffectiveDay, type EffectiveExecution, type EffectiveSources } from "./effectiveSession/effectiveDay";
import type { DailyPlan, TrainingIntervention } from "./dailyPlan/dailyPlanTypes";
import type { DecisionHistoryRow } from "./history/historyTypes";
import type { CompletedSessionRecord } from "./completedSession/completedSessionTypes";

const TODAY = "2026-10-25"; // Sunday — the whole week is in the past
const MONDAY = "2026-10-19";
const FORCE_60: TrainingIntervention = { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 };

function dailyPlan(date: string): DailyPlan {
  return { ...KEEP_PLAN, date, decision: "KEEP", final_session: FORCE_60, planned_session_before: FORCE_60, training: { ...KEEP_PLAN.training, session_type: FORCE_60, duration_min: 60 } } as DailyPlan;
}
const row = (id: string, date: string): DecisionHistoryRow => ({ id, decisionDate: date, createdAt: `${date}T08:00:00Z`, finalSessionDb: "STRENGTH_A", activeModeDb: null, confidenceLevelDb: null, dailyPlan: dailyPlan(date) });
const exec = (id: string, date: string, events: string[], realisation?: "complete" | "partial"): EffectiveExecution =>
  ({ executionId: id, sessionDate: date, decisionId: `d-${date}`, finalPrescriptionId: `fp-${id}`, startedAt: `${date}T17:00:00Z`, events, ...(realisation ? { realisation } : {}) }) as EffectiveExecution;
const legacy = (date: string, completion_status: string) => ({ session_date: date, completion_status, actual_duration_min: 45 }) as unknown as CompletedSessionRecord;
const day = (date: string, s: Partial<EffectiveSources>): EffectiveDay =>
  effectiveDay(date, { decisions: [row(`d-${date}`, date)], executions: [], legacy: [], planned: [{ date, session: FORCE_60 }], ...s });

// One week, one case per day.
const WEEK: EffectiveDay[] = [
  day("2026-10-19", { executions: [exec("e19", "2026-10-19", ["started", "completed"], "complete")] }),
  day("2026-10-20", { executions: [exec("e20", "2026-10-20", ["started", "completed"], "partial")] }),
  day("2026-10-21", { executions: [exec("e21", "2026-10-21", ["started", "completed"])] }), // realisation unreadable
  day("2026-10-22", { executions: [exec("e22", "2026-10-22", ["started", "abandoned"])] }),
  day("2026-10-23", {}), // not started
  day("2026-10-24", { legacy: [legacy("2026-10-24", "partial")] }),
  day("2026-10-25", { legacy: [legacy("2026-10-25", "done")] }),
];
const EXPECTED = ["Réalisée", "Partiellement réalisée", "Terminée", "Arrêtée", "Prévue, non enregistrée", "Partiellement réalisée", "Réalisée"];

function statusOf(days: WeekDay[], index: number): string {
  const { unmount } = render(<WeekDaysPicker days={days} initialIndex={index} />);
  const text = screen.getByText((_, el) => el?.tagName === "P" && el.className.includes("text-ink/75")).textContent ?? "";
  unmount();
  return text.split(" · ").at(-1)!;
}

describe("PARTIAL-01 — a partly done session never reads as fully done", () => {
  it("Today's week: complete, partial, unreadable, stopped, not started, V1 partial, V1 done", () => {
    const days = weekSummary(TODAY, [], [], [], [], WEEK).days;
    expect(days.map((_, i) => statusOf(days, i))).toEqual(EXPECTED);
    expect(days.filter((d) => d.performed).length).toBe(5); // a stopped attempt and a session not started are never done
  });

  it("Programme's week tells the same", () => {
    const review = programPlan(WEEK.map((d) => session(d.date, { kind: "STRENGTH_LOWER", durationMin: 60 })));
    const days = programWeekDays(MONDAY, TODAY, review, [], [], [], new Map(WEEK.map((d) => [d.date, d] as const)));
    expect(days.map((_, i) => statusOf(days, i))).toEqual(EXPECTED);
  });

  it("Programme's session card: a guided session completed in part says so, a full one stays « Réalisée »", () => {
    const card = (effective: EffectiveDay) =>
      render(
        <MemoryRouter>
          <ProgramSessionCard session={session(effective.date, { kind: "STRENGTH_LOWER", durationMin: 60 })} today={TODAY} variant="past" effective={effective} />
        </MemoryRouter>
      );
    const partial = card(WEEK[1]!);
    expect(document.body.textContent).toContain("Partiellement réalisée");
    partial.unmount();
    card(WEEK[0]!);
    expect(document.body.textContent).toContain("Réalisée");
    expect(document.body.textContent).not.toContain("Partiellement");
  });

  it("History: a guided session completed in part is « partiellement réalisée », a full one « terminée »", () => {
    const history = (date: string, execution: EffectiveExecution) => {
      const [historyDay] = buildHistoryDays([row(`d-${date}`, date)], [], [], [], [{ executionId: execution.executionId, sessionDate: date, decisionId: `d-${date}`, finalPrescriptionId: execution.finalPrescriptionId }], [execution]);
      return render(
        <MemoryRouter>
          <HistoryDayCard day={historyDay!} today={TODAY} />
        </MemoryRouter>
      );
    };
    const partial = history("2026-10-20", exec("e20", "2026-10-20", ["started", "completed"], "partial"));
    expect(document.body.textContent).toMatch(/◐ Séance guidée partiellement réalisée/);
    expect(document.body.textContent).not.toMatch(/✓ Séance guidée terminée/);
    partial.unmount();
    history("2026-10-19", exec("e19", "2026-10-19", ["started", "completed"], "complete"));
    expect(document.body.textContent).toMatch(/✓ Séance guidée terminée/);
  });

  it("Today's entry card: a guided session completed in part says so", () => {
    const { rerender } = render(
      <MemoryRouter>
        <DaySessionEntryCard kind="completed" realisation="partial" />
      </MemoryRouter>
    );
    expect(screen.getByTestId("guided-session-done")).toHaveTextContent("Partiellement réalisée");
    rerender(
      <MemoryRouter>
        <DaySessionEntryCard kind="completed" realisation="complete" />
      </MemoryRouter>
    );
    expect(screen.getByTestId("guided-session-done")).not.toHaveTextContent("Partiellement");
  });
});
