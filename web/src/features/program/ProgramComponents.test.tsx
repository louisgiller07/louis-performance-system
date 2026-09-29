import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { ProgramHero } from "./ProgramHero";
import { ProgramSessions } from "./ProgramSessions";
import { ProgramWeekTimeline } from "./ProgramWeekTimeline";
import { completed, DECISION, drill, plan, session, TODAY } from "./programFixtures";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";

const RACE = { eventName: "iXS Lenzerheide", startDate: "2026-11-03", endDate: "2026-11-04", priority: "A" as const, location: null, raceFormat: null };

function renderIn(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// Everything the athlete reads must be French rider wording: no enum, no id.
function expectNoInternals(container: HTMLElement) {
  const text = container.textContent ?? "";
  expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]|[a-z]+_[a-z]+|version-1|s-2026|undefined|null|NaN/);
  expect(text).not.toMatch(/\b(Week|Session|Planned|Taper|Development|Rest)\b/);
}

describe("ProgramHero", () => {
  it("without a race: 'Ton plan actuel', the declared objective, the week position and phase, the promise", () => {
    const { container } = renderIn(<ProgramHero review={plan([])} horizon={null} objective="Top 10 aux Championnats suisses" today={TODAY} />);

    expect(screen.getByRole("heading", { level: 1, name: "Ton plan actuel" })).toBeInTheDocument();
    expect(screen.getByText("Objectif : Top 10 aux Championnats suisses")).toBeInTheDocument();
    expect(screen.getByText("Semaine 1 / 2 · Cette semaine : Développement")).toBeInTheDocument();
    expect(screen.getByText(/Ton objectif reste\./)).toBeInTheDocument();
    expect(screen.getByText("Ton plan s'adapte.")).toBeInTheDocument();
    expect(screen.queryByText(/J-\d/)).not.toBeInTheDocument();
    expectNoInternals(container);
  });

  it("with a race under 120 days: 'Préparation {race}' and J-XX; no objective line", () => {
    renderIn(<ProgramHero review={plan([])} horizon={{ kind: "countdown", race: RACE, days: 12 }} objective="Top 10" today={TODAY} />);

    expect(screen.getByRole("heading", { level: 1, name: "Préparation iXS Lenzerheide" })).toBeInTheDocument();
    expect(screen.getByText("J-12")).toBeInTheDocument();
    expect(screen.queryByText(/Objectif :/)).not.toBeInTheDocument();
  });

  it("a race tomorrow reads 'Demain'; a race in progress 'Jour N · En course'", () => {
    const { rerender } = renderIn(<ProgramHero review={plan([])} horizon={{ kind: "countdown", race: RACE, days: 1 }} objective={null} today={TODAY} />);
    expect(screen.getByText("Demain")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ProgramHero review={plan([])} horizon={{ kind: "ongoing", race: RACE, day: 2 }} objective={null} today={TODAY} />
      </MemoryRouter>
    );
    expect(screen.getByText("Jour 2")).toBeInTheDocument();
    expect(screen.getByText("En course")).toBeInTheDocument();
  });

  it("before / after the plan: its start or end date instead of a made-up week", () => {
    const { rerender } = renderIn(<ProgramHero review={plan([])} horizon={null} objective={null} today="2026-10-01" />);
    expect(screen.getByText(/^Ton plan commence le /)).toBeInTheDocument();
    expect(screen.queryByText(/Semaine \d/)).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ProgramHero review={plan([])} horizon={null} objective={null} today="2026-11-10" />
      </MemoryRouter>
    );
    expect(screen.getByText(/^Plan terminé le /)).toBeInTheDocument();
  });
});

describe("ProgramSessions", () => {
  const SESSIONS = [
    session("2026-10-20", { prescription: drill("braking_progressive_control") }),
    session("2026-10-21", { kind: "STRENGTH_LOWER" }),
    session(TODAY, { prescription: drill("braking_late_entry") }),
    session("2026-10-23"),
    session("2026-10-24", { kind: "STRENGTH_LOWER" }),
    session("2026-10-27"),
    session("2026-10-28"),
    session("2026-10-30"),
  ];

  function renderSessions(overrides: { decisions?: Map<string, DailyPlan>; completedSessions?: ReturnType<typeof completed>[]; review?: ReturnType<typeof plan>; modifiedDates?: string[] } = {}) {
    return renderIn(
      <ProgramSessions
        review={overrides.review ?? plan(SESSIONS)}
        today={TODAY}
        completed={overrides.completedSessions ?? []}
        decisionsByDate={overrides.decisions ?? new Map()}
        modifiedDates={overrides.modifiedDates ?? []}
      />
    );
  }

  it("today is the dominant card: title, duration and load, Focus, the full session one tap away, the mission link", () => {
    const { container } = renderSessions();

    const today = screen.getByRole("region", { name: "DH technique" });
    expect(within(today).getByText("Aujourd'hui")).toBeInTheDocument();
    expect(within(today).getByText("1 h 30 · charge modérée")).toBeInTheDocument();
    expect(within(today).getByText("Focus").nextElementSibling).toHaveTextContent("Freinage tardif, relâchement précoce");
    expect(within(today).getByText("Voir la séance")).toBeInTheDocument();
    expect(within(today).getByRole("link", { name: "Ta mission du jour →" })).toHaveAttribute("href", "/today");
    expect(within(today).queryByText("Adaptée par NALYNT")).not.toBeInTheDocument();
    expectNoInternals(container);
  });

  it("no Focus line when the session has no known drill / exercise", () => {
    renderSessions({ review: plan([session(TODAY)]) });

    expect(screen.queryByText("Focus")).not.toBeInTheDocument();
  });

  it("an adapted today: planned → adapted and the Head Coach's why", () => {
    renderSessions({ decisions: new Map([[TODAY, DECISION]]) });

    const today = screen.getByRole("region", { name: "DH technique" });
    expect(within(today).getByText("Adaptée par NALYNT")).toBeInTheDocument();
    expect(within(today).getByText("Prévu")).toBeInTheDocument();
    expect(within(today).getByText("Adapté")).toBeInTheDocument();
    expect(within(today).getByText("Signal détecté : fatigue jambes élevée. NALYNT ajuste la charge pour préserver ton objectif.")).toBeInTheDocument();
  });

  it("upcoming sessions are always 'Prévue', never adapted, 4 visible and the rest one tap away", () => {
    renderSessions({ decisions: new Map([["2026-10-23", DECISION]]) });

    const upcoming = screen.getByRole("region", { name: "À venir" });
    expect(within(upcoming).getByText("NALYNT ajuste chaque séance le jour même selon ton état.")).toBeInTheDocument();
    expect(within(upcoming).getAllByText("Prévue")).toHaveLength(5);
    expect(within(upcoming).getByText("Demain")).toBeInTheDocument();
    expect(within(upcoming).getByText("Voir la séance suivante")).toBeInTheDocument();
    expect(within(upcoming).queryByText("Adaptée par NALYNT")).not.toBeInTheDocument();
  });

  it("past sessions are folded under 'Terminé · N': recorded completion, 'Non enregistrée', and a past adaptation", async () => {
    renderSessions({ completedSessions: [completed("2026-10-21", "done")], decisions: new Map([["2026-10-20", DECISION]]) });

    const summary = screen.getByText("Terminé · 2");
    await userEvent.click(summary);
    const past = summary.closest("details")!;
    expect(within(past).getByText("Hier")).toBeInTheDocument();
    expect(within(past).getByText("Faite")).toBeInTheDocument();
    expect(within(past).getByText("Non enregistrée")).toBeInTheDocument();
    expect(within(past).getByText("Adaptée par NALYNT")).toBeInTheDocument();
  });

  it("a completed today shows its recorded status; an athlete-modified day says so", () => {
    renderSessions({ completedSessions: [completed(TODAY, "done")], modifiedDates: [TODAY] });

    expect(screen.getByText("✓ Faite")).toBeInTheDocument();
    expect(screen.getByText("Modifiée par toi")).toBeInTheDocument();
  });

  it("no session today: no today card (the week strip already says 'Libre'), straight to 'À venir'", () => {
    renderSessions({ review: plan([session("2026-10-24")]) });

    expect(screen.queryByText("Aujourd'hui")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pas de séance/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "À venir" })).toBeInTheDocument();
  });
});

describe("ProgramWeekTimeline", () => {
  const REVIEW = plan([session("2026-10-20"), session(TODAY), session("2026-10-28", { kind: "STRENGTH_LOWER" })]);

  it("opens on this calendar week with its phase; previous disabled at the plan start; no 'séance du jour' link", () => {
    renderIn(<ProgramWeekTimeline review={REVIEW} today={TODAY} completed={[completed("2026-10-20", "done")]} races={[]} />);

    expect(screen.getByRole("heading", { name: "Cette semaine" })).toBeInTheDocument();
    expect(screen.getByText("Développement")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Semaine précédente" })).toBeDisabled();
    expect(screen.getAllByRole("button", { pressed: false }).length + screen.getAllByRole("button", { pressed: true }).length).toBe(7);
    expect(screen.queryByRole("link", { name: "Voir la séance du jour →" })).not.toBeInTheDocument();
  });

  it("next week: 'Semaine du 26 octobre', its phase, and the way back to today's session", async () => {
    renderIn(<ProgramWeekTimeline review={REVIEW} today={TODAY} completed={[]} races={[]} />);

    await userEvent.click(screen.getByRole("button", { name: "Semaine suivante" }));

    expect(screen.getByRole("heading", { name: "Semaine du 26 octobre" })).toBeInTheDocument();
    expect(screen.getByText("Affûtage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Semaine suivante" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Voir la séance du jour →" })).toHaveAttribute("href", "/today");
  });
});
