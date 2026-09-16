import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SimulationLabPage } from "./SimulationLabPage";

let mockAthleteId: string | null = "simulation-athlete-1";
let mockEmail = "simulation@nalynt.test";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { email: mockEmail },
    athleteId: mockAthleteId,
    signOut: vi.fn(),
  }),
}));

// TodayPage's own behavior (check-in, planning, prescription, séance) is
// covered by TodayPage.test.tsx — this page only needs to prove the clock
// header itself reflects the simulated date correctly (V0.3.010: TodayPage
// no longer receives a `date` prop from here — it reads the same shared
// simulationClock state on its own, verified by TodayPage.test.tsx).
vi.mock("./TodayPage", () => ({
  TodayPage: () => <div data-testid="today-page-stub">today-page</div>,
}));

beforeEach(() => {
  sessionStorage.clear();
  mockAthleteId = "simulation-athlete-1";
  mockEmail = "simulation@nalynt.test";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function renderLab() {
  return render(
    <MemoryRouter initialEntries={["/simulation"]}>
      <SimulationLabPage />
    </MemoryRouter>
  );
}

describe("SimulationLabPage", () => {
  it("refuses to render the lab when no VITE_SIMULATION_ATHLETE_ID is configured (UX guard, not the real security boundary)", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "");

    renderLab();

    expect(screen.getByText("Accès refusé")).toBeInTheDocument();
    expect(screen.queryByTestId("today-page-stub")).not.toBeInTheDocument();
  });

  it("refuses to render the lab when the connected athlete does not match the configured simulation athlete", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "simulation-athlete-1");
    mockAthleteId = "some-other-athlete";
    mockEmail = "louis@example.test";

    renderLab();

    expect(screen.getByText("Accès refusé")).toBeInTheDocument();
    expect(screen.getByText(/louis@example\.test/)).toBeInTheDocument();
    expect(screen.queryByTestId("today-page-stub")).not.toBeInTheDocument();
  });

  it("renders the simulation clock and TodayPage, initialized to today's real date, for the matching simulation athlete", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "simulation-athlete-1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T09:00:00Z"));

    renderLab();

    expect(screen.getByText("Mode simulation")).toBeInTheDocument();
    expect(screen.getByText("Jour 1")).toBeInTheDocument();
    expect(screen.getAllByText("2026-09-16")).toHaveLength(2); // "Date réelle" + "Date simulée"
    expect(screen.getByTestId("today-page-stub")).toBeInTheDocument();
  });

  it("advances the simulated date by exactly one calendar day per click, independent of the real date", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "simulation-athlete-1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T09:00:00Z"));

    renderLab();

    act(() => screen.getByText("+1 jour").click());
    expect(screen.getByText("Jour 2")).toBeInTheDocument();
    expect(screen.getByText("2026-09-17")).toBeInTheDocument();
    expect(screen.getByText("2026-09-16")).toBeInTheDocument(); // "Date réelle" stays put

    act(() => screen.getByText("+1 jour").click());
    expect(screen.getByText("Jour 3")).toBeInTheDocument();
    expect(screen.getByText("2026-09-18")).toBeInTheDocument();
  });

  it("persists the simulated date across remounts within the same session (sessionStorage)", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "simulation-athlete-1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T09:00:00Z"));

    const { unmount } = renderLab();
    act(() => screen.getByText("+1 jour").click());
    expect(screen.getByText("2026-09-17")).toBeInTheDocument();
    unmount();

    renderLab();
    expect(screen.getByText("2026-09-17")).toBeInTheDocument();
  });
});
