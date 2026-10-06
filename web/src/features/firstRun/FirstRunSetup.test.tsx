import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { FirstRunSetup } from "./FirstRunSetup";
import { plan, session } from "../program/programFixtures";

// UX-09 — "your training → your plan": the essentials only, then NALYNT
// builds the first plan and the rider starts it. Writes go through the
// existing repositories / Edge Functions, mocked here.

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ athleteId: "athlete-1" }) }));
vi.mock("../../lib/simulationClock", () => ({ useEffectiveToday: () => "2026-10-21" }));

const repo = vi.hoisted(() => ({
  loadAvailabilityWindows: vi.fn(),
  saveAvailabilityWindows: vi.fn(),
  loadPerformanceSetupAnswers: vi.fn(),
  savePerformanceSetup: vi.fn(),
  saveDhTechnicalProfile: vi.fn(),
  loadOnboardingAnswers: vi.fn(),
  loadFirstName: vi.fn(),
  generateTrainingPlan: vi.fn(),
  acceptTrainingPlan: vi.fn(),
  getActivePlanVersionId: vi.fn(),
  getTrainingPlanDrafts: vi.fn(),
  getTrainingPlanReview: vi.fn(),
}));
vi.mock("../performanceSetup/availabilityRepo", () => ({ loadAvailabilityWindows: repo.loadAvailabilityWindows, saveAvailabilityWindows: repo.saveAvailabilityWindows }));
vi.mock("../performanceSetup/performanceSetupRepo", () => ({
  loadPerformanceSetupAnswers: repo.loadPerformanceSetupAnswers,
  savePerformanceSetup: repo.savePerformanceSetup,
  saveDhTechnicalProfile: repo.saveDhTechnicalProfile,
}));
vi.mock("../athleteOnboarding/athleteOnboardingRepo", () => ({ loadOnboardingAnswers: repo.loadOnboardingAnswers }));
vi.mock("../today/todayContextRepo", () => ({ loadFirstName: repo.loadFirstName }));
vi.mock("../trainingPlanGeneration/generateTrainingPlan", () => ({ generateTrainingPlan: repo.generateTrainingPlan }));
vi.mock("../trainingPlanReview/acceptTrainingPlan", () => ({ acceptTrainingPlan: repo.acceptTrainingPlan }));
vi.mock("../trainingPlanReview/trainingPlanReviewRepo", () => ({
  getActivePlanVersionId: repo.getActivePlanVersionId,
  getTrainingPlanDrafts: repo.getTrainingPlanDrafts,
  getTrainingPlanReview: repo.getTrainingPlanReview,
}));

const PROFILE = { equipment: [], terrainAccess: [], strengths: ["braking"], weaknesses: ["jumps"], priorityAreas: ["cornering"], strengthExperienceTier: null, dhTechnicalTier: null, seasonObjective: null };
const REVIEW = plan([session("2026-10-20"), session("2026-10-22"), session("2026-10-24", { kind: "STRENGTH_LOWER", durationMin: 60 }), session("2026-10-27")], { lifecycleState: "draft" });

function Today() {
  const state = useLocation().state as { firstDay?: boolean } | null;
  return <p>{`Today page · firstDay=${String(state?.firstDay)}`}</p>;
}

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <Routes>
        <Route path="/start" element={<FirstRunSetup />} />
        <Route path="/today" element={<Today />} />
      </Routes>
    </MemoryRouter>
  );
}

const heading = () => screen.getByRole("heading", { level: 1 });

beforeEach(() => {
  vi.resetAllMocks();
  repo.getActivePlanVersionId.mockResolvedValue(null);
  repo.getTrainingPlanDrafts.mockResolvedValue([]);
  repo.loadAvailabilityWindows.mockResolvedValue([]);
  repo.loadPerformanceSetupAnswers.mockResolvedValue(PROFILE);
  repo.loadOnboardingAnswers.mockResolvedValue({ discipline: "Downhill", competitionLevel: "Amateur racer", primaryGoal: "Race performance", weeklyTrainingHours: "5-10h", preferredRidingDays: ["Saturday", "Sunday"] });
  repo.loadFirstName.mockResolvedValue("Louis");
  repo.saveAvailabilityWindows.mockImplementation(async (_id: string, windows: { dayOfWeek: number; startTime: string; endTime: string; activity: string }[]) =>
    windows.map((w, i) => ({ id: `w-${i}`, label: null, ...w }))
  );
  repo.savePerformanceSetup.mockResolvedValue(undefined);
  repo.saveDhTechnicalProfile.mockResolvedValue(undefined);
  repo.getTrainingPlanReview.mockResolvedValue(REVIEW);
});

describe("FirstRunSetup — the essentials", () => {
  it("BUG-V2-1 — physical and riding time per day: riding days prefilled, saved as typed windows", async () => {
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Tes créneaux"));
    expect(screen.getByText(/De combien de temps disposes-tu chaque jour/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Vélo — Samedi" })).toHaveValue("600");
    expect(screen.getByRole("combobox", { name: "Vélo — Dimanche" })).toHaveValue("600");
    expect(screen.getByRole("combobox", { name: "Physique — Mardi" })).toHaveValue("0");

    await user.selectOptions(screen.getByRole("combobox", { name: "Physique — Mardi" }), "90");
    await user.selectOptions(screen.getByRole("combobox", { name: "Physique — Jeudi" }), "45");
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    await waitFor(() =>
      expect(repo.saveAvailabilityWindows).toHaveBeenCalledWith(
        "athlete-1",
        [
          { dayOfWeek: 2, startTime: "18:00", endTime: "19:30", activity: "physical" },
          { dayOfWeek: 4, startTime: "18:00", endTime: "18:45", activity: "physical" },
          { dayOfWeek: 6, startTime: "08:00", endTime: "18:00", activity: "riding" },
          { dayOfWeek: 0, startTime: "08:00", endTime: "18:00", activity: "riding" },
        ],
        []
      )
    );
    await waitFor(() => expect(heading()).toHaveTextContent("Ton terrain"));
  });

  it("BUG-V2-1 — nothing declared (no physical, no riding time) cannot continue", async () => {
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Tes créneaux"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Vélo — Samedi" }), "0");
    await user.selectOptions(screen.getByRole("combobox", { name: "Vélo — Dimanche" }), "0");
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Physique — Lundi" }), "60");
    expect(screen.getByRole("button", { name: "Continuer" })).toBeEnabled();
  });

  it("terrain (at least one), then pilotage, then renfo; the profile is saved merged — earlier fine settings are kept", async () => {
    repo.loadAvailabilityWindows.mockResolvedValue([{ id: "w-1", dayOfWeek: 6, startTime: "08:00", endTime: "18:00", label: null }]);
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Ton terrain"));
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Flow trail" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    await waitFor(() => expect(heading()).toHaveTextContent("Ton pilotage"));
    await user.click(screen.getByRole("button", { name: /^Intermédiaire/ }));
    await user.click(screen.getByRole("button", { name: "Sauts" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() =>
      expect(repo.saveDhTechnicalProfile).toHaveBeenCalledWith("athlete-1", { dhTechnicalTier: "intermediate", priorityAreas: ["cornering", "jumps"] })
    );

    await waitFor(() => expect(heading()).toHaveTextContent("Ton renfo"));
    expect(screen.getByText("Rien de coché : tes séances de renfo se font au poids du corps.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Débutant" }));
    await user.click(screen.getByRole("button", { name: "Haltères" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    await waitFor(() =>
      expect(repo.savePerformanceSetup).toHaveBeenCalledWith("athlete-1", {
        ...PROFILE,
        terrainAccess: ["flow_trail"],
        dhTechnicalTier: "intermediate",
        priorityAreas: ["cornering", "jumps"],
        strengthExperienceTier: "beginner",
        equipment: ["dumbbells"],
      })
    );
    await waitFor(() => expect(heading()).toHaveTextContent("Ta préparation"));
  });
});

describe("FirstRunSetup — the first plan", () => {
  beforeEach(() => {
    repo.loadAvailabilityWindows.mockResolvedValue([{ id: "w-1", dayOfWeek: 6, startTime: "08:00", endTime: "18:00", label: null }]);
    repo.loadPerformanceSetupAnswers.mockResolvedValue({ ...PROFILE, terrainAccess: ["flow_trail"], dhTechnicalTier: "advanced", strengthExperienceTier: "beginner" });
  });

  it("how long to prepare (6 weeks preselected), NALYNT builds the plan, the first plan is shown, 'Commencer ma préparation' starts it and opens the first day", async () => {
    repo.generateTrainingPlan.mockResolvedValue({ ok: true, data: { planVersionId: "v-1", idempotentReplay: false } });
    repo.acceptTrainingPlan.mockResolvedValue({ ok: true, data: { planVersionId: "v-1", idempotentReplay: false } });
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Ta préparation"));
    expect(screen.getByText("Combien de temps veux-tu préparer cet objectif ?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6 semaines" })).toHaveAttribute("aria-pressed", "true");
    for (const n of [4, 8, 12]) expect(screen.getByRole("button", { name: `${n} semaines` })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "4 semaines" }));
    await user.type(screen.getByLabelText("Ton objectif de saison, en une phrase (facultatif)"), "Top 10 aux Championnats suisses");
    await user.click(screen.getByRole("button", { name: "Construire ma préparation" }));

    await waitFor(() => expect(heading()).toHaveTextContent("NALYNT prépare ta saison…"));
    for (const item of ["Ton objectif", "Ton niveau", "Tes disponibilités", "Ton terrain", "Ta préparation"]) expect(screen.getByText(item)).toBeInTheDocument();
    await waitFor(() => expect(repo.generateTrainingPlan).toHaveBeenCalledWith({ generationRequestId: expect.any(String), durationWeeks: 4 }));
    expect(repo.savePerformanceSetup).toHaveBeenLastCalledWith("athlete-1", expect.objectContaining({ seasonObjective: "Top 10 aux Championnats suisses" }));
    expect(await screen.findByText("Ton plan est construit autour de ta réalité.", {}, { timeout: 5000 })).toBeInTheDocument();

    await waitFor(() => expect(heading()).toHaveTextContent("Ton premier plan est prêt"), { timeout: 4000 });
    const summary = screen.getByRole("region", { name: "Ton premier plan est prêt" });
    expect(within(summary).getByText("Top 10 aux Championnats suisses")).toBeInTheDocument();
    // BUG-V2-3 — the start date is always shown (fixture plan: 19 October, rider's today: 21 October).
    expect(within(summary).getByText("Ton programme commence le lundi 19 octobre.")).toBeInTheDocument();
    expect(within(summary).getByText("2 semaines")).toBeInTheDocument();
    expect(within(summary).getByText("Développement")).toBeInTheDocument();
    expect(within(summary).getAllByText(/DH technique|Renfo bas du corps/)).toHaveLength(3);
    expect(within(summary).getByText("Ton plan s'adapte.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Brouillon|Version non active|Nouvelle version/);

    await user.click(screen.getByRole("button", { name: "Commencer ma préparation" }));
    // The plan actually loaded and shown is the one started.
    await waitFor(() => expect(repo.acceptTrainingPlan).toHaveBeenCalledWith(REVIEW.version.id));
    expect(await screen.findByText("Today page · firstDay=true")).toBeInTheDocument();
  }, 15000);

  it("a retryable failure keeps the same intention on 'Réessayer' (idempotent)", async () => {
    repo.generateTrainingPlan.mockResolvedValueOnce({ ok: false, error: { code: "internal_error", message: "Erreur serveur. Réessaie.", retryable: true, action: "retry" } });
    repo.generateTrainingPlan.mockResolvedValueOnce({ ok: true, data: { planVersionId: "v-1", idempotentReplay: false } });
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Ta préparation"));
    await user.click(screen.getByRole("button", { name: "Construire ma préparation" }));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("Erreur serveur. Réessaie.");
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(repo.generateTrainingPlan).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(repo.generateTrainingPlan.mock.calls[1]![0].generationRequestId).toBe(repo.generateTrainingPlan.mock.calls[0]![0].generationRequestId);
  }, 15000);

  it("a setup the catalogue cannot serve sends the rider back to terrain / renfo, with the actionable message", async () => {
    repo.generateTrainingPlan.mockResolvedValue({ ok: false, error: { code: "no_compatible_drill", message: "Aucun exercice technique ne correspond à ton terrain et à ton niveau.", retryable: false, action: "user_fixable" } });
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Ta préparation"));
    await user.click(screen.getByRole("button", { name: "Construire ma préparation" }));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("Aucun exercice technique");
    await user.click(screen.getByRole("button", { name: "Modifier mon terrain ou mon renfo" }));
    await waitFor(() => expect(heading()).toHaveTextContent("Ton terrain"));
  }, 15000);
});

describe("FirstRunSetup — resume", () => {
  it("an already generated first plan is shown again, never regenerated", async () => {
    repo.getTrainingPlanDrafts.mockResolvedValue([{ id: "v-9", horizonStartDate: "2026-10-19", horizonEndDate: "2026-11-01", generationTrigger: "initial", rationale: "", generatedAt: "2026-10-20T08:00:00Z" }]);
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Ton premier plan est prêt"));
    await waitFor(() => expect(repo.getTrainingPlanReview).toHaveBeenCalledWith("v-9"));
    expect(repo.generateTrainingPlan).not.toHaveBeenCalled();
  });

  it("an athlete with an active plan goes straight to Today", async () => {
    repo.getActivePlanVersionId.mockResolvedValue("active");
    renderSetup();
    expect(await screen.findByText("Today page · firstDay=undefined")).toBeInTheDocument();
  });
});

describe("FirstRunSetup — pilotage: declared DH tier and ordered priorities (UX-11A.5a.2b)", () => {
  beforeEach(() => {
    repo.loadAvailabilityWindows.mockResolvedValue([{ id: "w-1", dayOfWeek: 6, startTime: "08:00", endTime: "18:00", label: null }]);
  });

  async function openPilotage(profile: Record<string, unknown>) {
    repo.loadPerformanceSetupAnswers.mockResolvedValue({ ...PROFILE, terrainAccess: ["flow_trail"], ...profile });
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Ton pilotage"));
    return user;
  }

  it("never preselects a tier — not from the strength tier, not from the competition level", async () => {
    repo.loadOnboardingAnswers.mockResolvedValue({ discipline: "Downhill", competitionLevel: "World Cup", primaryGoal: "Race performance", weeklyTrainingHours: "15h+", preferredRidingDays: ["Saturday"] });
    await openPilotage({ strengthExperienceTier: "advanced", priorityAreas: [] });
    expect(screen.getByText("Ton niveau technique en descente ?")).toBeInTheDocument();
    for (const tier of [/^Débutant/, /^Intermédiaire/, /^Avancé/]) expect(screen.getByRole("button", { name: tier })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Je suis à l’aise sur des pistes techniques connues, avec racines, rochers, virages et sauts modérés.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
  });

  it("requires an explicit tier AND at least one priority to continue", async () => {
    const user = await openPilotage({ priorityAreas: [] });
    await user.click(screen.getByRole("button", { name: /^Avancé/ }));
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Freinage" }));
    expect(screen.getByRole("button", { name: "Continuer" })).toBeEnabled();
  });

  it("keeps the click order as the priority order, at most 3, never a duplicate, and re-ranks on removal", async () => {
    const user = await openPilotage({ priorityAreas: [] });
    await user.click(screen.getByRole("button", { name: "Virages" }));
    await user.click(screen.getByRole("button", { name: "Freinage" }));
    await user.click(screen.getByRole("button", { name: "Sauts" }));
    expect(screen.getByRole("button", { name: "Virages, Priorité n°1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Freinage, Priorité n°2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sauts, Priorité n°3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terrain raide" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Virages, Priorité n°1" }));
    expect(screen.getByRole("button", { name: "Freinage, Priorité n°1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sauts, Priorité n°2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terrain raide" })).toBeEnabled();
  });

  it("saves only the tier and the ordered priorities (strengths and weaknesses are left to the repository's merge)", async () => {
    const user = await openPilotage({ priorityAreas: [] });
    await user.click(screen.getByRole("button", { name: /^Débutant/ }));
    await user.click(screen.getByRole("button", { name: "Terrain raide" }));
    await user.click(screen.getByRole("button", { name: "Virages" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() => expect(repo.saveDhTechnicalProfile).toHaveBeenCalledWith("athlete-1", { dhTechnicalTier: "beginner", priorityAreas: ["steep_terrain", "cornering"] }));
    expect(repo.savePerformanceSetup).not.toHaveBeenCalled();
    await waitFor(() => expect(heading()).toHaveTextContent("Ton renfo"));
  });

  it("a first run in progress without a declared tier resumes on pilotage; a rider with an active plan is never sent back", async () => {
    await openPilotage({ dhTechnicalTier: null, priorityAreas: ["cornering"], strengthExperienceTier: "beginner" });
  });
});
