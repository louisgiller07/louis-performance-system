import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AthleteOnboarding } from "./AthleteOnboarding";
import { PRIVACY_NOTICE_VERSION } from "../privacy/privacyNotice";

// V0.3_008A / UX-09 — "who you are", inside the first run: one question per
// screen, each answer saved at once (resume after a refresh), the explicit
// health-data consent completes onboarding.

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <AthleteOnboarding />
    </MemoryRouter>
  );
}

const { loadOnboardingAnswers, saveDiscipline, saveCompetitionLevel, savePrimaryGoal, saveWeeklyTrainingHours, saveRidingDays, completeOnboarding } = vi.hoisted(() => ({
  loadOnboardingAnswers: vi.fn(),
  saveDiscipline: vi.fn(),
  saveCompetitionLevel: vi.fn(),
  savePrimaryGoal: vi.fn(),
  saveWeeklyTrainingHours: vi.fn(),
  saveRidingDays: vi.fn(),
  completeOnboarding: vi.fn(),
}));

vi.mock("./athleteOnboardingRepo", async () => {
  const actual = await vi.importActual<typeof import("./athleteOnboardingRepo")>("./athleteOnboardingRepo");
  return { ...actual, loadOnboardingAnswers, saveDiscipline, saveCompetitionLevel, savePrimaryGoal, saveWeeklyTrainingHours, saveRidingDays, completeOnboarding };
});

const { loadFirstName } = vi.hoisted(() => ({ loadFirstName: vi.fn() }));
vi.mock("../today/todayContextRepo", () => ({ loadFirstName }));

const { refreshAthlete } = vi.hoisted(() => ({ refreshAthlete: vi.fn() }));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ athleteId: "athlete-1", refreshAthlete }),
}));

const EMPTY_ANSWERS = { discipline: null, competitionLevel: null, primaryGoal: null, weeklyTrainingHours: null, preferredRidingDays: [] };
const ANSWERED = { discipline: "Downhill", competitionLevel: "Amateur racer", primaryGoal: "Fitness", weeklyTrainingHours: "5-10h", preferredRidingDays: [] };

beforeEach(() => {
  vi.resetAllMocks();
  loadOnboardingAnswers.mockResolvedValue(EMPTY_ANSWERS);
  loadFirstName.mockResolvedValue("Louis");
  for (const save of [saveDiscipline, saveCompetitionLevel, savePrimaryGoal, saveWeeklyTrainingHours, saveRidingDays, completeOnboarding]) save.mockResolvedValue(undefined);
  refreshAthlete.mockResolvedValue({ status: "resolved" });
});

const heading = () => screen.getByRole("heading", { level: 1 });

describe("AthleteOnboarding — one question per screen (UX-09)", () => {
  it("a fresh start opens on the discipline, greeted by name; Continue waits for an answer", async () => {
    renderOnboarding();
    await waitFor(() => expect(heading()).toHaveTextContent("Ta discipline"));
    expect(await screen.findByText("Louis, construisons ta préparation.")).toBeInTheDocument();
    expect(screen.getByText("Qu'est-ce que tu roules ?")).toBeInTheDocument();
    expect(screen.getByText("Qui es-tu ?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
  });

  it("each answer is saved at once and moves on: discipline → level → goal (with descriptions) → time", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await waitFor(() => expect(heading()).toHaveTextContent("Ta discipline"));

    await user.click(screen.getByRole("button", { name: "Descente (DH)" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() => expect(saveDiscipline).toHaveBeenCalledWith("athlete-1", "Downhill"));
    await waitFor(() => expect(heading()).toHaveTextContent("Ton niveau"));

    await user.click(screen.getByRole("button", { name: "Compétiteur amateur" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() => expect(heading()).toHaveTextContent("Ton objectif"));
    expect(saveCompetitionLevel).toHaveBeenCalledWith("athlete-1", "Amateur racer");
    expect(screen.getByText("Être plus rapide quand ça compte.")).toBeInTheDocument();
    expect(screen.getByText("T'entraîner plus intelligemment et rester sur le vélo.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Performance en course/ }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() => expect(heading()).toHaveTextContent("Ton temps"));
    expect(savePrimaryGoal).toHaveBeenCalledWith("athlete-1", "Race performance");
  });

  it("Back returns to the previous step without saving again", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await waitFor(() => expect(heading()).toHaveTextContent("Ta discipline"));
    await user.click(screen.getByRole("button", { name: "Descente (DH)" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() => expect(heading()).toHaveTextContent("Ton niveau"));
    await user.click(screen.getByRole("button", { name: "Retour" }));
    await waitFor(() => expect(heading()).toHaveTextContent("Ta discipline"));
    expect(saveDiscipline).toHaveBeenCalledTimes(1);
  });

  it("resumes at the first unanswered step after a refresh", async () => {
    loadOnboardingAnswers.mockResolvedValue({ ...EMPTY_ANSWERS, discipline: "Downhill", competitionLevel: "Amateur racer" });
    renderOnboarding();
    await waitFor(() => expect(heading()).toHaveTextContent("Ton objectif"));
  });

  it("a failed save shows an error and does not move on", async () => {
    saveDiscipline.mockRejectedValue(new Error("Impossible d'enregistrer ta réponse. Réessaie dans un instant."));
    const user = userEvent.setup();
    renderOnboarding();
    await waitFor(() => expect(heading()).toHaveTextContent("Ta discipline"));
    await user.click(screen.getByRole("button", { name: "Descente (DH)" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(heading()).toHaveTextContent("Ta discipline");
  });
});

describe("AthleteOnboarding — riding days and consent", () => {
  it("riding days: a real toggle, at least one, saved on their own step", async () => {
    loadOnboardingAnswers.mockResolvedValue(ANSWERED);
    const user = userEvent.setup();
    renderOnboarding();
    await waitFor(() => expect(heading()).toHaveTextContent("Tes jours de roulage"));
    expect(screen.getByText("Quand roules-tu généralement ?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Lundi" }));
    await user.click(screen.getByRole("button", { name: "Samedi" }));
    await user.click(screen.getByRole("button", { name: "Lundi" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() => expect(saveRidingDays).toHaveBeenCalledWith("athlete-1", ["Saturday"]));
    await waitFor(() => expect(heading()).toHaveTextContent("Tes données"));
  });

  it("consent: unchecked by default, links to the privacy notice, required to complete", async () => {
    loadOnboardingAnswers.mockResolvedValue({ ...ANSWERED, preferredRidingDays: ["Monday"] });
    const user = userEvent.setup();
    renderOnboarding();
    await waitFor(() => expect(heading()).toHaveTextContent("Tes données"));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("link", { name: "informations de confidentialité" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("completing re-sends every answer together (self-sufficient write), then refreshes the athlete — the first run continues on /start", async () => {
    loadOnboardingAnswers.mockResolvedValue({ ...ANSWERED, discipline: "Enduro", competitionLevel: "World Cup", primaryGoal: "Race performance", weeklyTrainingHours: "15h+", preferredRidingDays: ["Monday", "Saturday"] });
    const user = userEvent.setup();
    renderOnboarding();
    await waitFor(() => expect(heading()).toHaveTextContent("Tes données"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    await waitFor(() =>
      expect(completeOnboarding).toHaveBeenCalledWith("athlete-1", {
        competitionLevel: "World Cup",
        primaryGoal: "Race performance",
        weeklyTrainingHours: "15h+",
        preferredRidingDays: ["Monday", "Saturday"],
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      })
    );
    await waitFor(() => expect(refreshAthlete).toHaveBeenCalledTimes(1));
  });
});
