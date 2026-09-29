import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { HistoryPage } from "./HistoryPage";
import { checkin, completed, decision, JOURNEY_ROWS, KEEP_PLAN, MODIFY_PLAN } from "../features/history/historyFixtures";

const signOut = vi.fn();

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { email: "louis@example.test" }, athleteId: "athlete-1", signOut }),
}));

vi.mock("../lib/simulationClock", () => ({ useEffectiveToday: () => "2026-09-29" }));

vi.mock("../features/history/historyRepo", () => ({
  loadDecisionHistory: vi.fn(),
  loadCompletedSessionsForDates: vi.fn(),
  HistoryLoadError: class HistoryLoadError extends Error {
    constructor() {
      super("Impossible de charger l'historique. Réessaie.");
    }
  },
}));
vi.mock("../features/checkin/checkinRepo", () => ({ loadCheckinsForDates: vi.fn() }));
vi.mock("../features/today/todayContextRepo", () => ({ loadRaces: vi.fn(), loadObjective: vi.fn() }));

import { loadDecisionHistory, loadCompletedSessionsForDates } from "../features/history/historyRepo";
import { loadCheckinsForDates } from "../features/checkin/checkinRepo";
import { loadObjective, loadRaces } from "../features/today/todayContextRepo";

const mockedLoad = loadDecisionHistory as unknown as ReturnType<typeof vi.fn>;
const mockedLoadCompleted = loadCompletedSessionsForDates as unknown as ReturnType<typeof vi.fn>;
const mockedCheckins = loadCheckinsForDates as unknown as ReturnType<typeof vi.fn>;
const mockedRaces = loadRaces as unknown as ReturnType<typeof vi.fn>;
const mockedObjective = loadObjective as unknown as ReturnType<typeof vi.fn>;

function renderHistoryPage() {
  return render(
    <MemoryRouter initialEntries={["/history"]}>
      <HistoryPage />
    </MemoryRouter>
  );
}

// Everything the athlete reads is rider French: no enum, no id, no engine vocabulary.
function expectNoInternals() {
  const text = document.querySelector("main")?.textContent ?? document.body.textContent ?? "";
  expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]|[a-z]+_[a-z]+|\bd-2\d|undefined|null|NaN/);
  expect(text).not.toMatch(/Confiance|Maintenir|Dernière séance|décisions? générées?|Cette saison/);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedLoadCompleted.mockResolvedValue([]);
  mockedCheckins.mockResolvedValue([]);
  mockedRaces.mockResolvedValue([]);
  mockedObjective.mockResolvedValue(null);
});

describe("HistoryPage — states", () => {
  it("shows a loading state before the history resolves", () => {
    mockedLoad.mockReturnValue(new Promise(() => {}));
    renderHistoryPage();
    expect(screen.getByText(/Chargement/)).toBeInTheDocument();
  });

  it("empty: the journey starts with the first check-in", async () => {
    mockedLoad.mockResolvedValue([]);
    renderHistoryPage();
    expect(await screen.findByText("Ton parcours commence avec ton premier check-in.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Faire mon check-in →" })).toHaveAttribute("href", "/today");
    expect(screen.queryByText(/depuis le/)).not.toBeInTheDocument();
  });

  it("shows the fixed generic error message on the repo's own HistoryLoadError", async () => {
    mockedLoad.mockRejectedValue(new Error("Impossible de charger l'historique. Réessaie."));
    renderHistoryPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de charger l'historique. Réessaie.");
  });

  it("never renders a raw/unexpected error message", async () => {
    mockedLoad.mockRejectedValue(new Error("permission denied for table decisions"));
    renderHistoryPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de charger l'historique. Réessaie.");
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("reads 120 decisions for the resolved athleteId, never a URL/user-supplied id", async () => {
    mockedLoad.mockResolvedValue([]);
    renderHistoryPage();
    await waitFor(() => expect(mockedLoad).toHaveBeenCalledWith("athlete-1", 120));
  });

  it("UX-02: no logout in the header (moved to Profil); Insights is reached from Historique", () => {
    mockedLoad.mockReturnValue(new Promise(() => {}));
    renderHistoryPage();
    expect(screen.queryByText("Déconnexion")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Insights/ })).toHaveAttribute("href", "/insights");
    expect(screen.getByRole("link", { name: "Historique" })).toHaveAttribute("aria-current", "page");
  });
});

describe("HistoryPage — reads", () => {
  it("one batched completed-session and check-in read, for the unique decision dates — no N+1", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    renderHistoryPage();
    await waitFor(() => expect(mockedLoadCompleted).toHaveBeenCalledTimes(1));
    expect(mockedLoadCompleted).toHaveBeenCalledWith("athlete-1", ["2026-09-29", "2026-09-28", "2026-09-24"]);
    expect(mockedCheckins).toHaveBeenCalledWith("athlete-1", ["2026-09-29", "2026-09-28", "2026-09-24"]);
  });

  it("a completed-session read failure is the same generic error, never a partial success", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    mockedLoadCompleted.mockRejectedValue(new Error("permission denied for table completed_sessions"));
    renderHistoryPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de charger l'historique. Réessaie.");
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("check-ins, races and objective are best-effort: their failure only hides their own lines", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    mockedCheckins.mockRejectedValue(new Error("x"));
    mockedRaces.mockRejectedValue(new Error("x"));
    mockedObjective.mockRejectedValue(new Error("x"));
    renderHistoryPage();
    expect(await screen.findByRole("heading", { name: "Lundi 28 septembre" })).toBeInTheDocument();
    expect(screen.queryByText("Ton état du jour")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("HistoryPage — the journey (UX-07)", () => {
  it("hero: 'Ton parcours évolue avec tes décisions' and the declared objective", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    mockedObjective.mockResolvedValue("Performance en course");
    renderHistoryPage();
    expect(await screen.findByText("Objectif : Performance en course")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ton parcoursévolue avec tes décisions");
  });

  it("hero: the next race under 120 days replaces the objective", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    mockedObjective.mockResolvedValue("Performance en course");
    mockedRaces.mockResolvedValue([{ eventName: "iXS Lenzerheide", startDate: "2026-10-11", endDate: "2026-10-12", priority: "A", location: null, raceFormat: null }]);
    renderHistoryPage();
    expect(await screen.findByText("⚑ Prochaine course · iXS Lenzerheide · J-12")).toBeInTheDocument();
    expect(screen.queryByText(/Objectif :/)).not.toBeInTheDocument();
  });

  it("three zones; one card per day even with several decisions; no timestamp on the card", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    mockedCheckins.mockResolvedValue([checkin("2026-09-29")]);
    renderHistoryPage();

    const todayZone = await screen.findByRole("region", { name: "Aujourd'hui" });
    const weekZone = screen.getByRole("region", { name: "Cette semaine" });
    const olderZone = screen.getByRole("region", { name: "Plus ancien" });
    expect(within(todayZone).getAllByRole("article")).toHaveLength(1);
    expect(within(weekZone).getAllByRole("article")).toHaveLength(1);
    expect(within(olderZone).getByText("Septembre")).toBeInTheDocument();

    const monday = within(weekZone).getByRole("article");
    const mainPart = monday.cloneNode(true) as HTMLElement;
    mainPart.querySelector("details")?.remove();
    expect(mainPart.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    expectNoInternals();
  });

  it("today, no session planned: the mission, 'Aucune séance prévue ce jour-là', the why and the check-in as declared", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    mockedCheckins.mockResolvedValue([checkin("2026-09-29")]);
    renderHistoryPage();

    const card = within(await screen.findByRole("region", { name: "Aujourd'hui" })).getByRole("article");
    expect(within(card).getByRole("heading", { name: "Mardi 29 septembre" })).toBeInTheDocument();
    expect(within(card).getByText("Prêt")).toBeInTheDocument();
    expect(within(card).getByText("Mission du jour")).toBeInTheDocument();
    expect(within(card).getByText("Aucune séance prévue ce jour-là.")).toBeInTheDocument();
    expect(within(card).getByText("Pourquoi ?")).toBeInTheDocument();
    expect(within(card).getByText("Ton état du jour")).toBeInTheDocument();
    expect(within(card).getByText("7 h")).toBeInTheDocument();
    expect(within(card).getByText("6/10")).toBeInTheDocument();
    expect(within(card).queryByText(/non enregistrée|Séance à venir/)).not.toBeInTheDocument();
  });

  it("a re-evaluated safety day: health signal, planned → adapted, why, 'Séance non enregistrée', re-evaluations with their times", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    renderHistoryPage();

    const card = within(await screen.findByRole("region", { name: "Cette semaine" })).getByRole("article");
    expect(within(card).getByText("Signal actif")).toBeInTheDocument();
    expect(within(card).getByText("Signal santé")).toBeInTheDocument();
    // The mission title, the adapted line and the last re-evaluation (folded).
    expect(within(card).getAllByText("Repos")).toHaveLength(3);
    expect(within(card).getByText("NALYNT a adapté ton plan")).toBeInTheDocument();
    expect(within(card).getByText("Aérobie base · charge modérée · 45 min")).toBeInTheDocument();
    expect(within(card).getByText(/récupération devient prioritaire/)).toBeInTheDocument();
    expect(within(card).getByText("Séance non enregistrée")).toBeInTheDocument();
    expect(within(card).queryByText(/Tu n'as pas fait/)).not.toBeInTheDocument();

    await userEvent.click(within(card).getByText("Journée réévaluée 2 fois"));
    const links = within(card.querySelector("details")!).getAllByRole("link");
    expect(links.map((link) => link.textContent?.replace(/\d{2}:\d{2}/, "HH:MM"))).toEqual([
      "Première décision · HH:MMDH technique · charge modérée→",
      "Réévaluation · HH:MMDH technique · charge légère→",
      "Réévaluation · HH:MMRepos→",
    ]);
    expect(links[0]).toHaveAttribute("href", "/history/d-28a");
    expect(within(card).getByRole("link", { name: "Voir le détail de la journée →" })).toHaveAttribute("href", "/history/d-28c");
  });

  it("an adapted day (UX-04 wording) and a recorded session", async () => {
    mockedLoad.mockResolvedValue([decision("m", "2026-09-28", "08:00", MODIFY_PLAN)]);
    mockedLoadCompleted.mockResolvedValue([{ ...completed("2026-09-28", "done", 140), decision_id: "m", rpe: 6, post_leg_fatigue: 5 }]);
    renderHistoryPage();

    const card = within(await screen.findByRole("region", { name: "Cette semaine" })).getByRole("article");
    expect(within(card).getByText("DH technique · charge modérée · 4 h")).toBeInTheDocument();
    // The adapted line, and the realisation's "Prévu" (what NALYNT asked that day).
    expect(within(card).getAllByText("DH technique · charge légère · 2 h 30")).toHaveLength(2);
    expect(within(card).getByText("Signal détecté : fatigue jambes élevée. NALYNT ajuste la charge pour préserver ton objectif.")).toBeInTheDocument();
    // UX-08 — the realisation, as facts: what was asked, what was done, effort, legs after.
    expect(within(card).getByText("Réalisation")).toBeInTheDocument();
    expect(within(card).getByText("✓ Séance réalisée")).toBeInTheDocument();
    const rows = [...card.querySelectorAll("dl div")].map((row) => row.textContent?.replace(/ /g, " "));
    expect(rows).toEqual(["PrévuDH technique · charge légère · 2 h 30", "RéaliséDH technique · 2 h 20", "Effort6/10", "Jambes après5/10"]);
    expect(card.textContent).not.toMatch(/bonne séance|mauvaise séance|performance améliorée/i);
  });

  it("older days are compact lines grouped by month", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    mockedLoadCompleted.mockResolvedValue([completed("2026-09-24", "partial")]);
    renderHistoryPage();

    const older = await screen.findByRole("region", { name: "Plus ancien" });
    const row = within(older).getByRole("link");
    expect(row).toHaveAttribute("href", "/history/d-24");
    expect(row).toHaveTextContent("Jeu. 24");
    expect(row).toHaveTextContent("DH technique");
    expect(row).toHaveTextContent("Conforme au plan");
    expect(row).toHaveTextContent("◐ Séance partiellement réalisée");
  });

  it("'Ton parcours · depuis le …': plain counts, no season, no score", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS);
    renderHistoryPage();

    const summary = await screen.findByRole("region", { name: "Ton parcours" });
    expect(within(summary).getByText("depuis le 24 septembre")).toBeInTheDocument();
    expect(summary).toHaveTextContent("3journées analysées");
    expect(summary).toHaveTextContent("0adaptations");
    expect(summary).toHaveTextContent("1repos sécurité");
    expect(summary).toHaveTextContent("0séances enregistrées");
    expect(summary).toHaveTextContent("2séances non enregistrées");
    expect(summary.textContent).not.toMatch(/%|score|niveau|progression/i);
  });

  it("a planned session today without a record is 'Séance à venir', never 'non enregistrée'", async () => {
    mockedLoad.mockResolvedValue([decision("t", "2026-09-29", "08:00", KEEP_PLAN)]);
    renderHistoryPage();

    const card = within(await screen.findByRole("region", { name: "Aujourd'hui" })).getByRole("article");
    expect(within(card).getByText("Séance à venir")).toBeInTheDocument();
    expect(within(card).getByText("Ta séance est restée conforme au plan.")).toBeInTheDocument();
    expect(within(card).queryByText(/non enregistrée/)).not.toBeInTheDocument();
  });

  it("no decision today: invites the check-in, the rest of the journey stays", async () => {
    mockedLoad.mockResolvedValue(JOURNEY_ROWS.slice(1));
    renderHistoryPage();

    const todayZone = await screen.findByRole("region", { name: "Aujourd'hui" });
    expect(within(todayZone).getByText("Ta journée n'a pas encore été analysée.")).toBeInTheDocument();
    expect(within(todayZone).getByRole("link", { name: "Faire mon check-in →" })).toHaveAttribute("href", "/today");
    expect(screen.getByRole("region", { name: "Cette semaine" })).toBeInTheDocument();
  });
});
