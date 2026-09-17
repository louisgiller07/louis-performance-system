import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AthleteOnboarding } from "./AthleteOnboarding";

const { loadOnboardingAnswers, saveDiscipline, saveCompetitionLevel, savePrimaryGoal, saveWeeklyTrainingHours, completeOnboarding } =
  vi.hoisted(() => ({
    loadOnboardingAnswers: vi.fn(),
    saveDiscipline: vi.fn(),
    saveCompetitionLevel: vi.fn(),
    savePrimaryGoal: vi.fn(),
    saveWeeklyTrainingHours: vi.fn(),
    completeOnboarding: vi.fn(),
  }));

vi.mock("./athleteOnboardingRepo", async () => {
  const actual = await vi.importActual<typeof import("./athleteOnboardingRepo")>("./athleteOnboardingRepo");
  return {
    ...actual,
    loadOnboardingAnswers,
    saveDiscipline,
    saveCompetitionLevel,
    savePrimaryGoal,
    saveWeeklyTrainingHours,
    completeOnboarding,
  };
});

const { refreshAthlete } = vi.hoisted(() => ({ refreshAthlete: vi.fn() }));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ athleteId: "athlete-1", refreshAthlete }),
}));

const EMPTY_ANSWERS = {
  discipline: null,
  competitionLevel: null,
  primaryGoal: null,
  weeklyTrainingHours: null,
  preferredRidingDays: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  loadOnboardingAnswers.mockResolvedValue(EMPTY_ANSWERS);
  saveDiscipline.mockResolvedValue(undefined);
  saveCompetitionLevel.mockResolvedValue(undefined);
  savePrimaryGoal.mockResolvedValue(undefined);
  saveWeeklyTrainingHours.mockResolvedValue(undefined);
  completeOnboarding.mockResolvedValue(undefined);
});

describe("AthleteOnboarding — Niveau 1 wizard", () => {
  it("starts at step 1 (discipline) for a fresh athlete, Continue disabled until an option is picked", async () => {
    render(<AthleteOnboarding />);

    expect(await screen.findByText("What do you ride?")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("progression between steps: selecting an option and clicking Continue saves it and advances", async () => {
    const user = userEvent.setup();
    render(<AthleteOnboarding />);
    await screen.findByText("What do you ride?");

    await user.click(screen.getByText("Downhill"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(saveDiscipline).toHaveBeenCalledWith("athlete-1", "Downhill"));
    expect(await screen.findByText("Your current level")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
  });

  it("Back returns to the previous step without re-saving", async () => {
    const user = userEvent.setup();
    render(<AthleteOnboarding />);
    await screen.findByText("What do you ride?");

    await user.click(screen.getByText("Downhill"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Your current level");

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByText("What do you ride?")).toBeInTheDocument();
    expect(saveDiscipline).toHaveBeenCalledTimes(1);
  });

  it("resumes at the first unanswered step after a refresh (simulated by a pre-filled load)", async () => {
    loadOnboardingAnswers.mockResolvedValue({
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      primaryGoal: null,
      weeklyTrainingHours: null,
      preferredRidingDays: [],
    });

    render(<AthleteOnboarding />);

    expect(await screen.findByText("What do you want to improve?")).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
  });

  it("the final step requires at least one riding day, then completes onboarding and shows the ready screen", async () => {
    loadOnboardingAnswers.mockResolvedValue({
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      primaryGoal: "Fitness",
      weeklyTrainingHours: "5-10h",
      preferredRidingDays: [],
    });
    const user = userEvent.setup();
    render(<AthleteOnboarding />);

    await screen.findByText("When do you usually ride?");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.click(screen.getByText("Saturday"));
    await user.click(screen.getByText("Sunday"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(completeOnboarding).toHaveBeenCalledWith("athlete-1", ["Saturday", "Sunday"]));
    expect(await screen.findByText("Your athlete profile is ready.")).toBeInTheDocument();
  });

  it("clicking Enter NALYNT on the ready screen calls refreshAthlete", async () => {
    loadOnboardingAnswers.mockResolvedValue({
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      primaryGoal: "Fitness",
      weeklyTrainingHours: "5-10h",
      preferredRidingDays: ["Monday"],
    });
    completeOnboarding.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AthleteOnboarding />);

    await screen.findByText("When do you usually ride?");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Your athlete profile is ready.");

    await user.click(screen.getByRole("button", { name: "Enter NALYNT" }));

    await waitFor(() => expect(refreshAthlete).toHaveBeenCalledTimes(1));
  });

  it("shows an error and does not advance when saving a step fails", async () => {
    saveDiscipline.mockRejectedValue(new Error("Impossible d'enregistrer ta réponse. Réessaie dans un instant."));
    const user = userEvent.setup();
    render(<AthleteOnboarding />);
    await screen.findByText("What do you ride?");

    await user.click(screen.getByText("Downhill"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("What do you ride?")).toBeInTheDocument();
  });
});
