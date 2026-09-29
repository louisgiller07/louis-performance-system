import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TodayPage } from "./TodayPage";
import { addDays, todayLocal } from "../lib/date";
import { weekDates } from "../features/today/todayContext";
import { writeSimulatedDate } from "../lib/simulationClock";

function renderTodayPage(path = "/today") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TodayPage />
    </MemoryRouter>
  );
}

const signOut = vi.fn();

// PILOT_012 — current-plan pointer (training_plan_current_version via the existing repo).
// Defaults to an active plan so every test keeps the normal Today flow.
const { getActivePlanVersionId } = vi.hoisted(() => ({ getActivePlanVersionId: vi.fn() }));
vi.mock("../features/trainingPlanReview/trainingPlanReviewRepo", () => ({ getActivePlanVersionId }));
vi.mock("../features/healthFlags/openHealthFlagsRepo", () => ({ loadOpenHealthFlags: vi.fn().mockResolvedValue([]) }));

beforeEach(() => {
  getActivePlanVersionId.mockResolvedValue("plan-1");
  todayContextValue.current = { firstName: "Louis", races: [], objective: "Performance en course", planned: [], completed: [], checkinDates: [] };
});

// UX-04 — Today's read-only coach context (its loading and rules are covered by
// src/features/today/*.test.ts*). Mutable so a test can set a race or objective.
const { todayContextValue } = vi.hoisted(() => ({
  todayContextValue: { current: null as null | Record<string, unknown> },
}));
vi.mock("../features/today/todayContextRepo", () => ({ useTodayContext: () => todayContextValue.current }));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "louis@example.test" },
    athleteId: "athlete-1",
    signOut,
  }),
}));

// CheckinForm's own behavior (load/save/validation, full and guided modes)
// is covered by src/features/checkin/CheckinForm*.test.tsx — TodayPage only
// needs to prove it's wired in (athleteId/date/mode) and reacts to its two
// signals: availability (load or save) and an actual save.
vi.mock("../features/checkin/CheckinForm", () => ({
  CheckinForm: ({
    athleteId,
    date,
    mode,
    onCheckinAvailabilityChange,
    onSaved,
    onValuesChange,
  }: {
    athleteId: string;
    date: string;
    mode?: string;
    onCheckinAvailabilityChange?: (hasCheckin: boolean) => void;
    onSaved?: () => void;
    onValuesChange?: (row: unknown) => void;
  }) => (
    <div data-testid="checkin-form-stub">
      checkin-form athlete={athleteId} date={date} mode={mode}
      <button onClick={() => onCheckinAvailabilityChange?.(false)}>simulate no checkin (load)</button>
      <button onClick={() => onCheckinAvailabilityChange?.(true)}>simulate checkin available (load)</button>
      <button onClick={() => onValuesChange?.({ sleep_hours: 7, energy: 6 })}>simulate checkin values</button>
      <button
        onClick={() => {
          onCheckinAvailabilityChange?.(true);
          onSaved?.();
        }}
      >
        simulate checkin saved
      </button>
    </div>
  ),
}));

// TodayPlanningSummary's own behavior is covered by its own test file.
vi.mock("../features/planning/TodayPlanningSummary", () => ({
  TodayPlanningSummary: ({ athleteId, date }: { athleteId: string; date: string }) => (
    <div data-testid="today-planning-summary-stub">
      today-planning-summary athlete={athleteId} date={date}
    </div>
  ),
}));

// DailyPlanPanel's own behavior (restore, generation, guards, and the UX-03
// opt-in props) is covered by DailyPlanPanel*.test.tsx.
vi.mock("../features/dailyPlan/DailyPlanPanel", () => ({
  DailyPlanPanel: ({
    date,
    hasCheckin,
    checkinRevision,
    hideIdleWithoutCheckin,
    autoGenerateOnCheckinSave,
    minAnalysisMs,
    checkinSnapshot,
    detailsTarget,
  }: {
    date: string;
    hasCheckin: boolean;
    checkinRevision: number;
    hideIdleWithoutCheckin?: boolean;
    autoGenerateOnCheckinSave?: boolean;
    minAnalysisMs?: number;
    checkinSnapshot?: { sleep_hours: number } | null;
    detailsTarget?: HTMLElement | null;
  }) => (
    <div data-testid="daily-plan-panel-stub">
      daily-plan-panel date={date} hasCheckin={String(hasCheckin)} checkinRevision={checkinRevision} hideIdle={String(hideIdleWithoutCheckin)} autoGenerate=
      {String(autoGenerateOnCheckinSave)} minAnalysisMs={minAnalysisMs} checkinSnapshot=
      {checkinSnapshot === undefined ? "undefined" : checkinSnapshot === null ? "null" : `sleep:${checkinSnapshot.sleep_hours}`} details=
      {detailsTarget ? "mounted" : String(detailsTarget)}
    </div>
  ),
}));

vi.mock("../features/completedSession/CompletedSessionCard", () => ({
  CompletedSessionCard: ({ date, athleteId }: { date: string; athleteId: string }) => (
    <div data-testid="completed-session-card-stub">
      completed-session-card date={date} athleteId={athleteId}
    </div>
  ),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
});

// A hidden element has an empty accessible name (accname step 2A), so the closed sheet is found by role attribute.
const sheet = () => {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Check-in du jour"]');
  if (!dialog) throw new Error("check-in sheet not rendered");
  return dialog;
};

describe("TodayPage — UX-04 coach context", () => {
  it("greets the rider by first name, then the declared objective when no race is within reach (UX-05 'Ton objectif')", () => {
    renderTodayPage();

    expect(screen.getByRole("heading", { name: "Bonjour Louis" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Ton objectif" })).toHaveTextContent("Performance en course");
  });

  it("no race and no declared objective: no context banner at all (never 'aucun objectif')", () => {
    todayContextValue.current = { firstName: "Louis", races: [], objective: null, planned: [], completed: [], checkinDates: [] };
    renderTodayPage();

    for (const name of ["Prochaine course", "Objectif de saison", "Ton objectif", "En course"]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/aucun objectif/i)).not.toBeInTheDocument();
  });

  it("a race within 120 days: PROCHAINE COURSE · J-12 · its name, and the next step builds towards it", () => {
    todayContextValue.current = {
      firstName: "Louis",
      races: [{ eventName: "iXS Lenzerheide", startDate: addDays(todayLocal(), 12), endDate: addDays(todayLocal(), 13), priority: "A", location: "Lenzerheide", raceFormat: "IXS_3DAY" }],
      objective: "Performance en course",
      planned: [],
      completed: [],
      checkinDates: [],
    };
    renderTodayPage();

    const banner = screen.getByRole("region", { name: "Prochaine course" });
    expect(within(banner).getByText("J-12")).toBeInTheDocument();
    expect(banner).toHaveTextContent("iXS Lenzerheide");
    expect(banner).toHaveTextContent("Lenzerheide · iXS, 3 jours · Priorité A");
    expect(screen.getByRole("region", { name: "Prochaine étape" })).toHaveTextContent("Cap sur iXS Lenzerheide, dans 12 jours.");
  });

  it("validated hierarchy: context banner → mission → next step → this week → regularity → after the session → plan detail (last)", async () => {
    const { container } = renderTodayPage();
    screen.getByText("simulate checkin available (load)").click();
    await screen.findByRole("region", { name: "Ta régularité" });

    const order = [
      screen.getByRole("region", { name: "Ton objectif" }),
      screen.getByTestId("daily-plan-panel-stub"),
      screen.getByRole("region", { name: "Prochaine étape" }),
      screen.getByRole("region", { name: "Cette semaine" }),
      screen.getByRole("region", { name: "Ta régularité" }),
      screen.getByText("Après ta séance"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The collapsible plan detail's mount point is handed to the panel and sits after "Après ta séance".
    await waitFor(() => expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("details=mounted"));
    const sheet = container.querySelector<HTMLElement>('[role="dialog"][aria-label="Check-in du jour"]')!;
    const detailsMount = sheet.previousElementSibling!;
    expect(detailsMount.tagName).toBe("DIV");
    expect(screen.getByText("Après ta séance").compareDocumentPosition(detailsMount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("regularity: today's check-in + the plain count of days with a check-in this week (Monday → today)", async () => {
    const monday = weekDates(todayLocal())[0]!;
    todayContextValue.current = { firstName: "Louis", races: [], objective: null, planned: [], completed: [], checkinDates: monday === todayLocal() ? [] : [monday] };
    renderTodayPage();
    screen.getByText("simulate checkin available (load)").click();

    const card = await screen.findByRole("region", { name: "Ta régularité" });
    expect(card).toHaveTextContent("Check-in aujourd'hui");
    expect(card).toHaveTextContent(monday === todayLocal() ? "1 check-in cette semaine" : "2 check-ins cette semaine");
  });

  it("no first name: 'Bonjour' alone, never the brand; while the context loads, no coach cards yet", () => {
    todayContextValue.current = null;
    renderTodayPage();

    expect(screen.getByRole("heading", { name: "Bonjour" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Prochaine étape" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cette semaine" })).not.toBeInTheDocument();
  });

  it("today's check-in values (as loaded / saved) are handed to the mission panel for 'Ton état du jour'", async () => {
    renderTodayPage();
    expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("checkinSnapshot=null");

    screen.getByText("simulate checkin values").click();

    await waitFor(() => expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("checkinSnapshot=sleep:7"));
  });
});

describe("TodayPage (UX-03)", () => {
  describe("header", () => {
    it("shows an elegant short date ('Mardi 29 septembre'), never the ISO date, and the canonical date stays machine-readable", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-29T09:00:00Z"));
      const { container } = renderTodayPage();

      expect(screen.getByText("Mardi 29 septembre")).toBeInTheDocument();
      expect(screen.queryByText("2026-09-29")).not.toBeInTheDocument();
      expect(container.querySelector("time")).toHaveAttribute("dateTime", todayLocal());
    });

    it("no e-mail, Configuration or Déconnexion in the header anymore (moved to Profil); the Aujourd'hui tab is active; never 'Today'", () => {
      renderTodayPage();

      expect(screen.queryByText("louis@example.test")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Configuration" })).not.toBeInTheDocument();
      expect(screen.queryByText("Déconnexion")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Aujourd'hui" })).toHaveAttribute("aria-current", "page");
      expect(screen.queryByText("Today")).not.toBeInTheDocument();
    });
  });

  describe("state-driven hero", () => {
    it("before CheckinForm reports anything: a loading skeleton, no check-in invitation yet", () => {
      renderTodayPage();

      expect(screen.getByText("Chargement de ta journée…")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Commencer mon check-in" })).not.toBeInTheDocument();
    });

    it("no check-in today: the check-in invitation, with what is planned today (TodayPlanningSummary wired with the canonical date)", () => {
      renderTodayPage();
      screen.getByText("simulate no checkin (load)").click();

      return waitFor(() => {
        expect(screen.getByRole("button", { name: "Commencer mon check-in" })).toBeInTheDocument();
        expect(screen.getByTestId("today-planning-summary-stub")).toHaveTextContent(`today-planning-summary athlete=athlete-1 date=${todayLocal()}`);
        expect(screen.queryByText("Check-in aujourd'hui")).not.toBeInTheDocument();
      });
    });

    it("check-in already done: no invitation; 'Check-in aujourd'hui' with Modifier (UX-05 regularity card); the panel gets hasCheckin=true without a revision bump", async () => {
      renderTodayPage();
      screen.getByText("simulate checkin available (load)").click();

      expect(await screen.findByText("Check-in aujourd'hui")).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "Ta régularité" })).getByRole("button", { name: "Modifier" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Commencer mon check-in" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("today-planning-summary-stub")).not.toBeInTheDocument();
      const stub = screen.getByTestId("daily-plan-panel-stub");
      expect(stub).toHaveTextContent("hasCheckin=true");
      expect(stub).toHaveTextContent("checkinRevision=0");
    });
  });

  describe("guided check-in sheet", () => {
    it("the real CheckinForm is always mounted (so today's check-in state is known on load), in guided mode, with athleteId and the canonical date — hidden until opened", () => {
      renderTodayPage();

      expect(screen.getByTestId("checkin-form-stub")).toHaveTextContent(`checkin-form athlete=athlete-1 date=${todayLocal()} mode=guided`);
      expect(sheet()).not.toBeVisible();
    });

    it("'Commencer mon check-in' opens the sheet; the close control hides it again", async () => {
      renderTodayPage();
      screen.getByText("simulate no checkin (load)").click();

      (await screen.findByRole("button", { name: "Commencer mon check-in" })).click();
      await waitFor(() => expect(sheet()).toBeVisible());

      within(sheet()).getByRole("button", { name: "Fermer le check-in" }).click();
      await waitFor(() => expect(sheet()).not.toBeVisible());
    });

    it("'Modifier' reopens the sheet on an already-saved check-in", async () => {
      renderTodayPage();
      screen.getByText("simulate checkin available (load)").click();

      (await screen.findByRole("button", { name: "Modifier" })).click();
      await waitFor(() => expect(sheet()).toBeVisible());
    });

    it("an actual save bumps checkinRevision and closes the sheet", async () => {
      renderTodayPage();
      screen.getByText("simulate no checkin (load)").click();
      (await screen.findByRole("button", { name: "Commencer mon check-in" })).click();
      await waitFor(() => expect(sheet()).toBeVisible());

      within(sheet()).getByText("simulate checkin saved").click();

      await waitFor(() => expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("checkinRevision=1"));
      await waitFor(() => expect(sheet()).not.toBeVisible());

      within(sheet()).getByText("simulate checkin saved").click();
      await waitFor(() => expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("checkinRevision=2"));
    });
  });

  it("DailyPlanPanel is wired for the guided flow: canonical date, hasCheckin=false / revision 0 initially, hidden while idle without check-in, auto-run after a save, paced analysis", () => {
    renderTodayPage();

    expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent(
      `daily-plan-panel date=${todayLocal()} hasCheckin=false checkinRevision=0 hideIdle=true autoGenerate=true minAnalysisMs=1800 checkinSnapshot=null`
    );
  });

  it("CompletedSessionCard is wired with the canonical date and athleteId, under 'Après ta séance' (V0.3_007B: no live decision context)", () => {
    renderTodayPage();

    expect(screen.getByText("Après ta séance")).toBeInTheDocument();
    expect(screen.getByTestId("completed-session-card-stub")).toHaveTextContent(`completed-session-card date=${todayLocal()} athleteId=athlete-1`);
  });

  it("V0.3.010 (SIM-001): for the configured simulation athlete, every date-dependent child uses the simulated date — real /today is unaffected", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const realToday = todayLocal();

    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "athlete-1");
    writeSimulatedDate("2026-09-20");

    const { container } = renderTodayPage("/simulation");
    screen.getByText("simulate no checkin (load)").click();

    expect(container.querySelector("time")).toHaveAttribute("dateTime", "2026-09-20");
    expect(screen.getByText("Dimanche 20 septembre")).toBeInTheDocument();
    expect(container.querySelector("time")).not.toHaveAttribute("dateTime", realToday);
    expect(screen.getByTestId("checkin-form-stub")).toHaveTextContent("date=2026-09-20");
    expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("date=2026-09-20");
    expect(screen.getByTestId("completed-session-card-stub")).toHaveTextContent("date=2026-09-20");
  });

  it("V0.3.010: the planned-today summary also uses the simulated date", async () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "athlete-1");
    writeSimulatedDate("2026-09-20");

    renderTodayPage("/simulation");
    screen.getByText("simulate no checkin (load)").click();

    expect(await screen.findByTestId("today-planning-summary-stub")).toHaveTextContent("date=2026-09-20");
  });

  it("real /today: an unconfigured simulation athlete ID never affects the date, even if a simulated date happens to be stored", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const realToday = todayLocal();
    writeSimulatedDate("2026-09-20");

    const { container } = renderTodayPage();

    expect(container.querySelector("time")).toHaveAttribute("dateTime", realToday);
    expect(screen.queryByText("Dimanche 20 septembre")).not.toBeInTheDocument();
  });

  describe("PILOT_012 — guided entry for athletes without a training plan", () => {
    it("no accepted plan: shows the setup CTA to /performance-setup, and Today keeps check-in, decision and completion", async () => {
      getActivePlanVersionId.mockResolvedValue(null);
      renderTodayPage();

      const cta = await screen.findByRole("link", { name: "Configurer mon profil et générer mon plan" });
      expect(cta).toHaveAttribute("href", "/performance-setup");
      expect(screen.getByText("Complète ton profil et tes disponibilités pour créer ton premier plan d'entraînement.")).toBeInTheDocument();
      expect(screen.getByTestId("checkin-form-stub")).toBeInTheDocument();
      expect(screen.getByTestId("daily-plan-panel-stub")).toBeInTheDocument();
      expect(screen.getByTestId("completed-session-card-stub")).toBeInTheDocument();
    });

    it("an active plan: no setup CTA, normal Today flow unchanged", async () => {
      renderTodayPage();

      await waitFor(() => expect(getActivePlanVersionId).toHaveBeenCalled());
      expect(screen.queryByRole("link", { name: "Configurer mon profil et générer mon plan" })).not.toBeInTheDocument();
      expect(screen.getByTestId("checkin-form-stub")).toBeInTheDocument();
      expect(screen.getByTestId("daily-plan-panel-stub")).toBeInTheDocument();
    });

    it("a failed plan lookup never blocks Today and shows no CTA", async () => {
      getActivePlanVersionId.mockRejectedValue(new Error("network"));
      renderTodayPage();

      await waitFor(() => expect(getActivePlanVersionId).toHaveBeenCalled());
      expect(screen.queryByRole("link", { name: "Configurer mon profil et générer mon plan" })).not.toBeInTheDocument();
      expect(screen.getByTestId("daily-plan-panel-stub")).toBeInTheDocument();
    });
  });
});
