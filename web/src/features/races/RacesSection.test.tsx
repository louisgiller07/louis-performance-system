import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RacesSection } from "./RacesSection";

// A09 — « Tes courses »: list, create, edit, delete; A+ and stored formats never silently converted; no « Reconstruire ».
// SPORT-RACE-01P.3 — the rider names the competition (never a preselected « 2 jours »); a protocol only for the Hot Trail
// Series or iXS chosen explicitly; any other competition (Swiss, UCI, French national or regional) is saved and visible,
// its specific preparation said to be undefined.
const repo = vi.hoisted(() => ({ loadRaces: vi.fn(), createRace: vi.fn(), updateRace: vi.fn(), deleteRace: vi.fn() }));
vi.mock("./raceRepo", async () => {
  const actual = await vi.importActual<typeof import("./raceRepo")>("./raceRepo");
  return { ...actual, ...repo };
});
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ athleteId: "athlete-1" }) }));
vi.mock("../../lib/simulationClock", () => ({ useEffectiveToday: () => "2026-10-07" }));

const UPCOMING_A_PLUS = { id: "r1", eventName: "Swiss Cup Leysin", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A_PLUS", raceFormat: "SWISS_CUP", series: null };
const LEGACY_TWO_DAYS = { id: "r2", eventName: "Course de Champéry", startDate: "2026-10-31", endDate: "2026-11-01", priority: "A", raceFormat: "HOT_TRAIL_2DAY", series: null };
const EXPLICIT_HOT_TRAIL = { id: "r3", eventName: "Hot Trail Bike Park", startDate: "2026-11-07", endDate: "2026-11-08", priority: "A", raceFormat: "HOT_TRAIL_2DAY", series: "HOT_TRAIL_SERIES" };
const RECENT = { id: "r0", eventName: "Course locale", startDate: "2026-09-27", endDate: "2026-09-27", priority: "C", raceFormat: "OTHER", series: null };
const SAVED =
  "Ta course est prise en compte dès maintenant dans ton coaching quotidien. Pendant la bêta, contacte-nous si tu veux que nous reconstruisions aussi ta préparation autour de cette course.";
const NO_PROTOCOL_HINT = "Préparation spécifique non définie pour cette compétition : NALYNT ne planifie pas de séance les jours qui la précèdent.";

beforeEach(() => {
  vi.resetAllMocks();
  repo.loadRaces.mockResolvedValue([RECENT, UPCOMING_A_PLUS, LEGACY_TWO_DAYS, EXPLICIT_HOT_TRAIL]);
  repo.deleteRace.mockResolvedValue(undefined);
});
const section = () => screen.getByRole("region", { name: "Tes courses" });
const competition = () => within(section()).getByLabelText(/^Compétition/);

describe("A09 — Tes courses", () => {
  it("lists upcoming races (editable) and the last 30 days (delete only): the competition, else the stored format, and whether a specific preparation exists", async () => {
    render(<RacesSection />);
    expect(await within(section()).findByText("Swiss Cup Leysin")).toBeInTheDocument();
    expect(repo.loadRaces).toHaveBeenCalledWith("athlete-1", "2026-09-07");
    expect(within(section()).getByText("A+ · Swiss Cup")).toBeInTheDocument();
    expect(within(section()).getByText("A — objectif principal · Course sur 2 jours — compétition à préciser")).toBeInTheDocument();
    expect(within(section()).getByText("A — objectif principal · Hot Trail Series")).toBeInTheDocument();
    expect(within(section()).getByText("Préparation : protocole Hot Trail")).toBeInTheDocument();
    expect(within(section()).getAllByText("Préparation spécifique non définie")).toHaveLength(3); // Swiss Cup, legacy 2 days, recent
    expect(within(section()).getByRole("button", { name: "Modifier Swiss Cup Leysin" })).toBeInTheDocument();
    expect(within(section()).getByText("Courses récentes")).toBeInTheDocument();
    expect(within(section()).getByText("C — course secondaire / entraînement · Autre format")).toBeInTheDocument();
    expect(within(section()).queryByRole("button", { name: "Modifier Course locale" })).toBeNull();
    expect(within(section()).getByRole("button", { name: "Supprimer Course locale" })).toBeInTheDocument();
  });

  it("create: no competition preselected (saving without one is refused); the Hot Trail Series chosen explicitly — its protocol shown, the end follows the start, written through the repo with its code, the beta message (no « Reconstruire »)", async () => {
    const user = userEvent.setup();
    repo.createRace.mockImplementation(async (_athlete: string, d: object) => ({ id: "n1", ...d }));
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Ajouter une course" }));
    expect(competition()).toHaveValue("");
    expect(within(section()).queryByText(/protocole Hot Trail\./)).toBeNull();
    await user.type(within(section()).getByLabelText("Nom de la course"), "Hot Trail Bike Park");
    await user.clear(within(section()).getByLabelText("Début"));
    await user.type(within(section()).getByLabelText("Début"), "2026-10-17");
    expect(within(section()).getByLabelText(/^Fin/)).toBeEnabled();
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    expect(within(section()).getByRole("alert")).toHaveTextContent("Choisis la compétition.");
    expect(repo.createRace).not.toHaveBeenCalled();

    await user.selectOptions(competition(), "HOT_TRAIL_SERIES");
    expect(within(section()).getByText("Préparation spécifique : les 7 jours avant la course suivent le protocole Hot Trail.")).toBeInTheDocument();
    expect(within(section()).getByLabelText(/^Fin/)).toHaveValue("2026-10-18");
    expect(within(section()).getByLabelText(/^Fin/)).toBeDisabled();
    expect(within(section()).getByLabelText("Importance").querySelectorAll("option")).toHaveLength(3); // A / B / C — never a new A+
    await user.selectOptions(within(section()).getByLabelText("Importance"), "A");
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.createRace).toHaveBeenCalledWith("athlete-1", { eventName: "Hot Trail Bike Park", startDate: "2026-10-17", endDate: "2026-10-18", priority: "A", raceFormat: "HOT_TRAIL_2DAY", series: "HOT_TRAIL_SERIES" })
    );
    expect(within(section()).getByRole("status")).toHaveTextContent(SAVED);
    expect(within(section()).getAllByText("Hot Trail Bike Park")).toHaveLength(2);
    expect(screen.queryByText(/Reconstrui/)).toBeNull();
  });

  it("the competitions offered: Hot Trail Series, iXS, Swiss, UCI, and the French ones (Coupe de France, Championnats de France, regional, other) — never a duration standing for a protocol", async () => {
    const user = userEvent.setup();
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Ajouter une course" }));
    expect([...competition().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Choisis la compétition",
      "Hot Trail Series (Swiss DH Cup) — 2 jours : entraînements et chrono, puis finale",
      "iXS (European Cup, DHC) — 3 jours, practice officielle la veille",
      "Autre course en Suisse",
      "Coupe du monde UCI",
      "Championnats du monde UCI",
      "Coupe de France DH / DHI",
      "Championnats de France DH / DHI",
      "Coupe ou championnat régional DH (France)",
      "Autre course DH en France",
      "Autre compétition",
    ]);
  });

  it("a Coupe de France DH over two days: saved and visible, no protocol (OTHER, its code kept), free dates, the honest hint", async () => {
    const user = userEvent.setup();
    repo.createRace.mockImplementation(async (_athlete: string, d: object) => ({ id: "n2", ...d }));
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Ajouter une course" }));
    await user.type(within(section()).getByLabelText("Nom de la course"), "Coupe de France DH Loudenvielle");
    await user.selectOptions(competition(), "FR_COUPE_DE_FRANCE_DH");
    expect(within(section()).getByText(NO_PROTOCOL_HINT)).toBeInTheDocument();
    expect(within(section()).getByLabelText(/^Fin/)).toBeEnabled();
    fireEvent.change(within(section()).getByLabelText(/^Début/), { target: { value: "2026-10-24" } });
    fireEvent.change(within(section()).getByLabelText(/^Fin/), { target: { value: "2026-10-25" } });
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.createRace).toHaveBeenCalledWith("athlete-1", { eventName: "Coupe de France DH Loudenvielle", startDate: "2026-10-24", endDate: "2026-10-25", priority: "B", raceFormat: "OTHER", series: "FR_COUPE_DE_FRANCE_DH" })
    );
    expect(within(section()).getByText("B — course importante · Coupe de France DH / DHI")).toBeInTheDocument();
  });

  it("a race entirely past is refused (nothing written)", async () => {
    const user = userEvent.setup();
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Ajouter une course" }));
    await user.selectOptions(competition(), "FR_REGIONAL_DH");
    await user.type(within(section()).getByLabelText("Nom de la course"), "Vieille course");
    for (const label of [/^Début/, /^Fin/]) {
      await user.clear(within(section()).getByLabelText(label));
      await user.type(within(section()).getByLabelText(label), "2026-10-01");
    }
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    expect(within(section()).getByRole("alert")).toHaveTextContent("Cette course est déjà terminée");
    expect(repo.createRace).not.toHaveBeenCalled();
  });

  it("edit an existing A+ / Swiss Cup race: its stored kind stays selectable « (existant) »; saved unchanged keeps A_PLUS, SWISS_CUP and its series (never silently converted)", async () => {
    const user = userEvent.setup();
    repo.updateRace.mockImplementation(async (id: string, d: object) => ({ id, ...d }));
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Modifier Swiss Cup Leysin" }));
    expect(within(section()).getByLabelText("Importance")).toHaveValue("A_PLUS");
    expect(competition()).toHaveValue("__stored__");
    expect(within(competition()).getByRole("option", { name: "Swiss Cup (existant)" })).toBeInTheDocument();
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.updateRace).toHaveBeenCalledWith("r1", { eventName: "Swiss Cup Leysin", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A_PLUS", raceFormat: "SWISS_CUP", series: null })
    );
  });

  it("a legacy « 2 jours » race (HOT_TRAIL_2DAY, no competition): never presented as a protocol; kept as is when saved unchanged; the protocol only once the rider chooses the Hot Trail Series", async () => {
    const user = userEvent.setup();
    repo.updateRace.mockImplementation(async (id: string, d: object) => ({ id, ...d }));
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Modifier Course de Champéry" }));
    expect(competition()).toHaveValue("__stored__");
    expect(within(competition()).getByRole("option", { name: "Course sur 2 jours — compétition à préciser (existant)" })).toBeInTheDocument();
    expect(within(section()).getByText(NO_PROTOCOL_HINT)).toBeInTheDocument();
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.updateRace).toHaveBeenLastCalledWith("r2", { eventName: "Course de Champéry", startDate: "2026-10-31", endDate: "2026-11-01", priority: "A", raceFormat: "HOT_TRAIL_2DAY", series: null })
    );

    await user.click(await within(section()).findByRole("button", { name: "Modifier Course de Champéry" }));
    await user.selectOptions(competition(), "HOT_TRAIL_SERIES");
    expect(within(section()).getByText("Préparation spécifique : les 7 jours avant la course suivent le protocole Hot Trail.")).toBeInTheDocument();
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.updateRace).toHaveBeenLastCalledWith("r2", { eventName: "Course de Champéry", startDate: "2026-10-31", endDate: "2026-11-01", priority: "A", raceFormat: "HOT_TRAIL_2DAY", series: "HOT_TRAIL_SERIES" })
    );
  });

  it("delete: confirmed, the race leaves the list", async () => {
    const user = userEvent.setup();
    repo.loadRaces.mockResolvedValue([RECENT, UPCOMING_A_PLUS]);
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Supprimer Swiss Cup Leysin" }));
    expect(within(section()).getByText("Supprimer « Swiss Cup Leysin » ?")).toBeInTheDocument();
    await user.click(within(section()).getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(repo.deleteRace).toHaveBeenCalledWith("r1"));
    expect(within(section()).queryByText("Swiss Cup Leysin")).toBeNull();
    expect(within(section()).getByText("Aucune course à venir.")).toBeInTheDocument();
  });
});
