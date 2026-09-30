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
  loadOnboardingAnswers: vi.fn(),
  loadFirstName: vi.fn(),
  generateTrainingPlan: vi.fn(),
  acceptTrainingPlan: vi.fn(),
  getActivePlanVersionId: vi.fn(),
  getTrainingPlanDrafts: vi.fn(),
  getTrainingPlanReview: vi.fn(),
}));
vi.mock("../performanceSetup/availabilityRepo", () => ({ loadAvailabilityWindows: repo.loadAvailabilityWindows, saveAvailabilityWindows: repo.saveAvailabilityWindows }));
vi.mock("../performanceSetup/performanceSetupRepo", () => ({ loadPerformanceSetupAnswers: repo.loadPerformanceSetupAnswers, savePerformanceSetup: repo.savePerformanceSetup }));
vi.mock("../athleteOnboarding/athleteOnboardingRepo", () => ({ loadOnboardingAnswers: repo.loadOnboardingAnswers }));
vi.mock("../today/todayContextRepo", () => ({ loadFirstName: repo.loadFirstName }));
vi.mock("../trainingPlanGeneration/generateTrainingPlan", () => ({ generateTrainingPlan: repo.generateTrainingPlan }));
vi.mock("../trainingPlanReview/acceptTrainingPlan", () => ({ acceptTrainingPlan: repo.acceptTrainingPlan }));
vi.mock("../trainingPlanReview/trainingPlanReviewRepo", () => ({
  getActivePlanVersionId: repo.getActivePlanVersionId,
  getTrainingPlanDrafts: repo.getTrainingPlanDrafts,
  getTrainingPlanReview: repo.getTrainingPlanReview,
}));

const PROFILE = { equipment: [], terrainAccess: [], strengths: ["braking"], weaknesses: [], priorityAreas: ["cornering"], strengthExperienceTier: null, seasonObjective: null };
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
  repo.saveAvailabilityWindows.mockImplementation(async (_id: string, windows: { dayOfWeek: number; startTime: string; endTime: string }[]) =>
    windows.map((w, i) => ({ id: `w-${i}`, label: null, ...w }))
  );
  repo.savePerformanceSetup.mockResolvedValue(undefined);
  repo.getTrainingPlanReview.mockResolvedValue(REVIEW);
});

describe("FirstRunSetup — the essentials", () => {
  it("training days are prefilled with the riding days; one typical window; saved as availability windows", async () => {
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Tes créneaux"));
    expect(screen.getByText("Quand peux-tu t'entraîner ?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Samedi" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dimanche" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Mardi" }));
    await user.click(screen.getByRole("button", { name: /Soir/ }));
    expect(screen.getByText("17 h – 21 h")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    await waitFor(() =>
      expect(repo.saveAvailabilityWindows).toHaveBeenCalledWith(
        "athlete-1",
        [
          { dayOfWeek: 2, startTime: "17:00", endTime: "21:00" },
          { dayOfWeek: 6, startTime: "17:00", endTime: "21:00" },
          { dayOfWeek: 0, startTime: "17:00", endTime: "21:00" },
        ],
        []
      )
    );
    await waitFor(() => expect(heading()).toHaveTextContent("Ton terrain"));
  });

  it("a custom window needs a start before its end", async () => {
    const user = userEvent.setup();
    const { container } = renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Tes créneaux"));
    await user.click(screen.getByRole("button", { name: "Autre plage" }));
    const [start, end] = container.querySelectorAll<HTMLInputElement>('input[type="time"]');
    await user.type(start!, "19:00");
    await user.type(end!, "18:00");
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
  });

  it("terrain (at least one), then renfo; the profile is saved merged — earlier fine settings are kept", async () => {
    repo.loadAvailabilityWindows.mockResolvedValue([{ id: "w-1", dayOfWeek: 6, startTime: "08:00", endTime: "18:00", label: null }]);
    const user = userEvent.setup();
    renderSetup();
    await waitFor(() => expect(heading()).toHaveTextContent("Ton terrain"));
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Flow trail" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    await waitFor(() => expect(heading()).toHaveTextContent("Ton renfo"));
    expect(screen.getByText("Rien de coché : tes séances de renfo se font au poids du corps.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Débutant" }));
    await user.click(screen.getByRole("button", { name: "Haltères" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    await waitFor(() =>
      expect(repo.savePerformanceSetup).toHaveBeenCalledWith("athlete-1", {
        ...PROFILE,
        terrainAccess: ["flow_trail"],
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
    repo.loadPerformanceSetupAnswers.mockResolvedValue({ ...PROFILE, terrainAccess: ["flow_trail"], strengthExperienceTier: "beginner" });
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
