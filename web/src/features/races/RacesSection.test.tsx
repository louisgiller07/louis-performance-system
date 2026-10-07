import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RacesSection } from "./RacesSection";

// A09 — « Tes courses »: list, create, edit, delete; A+ and stored formats never silently converted; no « Reconstruire ».
const repo = vi.hoisted(() => ({ loadRaces: vi.fn(), createRace: vi.fn(), updateRace: vi.fn(), deleteRace: vi.fn() }));
vi.mock("./raceRepo", async () => {
  const actual = await vi.importActual<typeof import("./raceRepo")>("./raceRepo");
  return { ...actual, ...repo };
});
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ athleteId: "athlete-1" }) }));
vi.mock("../../lib/simulationClock", () => ({ useEffectiveToday: () => "2026-10-07" }));

const UPCOMING_A_PLUS = { id: "r1", eventName: "Swiss Cup Leysin", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A_PLUS", raceFormat: "SWISS_CUP" };
const RECENT = { id: "r0", eventName: "Course locale", startDate: "2026-09-27", endDate: "2026-09-27", priority: "C", raceFormat: "OTHER" };
const SAVED =
  "Ta course est prise en compte dès maintenant dans ton coaching quotidien. Pendant la bêta, contacte-nous si tu veux que nous reconstruisions aussi ta préparation autour de cette course.";

beforeEach(() => {
  vi.resetAllMocks();
  repo.loadRaces.mockResolvedValue([RECENT, UPCOMING_A_PLUS]);
  repo.deleteRace.mockResolvedValue(undefined);
});
const section = () => screen.getByRole("region", { name: "Tes courses" });

describe("A09 — Tes courses", () => {
  it("lists upcoming races (editable) and the last 30 days (delete only); A+ and a stored format stay readable", async () => {
    render(<RacesSection />);
    expect(await within(section()).findByText("Swiss Cup Leysin")).toBeInTheDocument();
    expect(repo.loadRaces).toHaveBeenCalledWith("athlete-1", "2026-09-07");
    expect(within(section()).getByText("A+ · Swiss Cup")).toBeInTheDocument();
    expect(within(section()).getByRole("button", { name: "Modifier Swiss Cup Leysin" })).toBeInTheDocument();
    expect(within(section()).getByText("Courses récentes")).toBeInTheDocument();
    expect(within(section()).getByText("C — course secondaire / entraînement · Autre format")).toBeInTheDocument();
    expect(within(section()).queryByRole("button", { name: "Modifier Course locale" })).toBeNull();
    expect(within(section()).getByRole("button", { name: "Supprimer Course locale" })).toBeInTheDocument();
  });

  it("create: a 2-day race — the end follows the start, written through the repo, the beta message (no « Reconstruire »)", async () => {
    const user = userEvent.setup();
    repo.createRace.mockImplementation(async (_athlete: string, d: object) => ({ id: "n1", ...d }));
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Ajouter une course" }));
    await user.type(within(section()).getByLabelText("Nom de la course"), "Hot Trail Bike Park");
    await user.clear(within(section()).getByLabelText("Début"));
    await user.type(within(section()).getByLabelText("Début"), "2026-10-17");
    expect(within(section()).getByLabelText(/^Fin/)).toHaveValue("2026-10-18");
    expect(within(section()).getByLabelText(/^Fin/)).toBeDisabled();
    expect(within(section()).getByLabelText("Importance").querySelectorAll("option")).toHaveLength(3); // A / B / C — never a new A+
    await user.selectOptions(within(section()).getByLabelText("Importance"), "A");
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.createRace).toHaveBeenCalledWith("athlete-1", { eventName: "Hot Trail Bike Park", startDate: "2026-10-17", endDate: "2026-10-18", priority: "A", raceFormat: "HOT_TRAIL_2DAY" })
    );
    expect(within(section()).getByRole("status")).toHaveTextContent(SAVED);
    expect(within(section()).getByText("Hot Trail Bike Park")).toBeInTheDocument();
    expect(screen.queryByText(/Reconstrui/)).toBeNull();
  });

  it("« Autre format »: the honest hint, a free end date; a race entirely past is refused (nothing written)", async () => {
    const user = userEvent.setup();
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Ajouter une course" }));
    await user.selectOptions(within(section()).getByLabelText(/^Format/), "OTHER");
    expect(within(section()).getByText("Pas d'affûtage spécifique automatique les jours précédents.")).toBeInTheDocument();
    expect(within(section()).getByLabelText(/^Fin/)).toBeEnabled();
    await user.type(within(section()).getByLabelText("Nom de la course"), "Vieille course");
    for (const label of [/^Début/, /^Fin/]) {
      await user.clear(within(section()).getByLabelText(label));
      await user.type(within(section()).getByLabelText(label), "2026-10-01");
    }
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    expect(within(section()).getByRole("alert")).toHaveTextContent("Cette course est déjà terminée");
    expect(repo.createRace).not.toHaveBeenCalled();
  });

  it("edit an existing A+ / Swiss Cup race: saved unchanged keeps A_PLUS and SWISS_CUP (never silently converted)", async () => {
    const user = userEvent.setup();
    repo.updateRace.mockImplementation(async (id: string, d: object) => ({ id, ...d }));
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Modifier Swiss Cup Leysin" }));
    expect(within(section()).getByLabelText("Importance")).toHaveValue("A_PLUS");
    expect(within(section()).getByLabelText(/^Format/)).toHaveValue("SWISS_CUP");
    await user.click(within(section()).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.updateRace).toHaveBeenCalledWith("r1", { eventName: "Swiss Cup Leysin", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A_PLUS", raceFormat: "SWISS_CUP" })
    );
  });

  it("delete: confirmed, the race leaves the list", async () => {
    const user = userEvent.setup();
    render(<RacesSection />);
    await user.click(await within(section()).findByRole("button", { name: "Supprimer Swiss Cup Leysin" }));
    expect(within(section()).getByText("Supprimer « Swiss Cup Leysin » ?")).toBeInTheDocument();
    await user.click(within(section()).getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(repo.deleteRace).toHaveBeenCalledWith("r1"));
    expect(within(section()).queryByText("Swiss Cup Leysin")).toBeNull();
    expect(within(section()).getByText("Aucune course à venir.")).toBeInTheDocument();
  });
});
