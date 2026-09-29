import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TodayGreeting } from "./TodayGreeting";
import { RaceBanner } from "./RaceBanner";
import { NextStepCard } from "./NextStepCard";
import { WeekStrip } from "./WeekStrip";
import { RegularityCard } from "./RegularityCard";
import { CoachStateCard } from "../dailyPlan/CoachStateCard";
import { raceHorizon, weekSummary, type TodayRace } from "./todayContext";
import type { PlannedSessionRow } from "../planning/planningTypes";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import type { CheckinRow } from "../checkin/checkinTypes";

const RACE: TodayRace = {
  eventName: "iXS Lenzerheide",
  startDate: "2026-10-11",
  endDate: "2026-10-13",
  priority: "A_PLUS",
  location: "Lenzerheide",
  raceFormat: "IXS_3DAY",
};
const TODAY = "2026-09-29";

describe("TodayGreeting", () => {
  it("Bonjour + first name and the date; no name → 'Bonjour' alone, never the brand or a guess", () => {
    const { rerender } = render(<TodayGreeting firstName="Louis" friendlyDate="Mardi 29 septembre" canonicalDate={TODAY} />);
    expect(screen.getByRole("heading", { name: "Bonjour Louis" })).toBeInTheDocument();
    expect(screen.getByText("Mardi 29 septembre")).toBeInTheDocument();
    rerender(<TodayGreeting firstName={null} friendlyDate="Mardi 29 septembre" canonicalDate={TODAY} />);
    expect(screen.getByRole("heading", { name: "Bonjour" })).toBeInTheDocument();
    expect(screen.queryByText(/NALYNT/)).not.toBeInTheDocument();
  });
});

describe("RaceBanner (UX-05)", () => {
  it("race in 12 days → PROCHAINE COURSE · J-12 · name, then date · location · format · priority (French labels, never raw)", () => {
    render(<RaceBanner horizon={raceHorizon([RACE], TODAY)} objective="Performance en course" />);
    const banner = screen.getByRole("region", { name: "Prochaine course" });
    expect(within(banner).getByText("J-12")).toBeInTheDocument();
    expect(within(banner).getByText("iXS Lenzerheide")).toBeInTheDocument();
    expect(banner).toHaveTextContent("Dim. 11 octobre · Lenzerheide · iXS, 3 jours · Priorité A+");
    expect(banner).toHaveTextContent("12 jours avant ta course. Chaque décision compte.");
    expect(banner.textContent).not.toMatch(/IXS_3DAY|A_PLUS/);
    // A race takes precedence over the declared objective.
    expect(banner).not.toHaveTextContent("Performance en course");
  });

  it("race in 200 days → OBJECTIF DE SAISON with the race name, no countdown", () => {
    render(<RaceBanner horizon={raceHorizon([{ ...RACE, startDate: "2027-04-17", endDate: "2027-04-18" }], TODAY)} objective={null} />);
    const banner = screen.getByRole("region", { name: "Objectif de saison" });
    expect(within(banner).getByText("iXS Lenzerheide")).toBeInTheDocument();
    expect(banner.textContent).not.toMatch(/J-\d/);
  });

  it("no race within a year → TON OBJECTIF with the athlete's own declared objective", () => {
    render(<RaceBanner horizon={raceHorizon([{ ...RACE, startDate: "2027-12-01", endDate: "2027-12-02" }], TODAY)} objective="Devenir plus rapide en DH" />);
    const banner = screen.getByRole("region", { name: "Ton objectif" });
    expect(banner).toHaveTextContent("Devenir plus rapide en DH");
    expect(banner).toHaveTextContent("Semaine en cours. Ton plan évolue avec ta réalité.");
  });

  it("no race and no declared objective → nothing at all (never 'aucun objectif')", () => {
    const { container } = render(<RaceBanner horizon={raceHorizon([], TODAY)} objective={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("race missing optional columns → only what exists is shown", () => {
    render(<RaceBanner horizon={raceHorizon([{ ...RACE, location: null, raceFormat: null, priority: "B" }], TODAY)} objective={null} />);
    expect(screen.getByRole("region", { name: "Prochaine course" })).toHaveTextContent("Dim. 11 octobre · Priorité B");
  });

  it("race in progress → EN COURSE · jour N", () => {
    render(<RaceBanner horizon={raceHorizon([RACE], "2026-10-12")} objective={null} />);
    expect(within(screen.getByRole("region", { name: "En course" })).getByText("Jour 2")).toBeInTheDocument();
  });
});

const row = (planned_date: string, kind: string, duration_min: number) =>
  ({ planned_date, session_type: "STRENGTH", intervention: { kind, load_profile: "MODERATE", duration_min }, planned_intent: null, is_committed: false, source: "generated" }) as unknown as PlannedSessionRow;

describe("NextStepCard", () => {
  it("the next planned session (name in large type, duration · load underneath), its race, and the brand promise", () => {
    render(
      <MemoryRouter>
        <NextStepCard next={row("2026-09-30", "STRENGTH_LOWER", 60)} today={TODAY} horizon={raceHorizon([RACE], TODAY)} objective={null} />
      </MemoryRouter>
    );
    const card = screen.getByRole("region", { name: "Prochaine étape" });
    expect(within(card).getByText("Demain")).toBeInTheDocument();
    expect(within(card).getByText("Renfo bas du corps")).toBeInTheDocument();
    expect(card).toHaveTextContent("1 h · charge modérée");
    expect(card).toHaveTextContent("Cap sur iXS Lenzerheide, dans 12 jours.");
    expect(card).toHaveTextContent("Ton objectif reste. Ton plan s'adapte.");
  });

  it("no upcoming session: says so honestly", () => {
    render(
      <MemoryRouter>
        <NextStepCard next={null} today={TODAY} horizon={null} objective="Régularité" />
      </MemoryRouter>
    );
    expect(screen.getByRole("region", { name: "Prochaine étape" })).toHaveTextContent("Aucune séance prévue dans les deux prochaines semaines.");
  });
});

describe("WeekStrip (UX-05)", () => {
  const week = weekSummary(
    TODAY,
    [row("2026-09-28", "AEROBIC_BASE", 45), row("2026-09-29", "DH_TECHNICAL", 90), row("2026-10-01", "DH_TECHNICAL", 90)],
    [{ session_date: "2026-09-28", completion_status: "done" } as never],
    [{ ...RACE, startDate: "2026-10-03", endDate: "2026-10-03" }]
  );
  const renderWeek = () =>
    render(
      <MemoryRouter>
        <WeekStrip week={week} />
      </MemoryRouter>
    );
  const dayButtons = (card: HTMLElement) => within(within(card).getByRole("group", { name: "Jours de la semaine" })).getAllByRole("button");

  it("Monday → Sunday, editorial counts, one symbol per day (✓ réalisée, ● aujourd'hui, ○ prévue, ⚑ course), no percentage", () => {
    renderWeek();
    const card = screen.getByRole("region", { name: "Cette semaine" });
    expect(card).toHaveTextContent("3 séances prévues");
    expect(card).toHaveTextContent("1 réalisée");
    expect(dayButtons(card).map((day) => day.textContent)).toEqual(["L✓", "M●", "M·", "J○", "V·", "S⚑", "D·"]);
    expect(card.textContent).not.toMatch(/%/);
  });

  it("plural only when the count is not exactly one: 1 séance prévue · 1 réalisée / 2 séances prévues · 0 réalisées", () => {
    const one = weekSummary(TODAY, [row("2026-09-28", "DH_TECHNICAL", 90)], [{ session_date: "2026-09-28", completion_status: "done" } as never], []);
    const { unmount } = render(
      <MemoryRouter>
        <WeekStrip week={one} />
      </MemoryRouter>
    );
    expect(screen.getByRole("region", { name: "Cette semaine" })).toHaveTextContent("1 séance prévue1 réalisée");
    unmount();

    const none = weekSummary(TODAY, [row("2026-09-30", "DH_TECHNICAL", 90), row("2026-10-01", "DH_TECHNICAL", 90)], [], []);
    render(
      <MemoryRouter>
        <WeekStrip week={none} />
      </MemoryRouter>
    );
    expect(screen.getByRole("region", { name: "Cette semaine" })).toHaveTextContent("2 séances prévues0 réalisées");
  });

  it("today is spelled out by default: Aujourd'hui · DH technique", () => {
    renderWeek();
    const card = screen.getByRole("region", { name: "Cette semaine" });
    expect(within(card).getByRole("button", { name: /^Mardi/ })).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveTextContent("Aujourd'huiDH technique1 h 30 · Aujourd'hui");
  });

  it("tapping a day spells it out: Jeudi · DH technique · 1 h 30 · Prévue; the race day shows the race", async () => {
    const user = userEvent.setup();
    renderWeek();
    const card = screen.getByRole("region", { name: "Cette semaine" });

    await user.click(within(card).getByRole("button", { name: /^Jeudi/ }));
    expect(within(card).getByRole("button", { name: /^Jeudi/ })).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveTextContent("JeudiDH technique1 h 30 · Prévue");

    await user.click(within(card).getByRole("button", { name: /^Samedi/ }));
    expect(card).toHaveTextContent("SamediiXS Lenzerheide");
  });
});

describe("RegularityCard (UX-05)", () => {
  it("today's check-in and the plain count this week — no streak, score or praise", () => {
    const onEdit = vi.fn();
    render(<RegularityCard checkedInToday weekCount={5} onEditCheckin={onEdit} />);
    const card = screen.getByRole("region", { name: "Ta régularité" });
    expect(card).toHaveTextContent("Check-in aujourd'hui");
    expect(card).toHaveTextContent("5 check-ins cette semaine");
    expect(card.textContent).not.toMatch(/série|streak|bravo|super|constant|points?\b|%/i);
    within(card).getByRole("button", { name: "Modifier" }).click();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("singular, and no Modifier without a check-in today", () => {
    render(<RegularityCard checkedInToday={false} weekCount={1} onEditCheckin={() => {}} />);
    const card = screen.getByRole("region", { name: "Ta régularité" });
    expect(card).toHaveTextContent("1 check-in cette semaine");
    expect(within(card).queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
  });

  it("nothing to observe → not rendered", () => {
    const { container } = render(<RegularityCard checkedInToday={false} weekCount={0} onEditCheckin={() => {}} />);
    expect(container).toBeEmptyDOMElement();
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

describe("CoachStateCard (UX-04, split in two cards by UX-05)", () => {
  it("'Ce que ton coach a retenu' (engine signals only), then a separate 'Ton état du jour' with the declared values — the matching one accented", () => {
    render(<CoachStateCard dailyPlan={PLAN} hasHealthSignal={false} checkin={CHECKIN} />);
    const retained = screen.getByRole("region", { name: "Ce que ton coach a retenu" });
    const state = screen.getByRole("region", { name: "Ton état du jour" });
    expect(within(retained).getByText("Fatigue jambes élevée")).toBeInTheDocument();
    expect(state).toHaveTextContent("7 h");
    expect(state).toHaveTextContent("qualité 8/10");
    expect(within(state).getByText("Fatigue jambes").closest("div")!.className).toContain("border-gold");
    expect(within(state).getByText("Énergie").closest("div")!.className).not.toContain("border-gold");
    expect(`${retained.textContent}${state.textContent}`).not.toMatch(/leg_fatigue_high|bon|bonne/i);
  });

  it("no retained signal: says so factually; no check-in values: no tiles, the body state stays", () => {
    render(<CoachStateCard dailyPlan={{ ...PLAN, decision: "KEEP", decision_reasoning: [] }} hasHealthSignal={false} checkin={null} />);
    expect(screen.getByText("Aucun signal de ton check-in n'a demandé d'adapter ta séance.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Ton état du jour" })).toHaveTextContent("État du corpsPrêt");
  });

  it("keeps the ReadinessCard safety semantics: server health signal in red, sanitized attention note", () => {
    render(<CoachStateCard dailyPlan={{ ...PLAN, monitoring: { observe: ["Surveiller la douleur (knee_R, intensité 4/10)"] } }} hasHealthSignal checkin={CHECKIN} />);
    expect(screen.getByText("Signal actif").className).toContain("text-red-400");
    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.queryByText(/knee_R/)).not.toBeInTheDocument();
  });
});
