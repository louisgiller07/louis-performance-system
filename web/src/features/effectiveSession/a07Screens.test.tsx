import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProgramSessionCard } from "../program/ProgramSessionCard";
import { programWeekDays } from "../program/programPresentation";
import { session, TODAY, plan as programPlan } from "../program/programFixtures";
import { weekSummary } from "../today/todayContext";
import { buildHistoryDays } from "../history/historyDays";
import { HistoryDayCard } from "../history/HistoryDayCard";
import { KEEP_PLAN } from "../history/historyFixtures";
import { executedSessionLabel } from "../afterSession/AfterSessionEntry";
import { sessionTitle } from "../program/programPresentation";
import { effectiveDay, type EffectiveDay, type EffectiveExecution, type EffectiveSources } from "./effectiveDay";
import type { DailyPlan, TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import type { DecisionHistoryRow } from "../history/historyTypes";
import type { PlannedSessionRow } from "../planning/planningTypes";

// A07 — every screen tells the day from the same effective session.

const DH_90: TrainingIntervention = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 };
const UPPER_45: TrainingIntervention = { kind: "STRENGTH_UPPER", load_profile: "LIGHT", duration_min: 45 };
const FORCE_60: TrainingIntervention = { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 };
const FORCE_LIGHT_45: TrainingIntervention = { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 };

function dailyPlan(date: string, decision: DailyPlan["decision"], final: TrainingIntervention, planned: TrainingIntervention | null): DailyPlan {
  return { ...KEEP_PLAN, date, decision, final_session: final, planned_session_before: planned, training: { ...KEEP_PLAN.training, session_type: final, ...(final.duration_min !== undefined ? { duration_min: final.duration_min } : {}) } };
}
function row(id: string, date: string, createdAt: string, p: DailyPlan): DecisionHistoryRow {
  return { id, decisionDate: date, createdAt, finalSessionDb: "STRENGTH_A", activeModeDb: null, confidenceLevelDb: null, dailyPlan: p };
}
function exec(id: string, date: string, decisionId: string, events: string[]): EffectiveExecution {
  return { executionId: id, sessionDate: date, decisionId, finalPrescriptionId: `fp-${id}`, startedAt: `${date}T17:00:00Z`, events };
}
const day = (date: string, s: Partial<EffectiveSources>): EffectiveDay => effectiveDay(date, { decisions: [], executions: [], legacy: [], planned: [], ...s });

describe("A07 — Programme shows the effective session first", () => {
  it("E — REPLACE DH → Force today: the card is the Force (title, 45 min · Légère), the DH only as « initialement prévue »", () => {
    const effective = day(TODAY, { decisions: [row("d1", TODAY, "t1", dailyPlan(TODAY, "REPLACE", UPPER_45, DH_90))], planned: [{ date: TODAY, session: DH_90 }] });
    render(
      <MemoryRouter>
        <ProgramSessionCard session={session(TODAY)} today={TODAY} variant="today" effective={effective} adaptation={{ planned: DH_90, adapted: UPPER_45, why: "x" }} />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(sessionTitle({ kind: "STRENGTH_UPPER" }));
    expect(screen.getByRole("heading", { level: 2 })).not.toHaveTextContent(sessionTitle({ kind: "DH_TECHNICAL" }));
    expect(screen.getByText(/45\smin · charge légère/)).toBeInTheDocument();
    expect(screen.getByText("Voir la séance initialement prévue")).toBeInTheDocument();
  });

  it("C — MODIFY Force 60 → 45: 45 min, never the planned 60", () => {
    const date = "2026-10-20";
    const effective = day(date, { decisions: [row("d1", date, "t1", dailyPlan(date, "MODIFY", FORCE_LIGHT_45, FORCE_60))] });
    render(
      <MemoryRouter>
        <ProgramSessionCard session={session(date, { kind: "STRENGTH_LOWER", durationMin: 60 })} today={TODAY} variant="past" effective={effective} />
      </MemoryRouter>
    );
    expect(document.body.textContent).toMatch(/45\smin/);
    expect(document.body.textContent).not.toMatch(/1\sh/);
  });

  it("G — a past REST day reads « Repos décidé », never « Non enregistrée »", () => {
    const date = "2026-10-20";
    const effective = day(date, { decisions: [row("d1", date, "t1", dailyPlan(date, "REST", { kind: "REST" }, DH_90))] });
    render(
      <MemoryRouter>
        <ProgramSessionCard session={session(date)} today={TODAY} variant="past" effective={effective} />
      </MemoryRouter>
    );
    expect(screen.getByText("Repos décidé")).toBeInTheDocument();
    expect(screen.queryByText("Non enregistrée")).toBeNull();
  });

  it("the plan week shows the effective session of decided days (REPLACE, REST) and counts the completed one", () => {
    const review = programPlan([session("2026-10-20"), session("2026-10-21")]);
    const effectiveByDate = new Map([
      ["2026-10-20", day("2026-10-20", { decisions: [row("d1", "2026-10-20", "t1", dailyPlan("2026-10-20", "REPLACE", UPPER_45, DH_90))], executions: [exec("e1", "2026-10-20", "d1", ["started", "completed"])] })],
      ["2026-10-21", day("2026-10-21", { decisions: [row("d2", "2026-10-21", "t1", dailyPlan("2026-10-21", "REST", { kind: "REST" }, DH_90))] })],
    ]);
    const days = programWeekDays("2026-10-19", TODAY, review, [], [], [], effectiveByDate);
    expect(days.find((d) => d.date === "2026-10-20")).toMatchObject({ plannedLabel: sessionTitle({ kind: "STRENGTH_UPPER" }), plannedDurationMin: 45, performed: true, adapted: true });
    expect(days.find((d) => d.date === "2026-10-21")).toMatchObject({ plannedLabel: sessionTitle({ kind: "REST" }), performed: false, adapted: true });
  });
});

describe("A07 — Today's week: effective labels, one counting rule", () => {
  it("REPLACE counts once as its replacement, REST is neither planned nor missed, a planned future day still counts", () => {
    const planned = (date: string, intervention: TrainingIntervention): PlannedSessionRow => ({ planned_date: date, intervention, session_type: "STRENGTH_A" }) as unknown as PlannedSessionRow;
    const rows = [planned("2026-10-19", DH_90), planned("2026-10-20", FORCE_60), planned("2026-10-23", DH_90)];
    const effective = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map((date) =>
      day(date, {
        planned: rows.map((r) => ({ date: r.planned_date, session: r.intervention! })),
        decisions: [row("d19", "2026-10-19", "t1", dailyPlan("2026-10-19", "REPLACE", UPPER_45, DH_90)), row("d20", "2026-10-20", "t1", dailyPlan("2026-10-20", "REST", { kind: "REST" }, FORCE_60))],
        executions: [exec("e19", "2026-10-19", "d19", ["started", "completed"])],
      })
    );
    const week = weekSummary(TODAY, rows, [], [], [], effective);
    expect(week.days.find((d) => d.date === "2026-10-19")).toMatchObject({ planned: "Force", performed: true, adapted: true });
    expect(week.days.find((d) => d.date === "2026-10-20")).toMatchObject({ planned: "Repos", performed: false, adapted: true });
    expect([week.plannedCount, week.performedCount]).toEqual([2, 1]);
  });
});

describe("A07 — History tells the executed session", () => {
  it("I / K — a completed execution under d1 stays the day's story after a newer decision d2; the line names the executed Force", () => {
    const date = "2026-09-28";
    const d1 = row("d1", date, "2026-09-28T08:00:00Z", dailyPlan(date, "REPLACE", UPPER_45, DH_90));
    const d2 = row("d2", date, "2026-09-28T20:00:00Z", dailyPlan(date, "KEEP", DH_90, DH_90));
    const executions = [exec("e1", date, "d1", ["started", "completed"])];
    const [historyDay] = buildHistoryDays([d1, d2], [], [], [], [{ executionId: "e1", sessionDate: date, decisionId: "d1", finalPrescriptionId: "fp-e1" }], executions);
    expect(historyDay!.main.id).toBe("d1");
    expect(historyDay!.effective).toMatchObject({ session: UPPER_45, status: "completed" });
    render(
      <MemoryRouter>
        <HistoryDayCard day={historyDay!} today="2026-09-29" />
      </MemoryRouter>
    );
    expect(document.body.textContent).toMatch(/✓ Séance guidée terminée — Renfo haut du corps · 45\smin/);
    expect(document.body.textContent).not.toMatch(/✓ Séance guidée terminée — DH/);
  });

  it("J — an abandoned-only day reads « Séance guidée arrêtée », not a missed session", () => {
    const date = "2026-09-28";
    const d1 = row("d1", date, "t1", dailyPlan(date, "KEEP", FORCE_60, FORCE_60));
    const [historyDay] = buildHistoryDays([d1], [], [], [], [], [exec("e1", date, "d1", ["started", "abandoned"])]);
    render(
      <MemoryRouter>
        <HistoryDayCard day={historyDay!} today="2026-09-29" />
      </MemoryRouter>
    );
    expect(document.body.textContent).toContain("Séance guidée arrêtée");
    expect(document.body.textContent).not.toContain("Séance non enregistrée");
  });
});

describe("A07 — the after-session block names the executed session", () => {
  it("a REPLACE DH → Force executed: the block talks about the Force, never the planned DH", () => {
    const date = "2026-09-28";
    const effective = day(date, { decisions: [row("d1", date, "t1", dailyPlan(date, "REPLACE", UPPER_45, DH_90))], executions: [exec("e1", date, "d1", ["started", "completed"])], planned: [{ date, session: DH_90 }] });
    const label = executedSessionLabel(effective)!;
    expect(label).toMatch(/45\smin/);
    expect(label).not.toMatch(/DH/);
    expect(executedSessionLabel(day(date, { planned: [{ date, session: DH_90 }] }))).toBeNull();
  });
});
