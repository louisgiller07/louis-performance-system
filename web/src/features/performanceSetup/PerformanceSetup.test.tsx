import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PerformanceSetup } from "./PerformanceSetup";

// AppHeader renders AppNav, which reads route location via react-router
// hooks — same requirement as every other page-level test in this codebase
// (see PlanPage.test.tsx), never specific to this component.
function renderPerformanceSetup() {
  return render(
    <MemoryRouter>
      <PerformanceSetup />
    </MemoryRouter>
  );
}

const { loadPerformanceSetupAnswers, savePerformanceSetup } = vi.hoisted(() => ({
  loadPerformanceSetupAnswers: vi.fn(),
  savePerformanceSetup: vi.fn(),
}));

vi.mock("./performanceSetupRepo", async () => {
  const actual = await vi.importActual<typeof import("./performanceSetupRepo")>("./performanceSetupRepo");
  return { ...actual, loadPerformanceSetupAnswers, savePerformanceSetup };
});

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ athleteId: "athlete-1" }),
}));

const EMPTY_ANSWERS = {
  equipment: [],
  terrainAccess: [],
  strengths: [],
  weaknesses: [],
  priorityAreas: [],
  strengthExperienceTier: null,
  seasonObjective: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  loadPerformanceSetupAnswers.mockResolvedValue(EMPTY_ANSWERS);
  savePerformanceSetup.mockResolvedValue(undefined);
});

describe("PerformanceSetup — loading and restoration", () => {
  it("loads existing answers and pre-selects them", async () => {
    loadPerformanceSetupAnswers.mockResolvedValue({
      ...EMPTY_ANSWERS,
      equipment: ["barbell"],
      strengthExperienceTier: "intermediate",
      seasonObjective: "Podium at nationals",
    });

    renderPerformanceSetup();

    const barbellChip = await screen.findByRole("button", { name: "barbell" });
    expect(barbellChip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByDisplayValue("intermediate")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Podium at nationals")).toBeInTheDocument();
  });

  it("shows an error and stops loading when the read fails", async () => {
    loadPerformanceSetupAnswers.mockRejectedValue(new Error("boom"));

    renderPerformanceSetup();

    expect(await screen.findByText(/Impossible de charger ton profil/)).toBeInTheDocument();
  });
});

describe("PerformanceSetup — save gating", () => {
  it("disables Save while the form is entirely empty", async () => {
    renderPerformanceSetup();

    const saveButton = await screen.findByRole("button", { name: "Enregistrer" });
    expect(saveButton).toBeDisabled();
  });

  it("enables Save once at least one field is set, and calls savePerformanceSetup with the current answers", async () => {
    const user = userEvent.setup();
    renderPerformanceSetup();

    const barbellChip = await screen.findByRole("button", { name: "barbell" });
    await user.click(barbellChip);

    const saveButton = screen.getByRole("button", { name: "Enregistrer" });
    expect(saveButton).not.toBeDisabled();

    await user.click(saveButton);

    await waitFor(() => expect(savePerformanceSetup).toHaveBeenCalledWith("athlete-1", expect.objectContaining({ equipment: ["barbell"] })));
    expect(await screen.findByText("Profil enregistré.")).toBeInTheDocument();
  });

  it("shows an error message when saving fails, never a silent success", async () => {
    savePerformanceSetup.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderPerformanceSetup();

    await user.click(await screen.findByRole("button", { name: "barbell" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText(/Une erreur inattendue/)).toBeInTheDocument();
    expect(screen.queryByText("Profil enregistré.")).not.toBeInTheDocument();
  });
});
