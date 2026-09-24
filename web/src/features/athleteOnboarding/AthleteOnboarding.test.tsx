import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AthleteOnboarding } from "./AthleteOnboarding";
import { PRIVACY_NOTICE_VERSION } from "../privacy/privacyNotice";

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={["/today"]}>
      <Routes>
        <Route path="/today" element={<AthleteOnboarding />} />
        <Route path="/performance-setup" element={<div>Performance setup page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

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

async function dismissIntro(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByText("Welcome to NALYNT");
  await user.click(screen.getByRole("button", { name: "Build my athlete profile" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  loadOnboardingAnswers.mockResolvedValue(EMPTY_ANSWERS);
  saveDiscipline.mockResolvedValue(undefined);
  saveCompetitionLevel.mockResolvedValue(undefined);
  savePrimaryGoal.mockResolvedValue(undefined);
  saveWeeklyTrainingHours.mockResolvedValue(undefined);
  completeOnboarding.mockResolvedValue(undefined);
});

describe("AthleteOnboarding — intro screen", () => {
  it("shows the intro screen first for a genuinely fresh start", async () => {
    renderOnboarding();

    expect(await screen.findByText("Welcome to NALYNT")).toBeInTheDocument();
    expect(screen.getByText("Your AI performance coach starts by understanding you.")).toBeInTheDocument();
    expect(
      screen.getByText("Every athlete is different. Your goals, your schedule and your riding style shape your performance journey.")
    ).toBeInTheDocument();
    expect(screen.queryByText("What do you ride?")).not.toBeInTheDocument();
  });

  it("dismissing the intro reveals step 1", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await dismissIntro(user);

    expect(await screen.findByText("What do you ride?")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
  });

  it("is skipped when resuming mid-wizard (not a fresh start)", async () => {
    loadOnboardingAnswers.mockResolvedValue({
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      primaryGoal: null,
      weeklyTrainingHours: null,
      preferredRidingDays: [],
    });

    renderOnboarding();

    expect(await screen.findByText("What do you want NALYNT to help you achieve?")).toBeInTheDocument();
    expect(screen.queryByText("Welcome to NALYNT")).not.toBeInTheDocument();
  });
});

describe("AthleteOnboarding — Niveau 1 wizard", () => {
  it("starts at step 1 (discipline) for a fresh athlete, Continue disabled until an option is picked", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dismissIntro(user);

    expect(await screen.findByText("What do you ride?")).toBeInTheDocument();
    expect(screen.getByText("This helps NALYNT understand your riding environment.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("progression between steps: selecting an option and clicking Continue saves it and advances", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dismissIntro(user);

    await user.click(screen.getByText("Downhill"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(saveDiscipline).toHaveBeenCalledWith("athlete-1", "Downhill"));
    expect(await screen.findByText("Where are you today in your journey?")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
  });

  it("step 3 shows a short description under each goal option", async () => {
    loadOnboardingAnswers.mockResolvedValue({
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      primaryGoal: null,
      weeklyTrainingHours: null,
      preferredRidingDays: [],
    });

    renderOnboarding();

    await screen.findByText("What do you want NALYNT to help you achieve?");
    expect(screen.getByText("Be faster when it matters.")).toBeInTheDocument();
    expect(screen.getByText("Reduce mistakes and repeat your best riding.")).toBeInTheDocument();
    expect(screen.getByText("Build stronger fundamentals and confidence.")).toBeInTheDocument();
    expect(screen.getByText("Improve strength and endurance.")).toBeInTheDocument();
    expect(screen.getByText("Train smarter and stay on your bike.")).toBeInTheDocument();
  });

  it("Back returns to the previous step without re-saving", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dismissIntro(user);

    await user.click(screen.getByText("Downhill"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Where are you today in your journey?");

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

    renderOnboarding();

    expect(await screen.findByText("What do you want NALYNT to help you achieve?")).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
  });

  it("selecting a day updates local state (toggle on) and deselecting removes it (toggle off)", async () => {
    loadOnboardingAnswers.mockResolvedValue({
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      primaryGoal: "Fitness",
      weeklyTrainingHours: "5-10h",
      preferredRidingDays: [],
    });
    const user = userEvent.setup();
    renderOnboarding();
    await screen.findByText("When can NALYNT help you train around your riding?");

    await user.click(screen.getByText("Monday"));
    await user.click(screen.getByText("Wednesday"));
    // Toggle Monday back off — proves the local state update is a real
    // add/remove toggle, not a one-way accumulate.
    await user.click(screen.getByText("Monday"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(completeOnboarding).toHaveBeenCalledWith(
        "athlete-1",
        expect.objectContaining({ preferredRidingDays: ["Wednesday"] })
      )
    );
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
    renderOnboarding();

    await screen.findByText("When can NALYNT help you train around your riding?");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.click(screen.getByText("Saturday"));
    await user.click(screen.getByText("Sunday"));
    // Riding days alone are not enough: explicit health-data consent is required.
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(completeOnboarding).toHaveBeenCalledWith("athlete-1", {
        competitionLevel: "Amateur racer",
        primaryGoal: "Fitness",
        weeklyTrainingHours: "5-10h",
        preferredRidingDays: ["Saturday", "Sunday"],
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      })
    );
    expect(await screen.findByText("Your athlete profile is ready.")).toBeInTheDocument();
  });

  it("the final write re-sends all four answers together, not just riding days — self-sufficient even if an earlier per-step save never landed", async () => {
    loadOnboardingAnswers.mockResolvedValue({
      discipline: "Enduro",
      competitionLevel: "World Cup",
      primaryGoal: "Race performance",
      weeklyTrainingHours: "15h+",
      preferredRidingDays: [],
    });
    const user = userEvent.setup();
    renderOnboarding();

    await screen.findByText("When can NALYNT help you train around your riding?");
    await user.click(screen.getByText("Monday"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(completeOnboarding).toHaveBeenCalledWith("athlete-1", {
        competitionLevel: "World Cup",
        primaryGoal: "Race performance",
        weeklyTrainingHours: "15h+",
        preferredRidingDays: ["Monday"],
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      })
    );
  });

  it("shows an error and does not advance when saving a step fails", async () => {
    saveDiscipline.mockRejectedValue(new Error("Impossible d'enregistrer ta réponse. Réessaie dans un instant."));
    const user = userEvent.setup();
    renderOnboarding();
    await dismissIntro(user);

    await user.click(screen.getByText("Downhill"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("What do you ride?")).toBeInTheDocument();
  });
});

describe("AthleteOnboarding — completion screen", () => {
  it("shows the checklist and the next-step text, then refreshes the athlete and goes to the Performance Setup", async () => {
    loadOnboardingAnswers.mockResolvedValue({
      discipline: "Downhill",
      competitionLevel: "Amateur racer",
      primaryGoal: "Fitness",
      weeklyTrainingHours: "5-10h",
      preferredRidingDays: ["Monday"],
    });
    const user = userEvent.setup();
    renderOnboarding();

    await screen.findByText("When can NALYNT help you train around your riding?");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Your athlete profile is ready.")).toBeInTheDocument();
    expect(screen.getByText("Your discipline")).toBeInTheDocument();
    expect(screen.getByText("Your experience level")).toBeInTheDocument();
    expect(screen.getByText("Your goals")).toBeInTheDocument();
    expect(screen.getByText("Your availability")).toBeInTheDocument();
    expect(screen.getByText("Next: set up your training profile and availability to generate your first training plan.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Set up my training plan" }));

    await waitFor(() => expect(refreshAthlete).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Performance setup page")).toBeInTheDocument();
  });
});

describe("AthleteOnboarding — health-data consent (PILOT_012)", () => {
  const FINAL_STEP_ANSWERS = {
    discipline: "Downhill",
    competitionLevel: "Amateur racer",
    primaryGoal: "Fitness",
    weeklyTrainingHours: "5-10h",
    preferredRidingDays: ["Monday"],
  };

  it("the consent checkbox is unchecked by default and links to the privacy notice", async () => {
    loadOnboardingAnswers.mockResolvedValue(FINAL_STEP_ANSWERS);
    renderOnboarding();

    await screen.findByText("When can NALYNT help you train around your riding?");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("link", { name: "informations de confidentialité" })).toHaveAttribute("href", "/privacy");
  });

  it("cannot complete onboarding without consent — completeOnboarding is never called", async () => {
    loadOnboardingAnswers.mockResolvedValue(FINAL_STEP_ANSWERS);
    const user = userEvent.setup();
    renderOnboarding();

    await screen.findByText("When can NALYNT help you train around your riding?");
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();
    await user.click(continueButton);

    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(screen.queryByText("Your athlete profile is ready.")).not.toBeInTheDocument();
  });
});
