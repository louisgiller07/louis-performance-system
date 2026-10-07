import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PerformanceSetup } from "./PerformanceSetup";
import { EQUIPMENT_OPTIONS, TERRAIN_OPTIONS, TECHNICAL_PRIORITY_OPTIONS, STRENGTH_EXPERIENCE_TIER_OPTIONS } from "./performanceSetupOptions";

// UX-10B-1 — "Affiner ton profil": six sections, each with what NALYNT
// knows, one [Modifier] and its own save through the existing repositories.
// The current plan is never modified; a new preparation is built on demand
// (V0.5_036 / V0.5_045 gates kept).

function renderPage() {
  return render(
    <MemoryRouter>
      <PerformanceSetup />
    </MemoryRouter>
  );
}

const repo = vi.hoisted(() => ({
  loadPerformanceSetupAnswers: vi.fn(),
  savePerformanceSetup: vi.fn(),
  loadAvailabilityWindows: vi.fn(),
  saveAvailabilityWindows: vi.fn(),
  loadOnboardingAnswers: vi.fn(),
  saveDiscipline: vi.fn(),
  saveCompetitionLevel: vi.fn(),
  savePrimaryGoal: vi.fn(),
  saveWeeklyTrainingHours: vi.fn(),
  saveRidingDays: vi.fn(),
  getActivePlanVersionId: vi.fn(),
  getTrainingPlanDrafts: vi.fn(),
}));

vi.mock("./performanceSetupRepo", async () => {
  const actual = await vi.importActual<typeof import("./performanceSetupRepo")>("./performanceSetupRepo");
  return { ...actual, loadPerformanceSetupAnswers: repo.loadPerformanceSetupAnswers, savePerformanceSetup: repo.savePerformanceSetup };
});
vi.mock("./availabilityRepo", async () => {
  const actual = await vi.importActual<typeof import("./availabilityRepo")>("./availabilityRepo");
  return { ...actual, loadAvailabilityWindows: repo.loadAvailabilityWindows, saveAvailabilityWindows: repo.saveAvailabilityWindows };
});
vi.mock("../athleteOnboarding/athleteOnboardingRepo", async () => {
  const actual = await vi.importActual<typeof import("../athleteOnboarding/athleteOnboardingRepo")>("../athleteOnboarding/athleteOnboardingRepo");
  return {
    ...actual,
    loadOnboardingAnswers: repo.loadOnboardingAnswers,
    saveDiscipline: repo.saveDiscipline,
    saveCompetitionLevel: repo.saveCompetitionLevel,
    savePrimaryGoal: repo.savePrimaryGoal,
    saveWeeklyTrainingHours: repo.saveWeeklyTrainingHours,
    saveRidingDays: repo.saveRidingDays,
  };
});
vi.mock("../trainingPlanReview/trainingPlanReviewRepo", () => ({ getActivePlanVersionId: repo.getActivePlanVersionId, getTrainingPlanDrafts: repo.getTrainingPlanDrafts }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ athleteId: "athlete-1" }) }));
// A09 — « Tes courses » is mounted in the page; its own behaviour is covered by races/RacesSection.test.tsx.
vi.mock("../races/raceRepo", async () => {
  const actual = await vi.importActual<typeof import("../races/raceRepo")>("../races/raceRepo");
  return { ...actual, loadRaces: vi.fn(async () => []) };
});

const PROFILE = {
  equipment: ["dumbbells"],
  terrainAccess: ["flow_trail"],
  strengths: ["braking"],
  weaknesses: ["cornering"],
  priorityAreas: [],
  strengthExperienceTier: "intermediate",
  dhTechnicalTier: null,
  seasonObjective: "Top 10 aux Championnats suisses",
};
const ONBOARDING = { discipline: "Downhill", competitionLevel: "Amateur racer", primaryGoal: "Race performance", weeklyTrainingHours: "5-10h", preferredRidingDays: ["Saturday", "Sunday"] };
const WINDOWS = [
  { id: "w1", dayOfWeek: 6 as const, startTime: "08:00", endTime: "18:00", label: null, activity: "any" as const },
  { id: "w2", dayOfWeek: 0 as const, startTime: "08:00", endTime: "18:00", label: null, activity: "any" as const },
  { id: "w3", dayOfWeek: 2 as const, startTime: "17:00", endTime: "21:00", label: null, activity: "any" as const },
];
const TYPED_WINDOWS = [
  { id: "t1", dayOfWeek: 2 as const, startTime: "18:00", endTime: "19:30", label: null, activity: "physical" as const },
  { id: "t2", dayOfWeek: 6 as const, startTime: "08:00", endTime: "18:00", label: null, activity: "riding" as const },
  { id: "t3", dayOfWeek: 0 as const, startTime: "08:00", endTime: "18:00", label: null, activity: "riding" as const },
];

beforeEach(() => {
  vi.resetAllMocks();
  repo.loadPerformanceSetupAnswers.mockResolvedValue(PROFILE);
  repo.savePerformanceSetup.mockResolvedValue(undefined);
  repo.loadAvailabilityWindows.mockResolvedValue(WINDOWS);
  repo.saveAvailabilityWindows.mockResolvedValue(WINDOWS);
  repo.loadOnboardingAnswers.mockResolvedValue(ONBOARDING);
  for (const save of [repo.saveDiscipline, repo.saveCompetitionLevel, repo.savePrimaryGoal, repo.saveWeeklyTrainingHours, repo.saveRidingDays]) save.mockResolvedValue(undefined);
  repo.getActivePlanVersionId.mockResolvedValue("active-plan");
  repo.getTrainingPlanDrafts.mockResolvedValue([]);
});

const section = (name: string) => screen.getByRole("region", { name });
const generate = () => screen.getByRole("button", { name: /Reconstruire ma préparation|Construire ma préparation/ });

describe("Affiner ton profil — what NALYNT knows (summaries)", () => {
  it("six sections, each summarising the saved answers in French — never a raw value", async () => {
    const { container } = renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Affiner ton profil" })).toBeInTheDocument();
    expect(screen.getByText("Ton plan actuel reste inchangé : tes réglages servent à construire ta prochaine préparation.")).toBeInTheDocument();
    expect(screen.getByText("Plus ton profil est précis, plus ta préparation correspond à ta réalité.")).toBeInTheDocument();

    expect(within(section("Ta pratique")).getByText("Descente (DH) · Compétiteur amateur")).toBeInTheDocument();
    expect(within(section("Ta pratique")).getByText("Objectif : Performance en course")).toBeInTheDocument();
    expect(within(section("Ta pratique")).getByText("5 à 10 h par semaine")).toBeInTheDocument();
    // Legacy "any" windows serve riding for the planner (Tue 17–21 h included): the days come from the slots.
    expect(within(section("Ta pratique")).getByText("Roule mardi, samedi, dimanche · d'après tes créneaux")).toBeInTheDocument();
    expect(within(section("Ta pratique")).getByText("Objectif de saison : Top 10 aux Championnats suisses")).toBeInTheDocument();
    expect(within(section("Ton terrain")).getByText("Flow trail")).toBeInTheDocument();
    expect(within(section("Ton matériel")).getByText("Haltères")).toBeInTheDocument();
    expect(within(section("Tes points forts")).getByText("Aucune priorité de pilotage : NALYNT fait tourner les thèmes techniques.")).toBeInTheDocument();
    expect(within(section("Tes points forts")).getByText("Renfo : Intermédiaire")).toBeInTheDocument();
    expect(within(section("Tes points forts")).getByText("Niveau technique : pas encore renseigné.")).toBeInTheDocument();
    expect(within(section("Tes créneaux")).getByText("sam., dim. · 8 h – 18 h")).toBeInTheDocument();
    expect(within(section("Tes créneaux")).getByText("mar. · 17 h – 21 h")).toBeInTheDocument();

    const text = container.textContent ?? "";
    for (const raw of ["Downhill", "Amateur racer", "flow_trail", "dumbbells", "braking", "intermediate", "5-10h", "Saturday"]) expect(text).not.toContain(raw);
  });

  it("A09 — « Tes courses » sits between « Tes créneaux » and « Ta préparation »", async () => {
    renderPage();
    const races = await screen.findByRole("region", { name: "Tes courses" });
    expect(await within(races).findByText("Aucune course à venir.")).toBeInTheDocument();
    const order = [section("Tes créneaux"), races, generate()];
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("empty answers read honestly: bodyweight, no terrain yet, no slot yet", async () => {
    repo.loadPerformanceSetupAnswers.mockResolvedValue({ ...PROFILE, equipment: [], terrainAccess: [] });
    repo.loadAvailabilityWindows.mockResolvedValue([]);
    renderPage();
    expect(await within(await screen.findByRole("region", { name: "Ton matériel" })).findByText("Au poids du corps")).toBeInTheDocument();
    expect(within(section("Ton terrain")).getByText(/Aucun terrain renseigné/)).toBeInTheDocument();
    expect(within(section("Tes créneaux")).getByText(/Aucun créneau/)).toBeInTheDocument();
  });

  it("a load failure shows an error, never an empty profile", async () => {
    repo.loadOnboardingAnswers.mockRejectedValue(new Error("x"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de charger ton profil. Réessaie.");
  });
});

describe("Affiner ton profil — one section at a time, its own save", () => {
  it("terrain: at least one, saved merged with the rest of the profile (nothing else erased)", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier ton terrain" }));
    const terrain = section("Ton terrain");
    await user.click(within(terrain).getByRole("button", { name: "Flow trail" }));
    expect(within(terrain).getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await user.click(within(terrain).getByRole("button", { name: "Sentier technique" }));
    await user.click(within(terrain).getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(repo.savePerformanceSetup).toHaveBeenCalledWith("athlete-1", { ...PROFILE, terrainAccess: ["technical_trail"] }));
    expect(await within(section("Ton terrain")).findByText("Sentier technique")).toBeInTheDocument();
    expect(within(section("Ton terrain")).getByRole("status")).toHaveTextContent("Enregistré. Ton plan actuel reste inchangé. Reconstruis ta préparation pour en tenir compte.");
    expect(within(section("Ton terrain")).getByRole("link", { name: "Aller à ta préparation ↓" })).toHaveAttribute("href", "#preparation");
  });

  it("points forts: strengths / to work on / priorities / renfo saved together", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier tes points forts" }));
    const strengths = section("Tes points forts");
    await user.click(within(within(strengths).getByRole("group", { name: "Tes priorités de pilotage" })).getAllByRole("button")[0]!);
    await user.click(within(strengths).getByRole("button", { name: "Avancé" }));
    await user.click(within(strengths).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.savePerformanceSetup).toHaveBeenCalledWith("athlete-1", { ...PROFILE, priorityAreas: [TECHNICAL_PRIORITY_OPTIONS[0]], strengthExperienceTier: "advanced" })
    );
  });

  it("Annuler discards the changes; a save error keeps the section open with the message", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier ton matériel" }));
    await user.click(within(section("Ton matériel")).getByRole("button", { name: "Barre" }));
    await user.click(within(section("Ton matériel")).getByRole("button", { name: "Annuler" }));
    expect(within(section("Ton matériel")).getByText("Haltères")).toBeInTheDocument();
    expect(repo.savePerformanceSetup).not.toHaveBeenCalled();

    repo.savePerformanceSetup.mockRejectedValue(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Modifier ton matériel" }));
    await user.click(within(section("Ton matériel")).getByRole("button", { name: "Barre" }));
    await user.click(within(section("Ton matériel")).getByRole("button", { name: "Enregistrer" }));
    expect(await within(section("Ton matériel")).findByRole("alert")).toHaveTextContent("Une erreur inattendue s'est produite. Réessaie.");
    expect(within(section("Ton matériel")).getByRole("button", { name: "Enregistrer" })).toBeInTheDocument();
  });

  it("every option is shown with its French label", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier tes points forts" }));
    for (const raw of [...TECHNICAL_PRIORITY_OPTIONS, ...STRENGTH_EXPERIENCE_TIER_OPTIONS]) expect(container.textContent).not.toContain(raw);
    await user.click(within(section("Tes points forts")).getByRole("button", { name: "Annuler" }));
    await user.click(screen.getByRole("button", { name: "Modifier ton terrain" }));
    for (const raw of TERRAIN_OPTIONS) expect(container.textContent).not.toContain(raw);
    await user.click(within(section("Ton terrain")).getByRole("button", { name: "Annuler" }));
    await user.click(screen.getByRole("button", { name: "Modifier ton matériel" }));
    for (const raw of EQUIPMENT_OPTIONS) expect(container.textContent).not.toContain(raw);
  });
});

describe("Affiner ton profil — Ta pratique (the first-run answers, now editable)", () => {
  it("only what changed is saved, through the onboarding repository; the season objective through the profile", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier ta pratique" }));
    const practice = section("Ta pratique");
    await user.click(within(practice).getByRole("button", { name: "Enduro" }));
    const objective = within(practice).getByLabelText("Ton objectif de saison (facultatif)");
    await user.clear(objective);
    await user.type(objective, "Podium Enduro Series");
    await user.click(within(practice).getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(repo.saveDiscipline).toHaveBeenCalledWith("athlete-1", "Enduro"));
    expect(repo.saveRidingDays).not.toHaveBeenCalled();
    expect(repo.saveCompetitionLevel).not.toHaveBeenCalled();
    expect(repo.savePrimaryGoal).not.toHaveBeenCalled();
    expect(repo.saveWeeklyTrainingHours).not.toHaveBeenCalled();
    expect(repo.savePerformanceSetup).toHaveBeenCalledWith("athlete-1", { ...PROFILE, seasonObjective: "Podium Enduro Series" });
    expect(await within(section("Ta pratique")).findByText("Enduro · Compétiteur amateur")).toBeInTheDocument();
    expect(within(section("Ta pratique")).getByRole("status")).toHaveTextContent("Ton plan actuel reste inchangé");
  });

});

// P1 riding days single source — after the first run the slots are the only truth; preferred_riding_days is never edited nor shown.
describe("Affiner ton profil — riding days come from the slots only", () => {
  it("contradiction: preferred_riding_days = [Monday], riding slots Sat + Sun (physical Tue) → only samedi, dimanche", async () => {
    repo.loadOnboardingAnswers.mockResolvedValue({ ...ONBOARDING, preferredRidingDays: ["Monday"] });
    repo.loadAvailabilityWindows.mockResolvedValue(TYPED_WINDOWS);
    renderPage();
    const line = await within(await screen.findByRole("region", { name: "Ta pratique" })).findByText("Roule samedi, dimanche · d'après tes créneaux");
    expect(line).toBeInTheDocument();
    expect(within(section("Ta pratique")).queryByText(/lundi|mardi/)).toBeNull();
  });

  it("editing « Ta pratique »: no riding-day chips, the slots' days read-only, saving never writes preferred_riding_days", async () => {
    const user = userEvent.setup();
    repo.loadAvailabilityWindows.mockResolvedValue(TYPED_WINDOWS);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier ta pratique" }));
    const practice = section("Ta pratique");
    for (const day of ["Lundi", "Samedi", "Dimanche"]) expect(within(practice).queryByRole("button", { name: day })).toBeNull();
    expect(within(practice).getByText("Roule samedi, dimanche · d'après tes créneaux")).toBeInTheDocument();
    expect(within(practice).getByText("Ils viennent de tes créneaux vélo : modifie-les dans Tes créneaux.")).toBeInTheDocument();
    await user.click(within(practice).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(section("Ta pratique")).getByRole("status")).toBeInTheDocument());
    expect(repo.saveRidingDays).not.toHaveBeenCalled();
  });

  it("physical slots only: never a riding day", async () => {
    repo.loadAvailabilityWindows.mockResolvedValue([TYPED_WINDOWS[0]]);
    renderPage();
    expect(await within(await screen.findByRole("region", { name: "Ta pratique" })).findByText("Aucun créneau vélo · d'après tes créneaux")).toBeInTheDocument();
  });

  it("« Modifier dans Tes créneaux » opens the slots; once they are saved, the summary follows them (never the old column)", async () => {
    const user = userEvent.setup();
    repo.loadAvailabilityWindows.mockResolvedValue(TYPED_WINDOWS);
    repo.saveAvailabilityWindows.mockResolvedValue([{ id: "n1", dayOfWeek: 3, startTime: "08:00", endTime: "11:00", label: null, activity: "riding" }]);
    renderPage();
    await user.click(await within(await screen.findByRole("region", { name: "Ta pratique" })).findByRole("button", { name: "Modifier dans Tes créneaux" }));
    const slots = section("Tes créneaux");
    await waitFor(() => expect(within(slots).getByRole("combobox", { name: "Physique — Lundi" })).toBeInTheDocument());
    await user.selectOptions(within(slots).getByRole("combobox", { name: "Physique — Lundi" }), "120");
    await user.click(within(slots).getByRole("button", { name: "Enregistrer mes disponibilités" }));
    await waitFor(() => expect(within(section("Ta pratique")).getByText("Roule mercredi · d'après tes créneaux")).toBeInTheDocument());
    expect(within(section("Ta pratique")).queryByText(/samedi|dimanche/)).toBeNull();
    expect(repo.saveRidingDays).not.toHaveBeenCalled();
  });
});

describe("Affiner ton profil — wording", () => {
  it("NALYNT uses what the rider declares: never 'te connaît', 'apprend', 'analyse' or 'intelligence'", async () => {
    const copy = await import("./refinePresentation");
    const all = JSON.stringify(Object.values(copy).filter((value) => typeof value !== "function"));
    expect(all).not.toMatch(/te conna[iî]t|apprend|analys|intelligen/i);
  });
});

describe("Affiner ton profil — Ta préparation (a new version, never the current plan)", () => {
  it("with an active plan: 'Reconstruire ma préparation', 4/6/8/12 weeks with 6 preselected", async () => {
    renderPage();
    await waitFor(() => expect(generate()).toHaveTextContent("Reconstruire ma préparation"));
    expect(screen.getByText(/Tu décides ensuite si tu la commences/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6 semaines" })).toHaveAttribute("aria-pressed", "true");
    for (const n of [4, 8, 12]) expect(screen.getByRole("button", { name: `${n} semaines` })).toHaveAttribute("aria-pressed", "false");
    expect(generate()).toBeEnabled();
  });

  it("without an active plan: 'Construire ma préparation'", async () => {
    repo.getActivePlanVersionId.mockResolvedValue(null);
    renderPage();
    await waitFor(() => expect(generate()).toHaveTextContent("Construire ma préparation"));
  });

  it("never while a section is being edited (unsaved changes), again once it is saved", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier ton terrain" }));
    expect(generate()).toBeDisabled();
    expect(screen.getByText("Enregistre ou annule ta modification en cours avant de construire ta préparation.")).toBeInTheDocument();
    await user.click(within(section("Ton terrain")).getByRole("button", { name: "Sentier technique" }));
    await user.click(within(section("Ton terrain")).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(generate()).toBeEnabled());
  });

  it("never without a saved slot", async () => {
    repo.loadAvailabilityWindows.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(generate()).toBeDisabled());
    expect(within(screen.getByRole("region", { name: "Ta préparation" })).getByText(/Aucun créneau/)).toBeInTheDocument();
  });

  it("slots: unsaved edits block, a successful save unblocks and refreshes the summary (BUG-V2-1 physical / riding)", async () => {
    const user = userEvent.setup();
    repo.saveAvailabilityWindows.mockResolvedValue([{ id: "w9", dayOfWeek: 1, startTime: "18:00", endTime: "20:00", label: null, activity: "physical" }]);
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier tes créneaux" }));
    const slots = section("Tes créneaux");
    await waitFor(() => expect(within(slots).getByRole("combobox", { name: "Physique — Lundi" })).toBeInTheDocument());
    await user.selectOptions(within(slots).getByRole("combobox", { name: "Physique — Lundi" }), "120");
    await waitFor(() => expect(generate()).toBeDisabled());

    await user.click(within(slots).getByRole("button", { name: "Enregistrer mes disponibilités" }));
    await waitFor(() => expect(generate()).toBeEnabled());
    await user.click(within(slots).getByRole("button", { name: "Fermer" }));
    expect(within(section("Tes créneaux")).getByText("Physique · Lun 2 h")).toBeInTheDocument();
  });

  it("BUG-V2-1 — typed availability is summarised per activity", async () => {
    repo.loadAvailabilityWindows.mockResolvedValue(TYPED_WINDOWS);
    renderPage();
    await waitFor(() => expect(within(section("Tes créneaux")).getByText("Physique · Mar 1 h 30")).toBeInTheDocument());
    expect(within(section("Tes créneaux")).getByText("Vélo · Sam Journée, Dim Journée")).toBeInTheDocument();
  });
});

describe("Affiner ton profil — declared DH tier and ordered priorities (UX-11A.5a.2b)", () => {
  it("shows the saved tier and the priorities in their declared order", async () => {
    repo.loadPerformanceSetupAnswers.mockResolvedValue({ ...PROFILE, dhTechnicalTier: "advanced", priorityAreas: ["cornering", "braking"] });
    renderPage();
    const strengths = await screen.findByRole("region", { name: "Tes points forts" });
    expect(within(strengths).getByText("Niveau technique : Avancé")).toBeInTheDocument();
    expect(within(strengths).getByText("Priorités : 1. Virages, 2. Freinage")).toBeInTheDocument();
  });

  it("a legacy profile (no tier, no priority) opens without forcing anything and saves as it is", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier tes points forts" }));
    const strengths = section("Tes points forts");
    for (const name of [/^Débutants*Je/, /^Intermédiaires*Je/, /^Avancés*Je/]) expect(within(strengths).getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    await user.click(within(strengths).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(repo.savePerformanceSetup).toHaveBeenCalledWith("athlete-1", PROFILE));
  });

  it("edits the tier and 1–3 ordered priorities; strengths, weaknesses and the renfo tier are kept", async () => {
    repo.loadPerformanceSetupAnswers.mockResolvedValue({ ...PROFILE, dhTechnicalTier: "beginner", priorityAreas: ["cornering"] });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier tes points forts" }));
    const strengths = section("Tes points forts");
    expect(within(strengths).getByRole("button", { name: /^Débutants*Je/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(strengths).getByRole("button", { name: /^Intermédiaires*Je/ }));

    const priorities = within(strengths).getByRole("group", { name: "Tes priorités de pilotage" });
    expect(within(priorities).getByRole("button", { name: "Virages, Priorité n°1" })).toBeInTheDocument();
    await user.click(within(priorities).getByRole("button", { name: "Sauts" }));
    await user.click(within(priorities).getByRole("button", { name: "Freinage" }));
    expect(within(priorities).getByRole("button", { name: "Freinage, Priorité n°3" })).toBeInTheDocument();
    expect(within(priorities).getByRole("button", { name: "Terrain raide" })).toBeDisabled();

    await user.click(within(strengths).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(repo.savePerformanceSetup).toHaveBeenCalledWith("athlete-1", {
        ...PROFILE,
        dhTechnicalTier: "intermediate",
        priorityAreas: ["cornering", "jumps", "braking"],
      })
    );
    expect(repo.savePerformanceSetup.mock.calls[0]![1]).toMatchObject({ strengths: ["braking"], weaknesses: ["cornering"], strengthExperienceTier: "intermediate" });
  });

  it("a legacy profile with more than 3 priorities cannot be saved until one is removed", async () => {
    repo.loadPerformanceSetupAnswers.mockResolvedValue({ ...PROFILE, priorityAreas: ["cornering", "braking", "jumps", "roots_rocks"] });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Modifier tes points forts" }));
    const strengths = section("Tes points forts");
    expect(within(strengths).getByText("3 priorités au maximum : retire-en une pour enregistrer.")).toBeInTheDocument();
    expect(within(strengths).getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await user.click(within(strengths).getByRole("button", { name: "Racines et rochers, Priorité n°4" }));
    expect(within(strengths).getByRole("button", { name: "Enregistrer" })).toBeEnabled();
  });
});
