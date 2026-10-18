import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TodayPage } from "./TodayPage";
import { addDays, todayLocal } from "../lib/date";
import { weekDates } from "../features/today/todayContext";
import { writeSimulatedDate } from "../lib/simulationClock";

function renderTodayPage(path: string | { pathname: string; state: unknown } = "/today") {
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
vi.mock("../features/trainingPlanReview/trainingPlanReviewRepo", () => ({ getActivePlanVersionId, getPlanPrescriptionSchemaVersion: vi.fn(async () => "v1") }));
const { loadOpenHealthFlags, loadDayExecutions, entryContext } = vi.hoisted(() => ({
  loadOpenHealthFlags: vi.fn(),
  loadDayExecutions: vi.fn(),
  // P0-3 — what the stubbed DailyPlanPanel passes to a guided-session entry FUNCTION (the decision on screen).
  entryContext: { current: { dailyPlan: null as null | Record<string, unknown>, finalPrescriptionCreated: true } },
}));
vi.mock("../features/healthFlags/openHealthFlagsRepo", () => ({ loadOpenHealthFlags }));
vi.mock("../features/guidedSession/executionRepo", () => ({ loadDayExecutions }));

beforeEach(() => {
  getActivePlanVersionId.mockResolvedValue("plan-1");
  loadOpenHealthFlags.mockResolvedValue([]);
  loadDayExecutions.mockResolvedValue([]);
  entryContext.current = { dailyPlan: null, finalPrescriptionCreated: true };
  todayContextValue.current = { firstName: "Louis", races: [], objective: "Performance en course", planned: [], completed: [], guided: [], checkinDates: [] };
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
vi.mock("../features/dailyPlan/DailyPlanPanel", async () => {
  const { useEffect } = await import("react");
  return {
  DailyPlanPanel: ({
    date,
    hasCheckin,
    checkinRevision,
    hideIdleWithoutCheckin,
    autoGenerateOnCheckinSave,
    minAnalysisMs,
    checkinSnapshot,
    detailsTarget,
    guidedSessionEntry,
    onDisplayedDecision,
  }: {
    date: string;
    hasCheckin: boolean;
    checkinRevision: number;
    hideIdleWithoutCheckin?: boolean;
    autoGenerateOnCheckinSave?: boolean;
    minAnalysisMs?: number;
    checkinSnapshot?: { sleep_hours: number } | null;
    detailsTarget?: HTMLElement | null;
    guidedSessionEntry?: import("react").ReactNode | ((context: typeof entryContext.current) => import("react").ReactNode);
    onDisplayedDecision?: (dailyPlan: unknown) => void;
  }) => {
    // INT-01 R1 — the decision on screen, as the real panel reports it (restored or just run).
    useEffect(() => onDisplayedDecision?.(entryContext.current.dailyPlan), [onDisplayedDecision]);
    return (
    <div data-testid="daily-plan-panel-stub">
      <div data-testid="guided-entry-slot">{typeof guidedSessionEntry === "function" ? guidedSessionEntry(entryContext.current) : guidedSessionEntry}</div>
      daily-plan-panel date={date} hasCheckin={String(hasCheckin)} checkinRevision={checkinRevision} hideIdle={String(hideIdleWithoutCheckin)} autoGenerate=
      {String(autoGenerateOnCheckinSave)} minAnalysisMs={minAnalysisMs} checkinSnapshot=
      {checkinSnapshot === undefined ? "undefined" : checkinSnapshot === null ? "null" : `sleep:${checkinSnapshot.sleep_hours}`} details=
      {detailsTarget ? "mounted" : String(detailsTarget)}
    </div>
    );
  },
  };
});

vi.mock("../features/afterSession/AfterSessionEntry", () => ({
  AfterSessionEntry: ({ date, athleteId, healthSuspended }: { date: string; athleteId: string; healthSuspended?: boolean }) => (
    <div data-testid="completed-session-card-stub" data-health-suspended={String(healthSuspended ?? false)}>
      Après ta séance · completed-session-card date={date} athleteId={athleteId}
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
    todayContextValue.current = { firstName: "Louis", races: [], objective: null, planned: [], completed: [], guided: [], checkinDates: [] };
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
      guided: [],
      checkinDates: [],
    };
    renderTodayPage();

    const banner = screen.getByRole("region", { name: "Prochaine course" });
    expect(within(banner).getByText("J-12")).toBeInTheDocument();
    expect(banner).toHaveTextContent("iXS Lenzerheide");
    expect(banner).toHaveTextContent("Lenzerheide · iXS, 3 jours · Priorité A");
    expect(screen.getByRole("region", { name: "Prochaine étape" })).toHaveTextContent("Cap sur iXS Lenzerheide, dans 12 jours.");
  });

  it("validated hierarchy (UX-05/UX-08): context banner → mission → after the session → next step → this week → regularity → plan detail (last)", async () => {
    const { container } = renderTodayPage();
    screen.getByText("simulate checkin available (load)").click();
    await screen.findByRole("region", { name: "Ta régularité" });

    const order = [
      screen.getByRole("region", { name: "Ton objectif" }),
      screen.getByTestId("daily-plan-panel-stub"),
      screen.getByTestId("completed-session-card-stub"),
      screen.getByRole("region", { name: "Prochaine étape" }),
      screen.getByRole("region", { name: "Cette semaine" }),
      screen.getByRole("region", { name: "Ta régularité" }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The collapsible plan detail's mount point is handed to the panel and sits last.
    await waitFor(() => expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("details=mounted"));
    const sheet = container.querySelector<HTMLElement>('[role="dialog"][aria-label="Check-in du jour"]')!;
    const detailsMount = sheet.previousElementSibling!;
    expect(detailsMount.tagName).toBe("DIV");
    expect(screen.getByRole("region", { name: "Ta régularité" }).compareDocumentPosition(detailsMount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("regularity: today's check-in + the plain count of days with a check-in this week (Monday → today)", async () => {
    const monday = weekDates(todayLocal())[0]!;
    todayContextValue.current = { firstName: "Louis", races: [], objective: null, planned: [], completed: [], guided: [], checkinDates: monday === todayLocal() ? [] : [monday] };
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

    it("UX-09 — arriving from the first run: 'Ton premier jour avec NALYNT'", () => {
      renderTodayPage({ pathname: "/today", state: { firstDay: true } });
      screen.getByText("simulate no checkin (load)").click();

      return waitFor(() => {
        expect(screen.getByText("Ton premier jour avec NALYNT")).toBeInTheDocument();
        expect(screen.getByText("Ton check-in permet à NALYNT d'adapter ta première séance à ton état.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Commencer mon check-in" })).toBeInTheDocument();
      });
    });

    it("BUG-V2-3 — first day of a plan starting tomorrow: says when it starts and that nothing is expected today", () => {
      renderTodayPage({ pathname: "/today", state: { firstDay: true, planStartDate: addDays(todayLocal(), 1) } });
      screen.getByText("simulate no checkin (load)").click();

      return waitFor(() => {
        expect(screen.getByText("Ton premier jour avec NALYNT")).toBeInTheDocument();
        expect(screen.getByText(/^Ton programme commence demain, .+\. Rien n'est prévu aujourd'hui\s: ton check-in aide NALYNT à préparer ta première séance\.$/)).toBeInTheDocument();
        expect(screen.queryByText("Ton check-in permet à NALYNT d'adapter ta première séance à ton état.")).not.toBeInTheDocument();
      });
    });

    it("any other day: the usual check-in invitation, never 'premier jour'", () => {
      renderTodayPage();
      screen.getByText("simulate no checkin (load)").click();

      return waitFor(() => {
        expect(screen.getByText("Check-in du jour")).toBeInTheDocument();
        expect(screen.queryByText("Ton premier jour avec NALYNT")).not.toBeInTheDocument();
      });
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

  it("the after-session moment is wired with the canonical date and athleteId (V0.3_007B: no live decision context)", () => {
    renderTodayPage();

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
    it("no accepted plan (UX-09): invites to build the preparation on /start, and Today keeps check-in, decision and completion", async () => {
      getActivePlanVersionId.mockResolvedValue(null);
      renderTodayPage();

      const cta = await screen.findByRole("link", { name: "Construire ma préparation →" });
      expect(cta).toHaveAttribute("href", "/start");
      expect(screen.getByText("Quelques questions sur ton entraînement, et NALYNT construit ton premier plan.")).toBeInTheDocument();
      expect(screen.getByTestId("checkin-form-stub")).toBeInTheDocument();
      expect(screen.getByTestId("daily-plan-panel-stub")).toBeInTheDocument();
      expect(screen.getByTestId("completed-session-card-stub")).toBeInTheDocument();
    });

    it("an active plan: no setup CTA, normal Today flow unchanged", async () => {
      renderTodayPage();

      await waitFor(() => expect(getActivePlanVersionId).toHaveBeenCalled());
      expect(screen.queryByRole("link", { name: "Construire ma préparation →" })).not.toBeInTheDocument();
      expect(screen.getByTestId("checkin-form-stub")).toBeInTheDocument();
      expect(screen.getByTestId("daily-plan-panel-stub")).toBeInTheDocument();
    });

    it("a failed plan lookup never blocks Today and shows no CTA", async () => {
      getActivePlanVersionId.mockRejectedValue(new Error("network"));
      renderTodayPage();

      await waitFor(() => expect(getActivePlanVersionId).toHaveBeenCalled());
      expect(screen.queryByRole("link", { name: "Construire ma préparation →" })).not.toBeInTheDocument();
      expect(screen.getByTestId("daily-plan-panel-stub")).toBeInTheDocument();
    });
  });
});

describe("TodayPage — UX-11R.9 a completed guided session", () => {
  const guided = (date: string) => ({ executionId: "exec-1", sessionDate: date, decisionId: "dec-1", finalPrescriptionId: "fp-1" });

  it("today's guided session completed: 'Séance terminée' with a read-only link, never 'Ouvrir la séance guidée'; the week counts it", () => {
    todayContextValue.current = { firstName: "Louis", races: [], objective: null, planned: [], completed: [], guided: [guided(todayLocal())], checkinDates: [] };
    renderTodayPage();
    const slot = screen.getByTestId("guided-entry-slot");
    expect(within(slot).getByText("Séance terminée")).toBeInTheDocument();
    expect(within(slot).getByRole("link", { name: "Consulter" })).toHaveAttribute("href", "/today/session");
    expect(within(slot).queryByText("Ouvrir la séance guidée")).not.toBeInTheDocument();
    expect(screen.getByText("1 terminée")).toBeInTheDocument();
  });

  it("no guided completion today (or another day's): the normal entry", () => {
    todayContextValue.current = { firstName: "Louis", races: [], objective: null, planned: [], completed: [], guided: [guided(addDays(todayLocal(), -1))], checkinDates: [] };
    renderTodayPage();
    expect(within(screen.getByTestId("guided-entry-slot")).getByRole("link", { name: "Ouvrir la séance guidée" })).toBeInTheDocument();
  });
});

// P0-3 (HPM 2026-10-13) — the entry follows the day's RECORDED executions (same priority as the guided page), not
// only the current decision: an open or completed session stays reachable after a new plan / a re-run / a blocked
// decision; never a resume under a health suspension; never a second start after a completion.
describe("TodayPage — P0-3 guided session entry from the day's executions", () => {
  const exec = (events: string[]) => ({
    id: "e1",
    session_date: todayLocal(),
    final_prescription_id: "fp-1",
    started_at: `${todayLocal()}T07:00:00Z`,
    recorded_at: `${todayLocal()}T07:00:00Z`,
    execution_events: events.map((event_type, i) => ({ event_type, event_seq: i + 1 })),
    exercise_set_results: [],
    session_activity_results: [],
  });
  const rule = (layer: string, rule_id: string) => ({ layer, rule_id, detail: "", signals_used: [] });
  const slot = () => screen.getByTestId("guided-entry-slot");

  it("open session + a newer BLOCKED decision (kept day re-run) → 'Reprendre la séance guidée'", async () => {
    loadDayExecutions.mockResolvedValue([exec(["started"])]);
    entryContext.current = { dailyPlan: { decision: "KEEP", triggered_rules: [] }, finalPrescriptionCreated: false };
    renderTodayPage();
    expect(await within(slot()).findByRole("link", { name: "Reprendre la séance guidée" })).toHaveAttribute("href", "/today/session");
    expect(within(slot()).queryByText("Ouvrir la séance guidée")).toBeNull();
  });

  it("open session + a stale decision (none on screen) → still reachable", async () => {
    loadDayExecutions.mockResolvedValue([exec(["started", "paused"])]);
    entryContext.current = { dailyPlan: null, finalPrescriptionCreated: false };
    renderTodayPage();
    expect(await within(slot()).findByRole("link", { name: "Reprendre la séance guidée" })).toBeInTheDocument();
  });

  it.each([
    ["REST A6", { decision: "REST", triggered_rules: [rule("A", "A6")] }],
    ["REST A2", { decision: "REST", triggered_rules: [rule("A", "A2")] }],
  ])("open session + %s → 'Séance suspendue', no resume", async (_label, dailyPlan) => {
    loadDayExecutions.mockResolvedValue([exec(["started"])]);
    entryContext.current = { dailyPlan, finalPrescriptionCreated: false };
    renderTodayPage();
    expect(await within(slot()).findByTestId("guided-session-suspended")).toHaveTextContent("Séance suspendue");
    expect(within(slot()).getByRole("link", { name: "Consulter la séance" })).toHaveAttribute("href", "/today/session");
    expect(within(slot()).queryByText("Reprendre la séance guidée")).toBeNull();
  });

  it("open session + an open follow-up signal (before any new daily run) → 'Séance suspendue'", async () => {
    loadDayExecutions.mockResolvedValue([exec(["started"])]);
    loadOpenHealthFlags.mockResolvedValue([{ id: "f", type: "injury_suspect", flagDate: todayLocal(), description: "x" }]);
    entryContext.current = { dailyPlan: { decision: "KEEP", triggered_rules: [] }, finalPrescriptionCreated: true };
    renderTodayPage();
    expect(await within(slot()).findByTestId("guided-session-suspended")).toBeInTheDocument();
  });

  it("open session + an ordinary REST (race protocol, layer B) → no false block", async () => {
    loadDayExecutions.mockResolvedValue([exec(["started"])]);
    entryContext.current = { dailyPlan: { decision: "REPLACE", triggered_rules: [rule("B", "RACE_PROTOCOL_TX")] }, finalPrescriptionCreated: false };
    renderTodayPage();
    expect(await within(slot()).findByRole("link", { name: "Reprendre la séance guidée" })).toBeInTheDocument();
  });

  it("completed session + a REST A6 or blocked decision → 'Séance terminée · Consulter', never a start", async () => {
    loadDayExecutions.mockResolvedValue([exec(["started", "completed"])]);
    entryContext.current = { dailyPlan: { decision: "REST", triggered_rules: [rule("A", "A6")] }, finalPrescriptionCreated: false };
    renderTodayPage();
    expect(await within(slot()).findByTestId("guided-session-done")).toHaveTextContent("Séance terminée");
    expect(within(slot()).getByRole("link", { name: "Consulter" })).toBeInTheDocument();
    expect(within(slot()).queryByText("Ouvrir la séance guidée")).toBeNull();
  });

  it("abandoned attempt: never 'Reprendre'; the normal entry only while the current prescription is created", async () => {
    loadDayExecutions.mockResolvedValue([exec(["started", "abandoned"])]);
    entryContext.current = { dailyPlan: { decision: "KEEP", triggered_rules: [] }, finalPrescriptionCreated: true };
    const { unmount } = renderTodayPage();
    await waitFor(() => expect(loadDayExecutions).toHaveBeenCalled());
    expect(await within(slot()).findByRole("link", { name: "Ouvrir la séance guidée" })).toBeInTheDocument();
    expect(within(slot()).queryByText("Reprendre la séance guidée")).toBeNull();
    unmount();
    entryContext.current = { dailyPlan: { decision: "REST", triggered_rules: [rule("A", "A6")] }, finalPrescriptionCreated: false };
    renderTodayPage();
    await waitFor(() => expect(loadDayExecutions).toHaveBeenCalledTimes(2));
    expect(slot()).toBeEmptyDOMElement();
  });
});

// INT-01 R1 (HPM 2026-10-13) — the after-session block reads the SAME suspension as the guided entry: open
// follow-up signals and the decision on screen (restored or just run), never a separate rule.
describe("TodayPage — INT-01 R1 the after-session block knows the health suspension", () => {
  const rule = (layer: string, rule_id: string) => ({ layer, rule_id, detail: "", signals_used: [] });
  const afterSession = () => screen.getByTestId("completed-session-card-stub");

  it.each([
    ["the decision on screen is a Safety REST (A6)", { decision: "REST", triggered_rules: [rule("A", "A6")] }, []],
    ["an open follow-up signal, before any new daily run", { decision: "KEEP", triggered_rules: [] }, [{ id: "f", type: "injury_suspect", flagDate: todayLocal(), description: "x" }]],
    ["an open illness signal and no decision on screen", null, [{ id: "f", type: "illness", flagDate: todayLocal(), description: "x" }]],
  ])("%s → suspended", async (_label, dailyPlan, flags) => {
    loadOpenHealthFlags.mockResolvedValue(flags);
    entryContext.current = { dailyPlan, finalPrescriptionCreated: false };
    renderTodayPage();
    await waitFor(() => expect(afterSession()).toHaveAttribute("data-health-suspended", "true"));
  });

  it.each([
    ["an ordinary decision", { decision: "KEEP", triggered_rules: [] }],
    ["an ordinary REST (race protocol, layer B)", { decision: "REST", triggered_rules: [rule("B", "RACE_PROTOCOL_TX")] }],
    ["no decision yet", null],
  ])("%s, no open signal → not suspended", async (_label, dailyPlan) => {
    entryContext.current = { dailyPlan, finalPrescriptionCreated: true };
    renderTodayPage();
    await waitFor(() => expect(loadOpenHealthFlags).toHaveBeenCalled());
    expect(afterSession()).toHaveAttribute("data-health-suspended", "false");
  });
});

// CONSISTENCY-02 (HPM 2026-10-16, O-32) — Today when the calendar day changes while the page stays open.
describe("TodayPage — CONSISTENCY-02, a new day on an open page", () => {
  it("real calendar, tab left open past midnight: back on the tab, Today is the new day — yesterday's check-in, executions and decision are not carried over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 16, 23, 50, 0));
    const { container } = renderTodayPage();
    screen.getByText("simulate checkin available (load)").click();
    await waitFor(() => expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("date=2026-10-16 hasCheckin=true"));

    vi.setSystemTime(new Date(2026, 9, 17, 7, 30, 0)); // the night passed, no timer ran in the background tab
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(container.querySelector("time")).toHaveAttribute("dateTime", "2026-10-17");
    expect(screen.getByTestId("checkin-form-stub")).toHaveTextContent("date=2026-10-17");
    expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("date=2026-10-17 hasCheckin=false");
    await waitFor(() => expect(loadDayExecutions).toHaveBeenCalledWith("athlete-1", "2026-10-17"));
  });

  it("simulation « +1 jour »: the simulated day moves on, the real calendar does not decide it", async () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "athlete-1");
    writeSimulatedDate("2026-11-02");
    const { container } = renderTodayPage("/simulation");
    screen.getByText("simulate checkin available (load)").click();
    await waitFor(() => expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("date=2026-11-02 hasCheckin=true"));

    writeSimulatedDate("2026-11-03"); // SimulationLabPage « +1 jour »
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(container.querySelector("time")).toHaveAttribute("dateTime", "2026-11-03");
    expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("date=2026-11-03 hasCheckin=false");
    expect(screen.getByTestId("checkin-form-stub")).toHaveTextContent("date=2026-11-03");
  });
});
