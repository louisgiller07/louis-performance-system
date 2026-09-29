import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TodayGreeting } from "./TodayGreeting";
import { NextStepCard } from "./NextStepCard";
import { WeekStrip } from "./WeekStrip";
import { CoachStateCard } from "../dailyPlan/CoachStateCard";
import { weekSummary, type RaceHorizon } from "./todayContext";
import type { PlannedSessionRow } from "../planning/planningTypes";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import type { CheckinRow } from "../checkin/checkinTypes";

const RACE = { eventName: "iXS Lenzerheide", startDate: "2026-10-11", endDate: "2026-10-12", priority: "A" as const };

describe("TodayGreeting (UX-04)", () => {
  it("Bonjour + first name, the date, and J-XX before the next race under 120 days", () => {
    render(<TodayGreeting firstName="Louis" friendlyDate="Mardi 29 septembre" canonicalDate="2026-09-29" horizon={{ kind: "countdown", race: RACE, days: 12 }} objective="Performance en course" />);
    expect(screen.getByRole("heading", { name: "Bonjour Louis" })).toBeInTheDocument();
    expect(screen.getByText("Mardi 29 septembre")).toBeInTheDocument();
    expect(screen.getByText("J-12")).toBeInTheDocument();
    expect(screen.getByText("iXS Lenzerheide")).toBeInTheDocument();
    // The race takes precedence over the objective.
    expect(screen.queryByText("Performance en course")).not.toBeInTheDocument();
  });

  it("120–365 days: 'Prochain objectif'; no race: the current objective; no name: the brand", () => {
    const { rerender } = render(<TodayGreeting firstName={null} friendlyDate="Mardi 29 septembre" canonicalDate="2026-09-29" horizon={{ kind: "horizon", race: RACE, days: 200 }} objective={null} />);
    expect(screen.getByRole("heading", { name: "NALYNT" })).toBeInTheDocument();
    expect(screen.getByText("Prochain objectif")).toBeInTheDocument();

    rerender(<TodayGreeting firstName="Louis" friendlyDate="Mardi 29 septembre" canonicalDate="2026-09-29" horizon={null} objective="Podium aux nationaux" />);
    expect(screen.getByText("Objectif actuel")).toBeInTheDocument();
    expect(screen.getByText("Podium aux nationaux")).toBeInTheDocument();

    rerender(<TodayGreeting firstName="Louis" friendlyDate="Mardi 29 septembre" canonicalDate="2026-09-29" horizon={null} objective={null} />);
    expect(screen.queryByText("Objectif actuel")).not.toBeInTheDocument();
  });
});

const row = (planned_date: string, kind: string, duration_min: number) =>
  ({ planned_date, session_type: "STRENGTH", intervention: { kind, load_profile: "MODERATE", duration_min }, planned_intent: null, is_committed: false, source: "generated" }) as unknown as PlannedSessionRow;

describe("NextStepCard (UX-04)", () => {
  it("the next planned session, the race it builds towards, and the brand promise", () => {
    render(
      <MemoryRouter>
        <NextStepCard next={row("2026-09-30", "STRENGTH_LOWER", 60)} today="2026-09-29" horizon={{ kind: "countdown", race: RACE, days: 12 }} objective={null} />
      </MemoryRouter>
    );
    const card = screen.getByRole("region", { name: "Prochaine étape" });
    expect(within(card).getByText("Demain")).toBeInTheDocument();
    expect(within(card).getByText("Renfo bas du corps")).toBeInTheDocument();
    expect(card).toHaveTextContent("1 h · charge modérée");
    expect(card).toHaveTextContent("Cap sur iXS Lenzerheide, dans 12 jours.");
    expect(card).toHaveTextContent("Ton objectif reste. Ton plan s'adapte.");
    expect(within(card).getByRole("link", { name: "Programme →" })).toHaveAttribute("href", "/training-plan");
  });

  it("no upcoming session: says so honestly, still tied to the objective", () => {
    render(
      <MemoryRouter>
        <NextStepCard next={null} today="2026-09-29" horizon={null} objective="Régularité" />
      </MemoryRouter>
    );
    const card = screen.getByRole("region", { name: "Prochaine étape" });
    expect(card).toHaveTextContent("Aucune séance prévue dans les deux prochaines semaines.");
    expect(card).toHaveTextContent("Cap sur ton objectif : Régularité.");
  });
});

describe("WeekStrip (UX-04)", () => {
  it("Monday → Sunday with planned / performed counts and the objective context", () => {
    const week = weekSummary("2026-09-29", [row("2026-09-28", "DH_TECHNICAL", 90), row("2026-10-01", "STRENGTH_LOWER", 60)], [{ session_date: "2026-09-28", completion_status: "done" } as never], []);
    render(
      <MemoryRouter>
        <WeekStrip week={week} horizon={null} objective="Performance en course" />
      </MemoryRouter>
    );
    const card = screen.getByRole("region", { name: "Cette semaine" });
    expect(card).toHaveTextContent("2 séances prévues · 1 réalisée");
    expect(card).toHaveTextContent("Objectif · Performance en course");
    expect(within(card).getAllByRole("listitem")).toHaveLength(7);
    expect(within(card).getAllByRole("listitem")[0]).toHaveAccessibleName(/2026-09-28 : DH, réalisée/);
  });
});

const PLAN: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: true },
  dh_or_technical: { active: true },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "x",
  confidence: "HIGH",
  triggered_rules: [],
  decision_reasoning: [{ layer: "C", rule_id: "C3.1", detail: "d", signals_used: ["leg_fatigue_high"] }],
  planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
  final_session: { kind: "DH_TECHNICAL", load_profile: "LIGHT" },
  decision: "MODIFY",
  overrode_race_protocol: false,
  engine_version: "1",
};
const CHECKIN = { sleep_hours: 7, sleep_quality: 8, energy: 6, leg_fatigue: 7, grip_fatigue: 3 } as CheckinRow;

describe("CoachStateCard (UX-04)", () => {
  it("what the coach retained (engine signals only), then the athlete's own declared state — the matching value accented", () => {
    render(<CoachStateCard dailyPlan={PLAN} hasHealthSignal={false} checkin={CHECKIN} />);
    const card = screen.getByRole("region", { name: "Ce que ton coach a retenu" });
    expect(within(card).getByText("Fatigue jambes élevée")).toBeInTheDocument();
    expect(within(card).getByText("Ton état du jour")).toBeInTheDocument();
    expect(card).toHaveTextContent("7 h");
    expect(card).toHaveTextContent("qualité 8/10");
    const legs = within(card).getByText("Fatigue jambes").closest("div")!;
    expect(legs.className).toContain("border-gold");
    const energy = within(card).getByText("Énergie").closest("div")!;
    expect(energy.className).not.toContain("border-gold");
    expect(card.textContent).not.toMatch(/leg_fatigue_high|bon|bonne/i);
  });

  it("no retained signal: says so factually; no check-in values: no state tiles", () => {
    render(<CoachStateCard dailyPlan={{ ...PLAN, decision: "KEEP", decision_reasoning: [] }} hasHealthSignal={false} checkin={null} />);
    expect(screen.getByText("Aucun signal de ton check-in n'a demandé d'adapter ta séance.")).toBeInTheDocument();
    expect(screen.queryByText("Ton état du jour")).not.toBeInTheDocument();
  });

  it("keeps the ReadinessCard safety semantics: server health signal in red, sanitized attention note", () => {
    render(
      <CoachStateCard
        dailyPlan={{ ...PLAN, monitoring: { observe: ["Surveiller la douleur (knee_R, intensité 4/10)"] } }}
        hasHealthSignal
        checkin={CHECKIN}
      />
    );
    expect(screen.getByText("Signal actif").className).toContain("text-red-400");
    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.queryByText(/knee_R/)).not.toBeInTheDocument();
  });
});

describe("race horizon types", () => {
  it("ongoing race line", () => {
    const horizon: RaceHorizon = { kind: "ongoing", race: RACE, day: 2 };
    render(<TodayGreeting firstName="Louis" friendlyDate="Dimanche 11 octobre" canonicalDate="2026-10-11" horizon={horizon} objective={null} />);
    expect(screen.getByText("Course en cours · jour 2")).toBeInTheDocument();
  });
});
