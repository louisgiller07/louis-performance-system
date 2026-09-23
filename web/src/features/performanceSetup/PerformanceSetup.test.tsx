import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

const { loadAvailabilityWindows, saveAvailabilityWindows } = vi.hoisted(() => ({
  loadAvailabilityWindows: vi.fn(),
  saveAvailabilityWindows: vi.fn(),
}));

vi.mock("./performanceSetupRepo", async () => {
  const actual = await vi.importActual<typeof import("./performanceSetupRepo")>("./performanceSetupRepo");
  return { ...actual, loadPerformanceSetupAnswers, savePerformanceSetup };
});

vi.mock("./availabilityRepo", async () => {
  const actual = await vi.importActual<typeof import("./availabilityRepo")>("./availabilityRepo");
  return { ...actual, loadAvailabilityWindows, saveAvailabilityWindows };
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

// A pre-existing saved window — the default baseline for every test that
// isn't specifically about availability itself, so those tests continue to
// isolate the concern they actually test (V0.5_045: configurationReady now
// also requires hasSavedAvailability, so tests about the profile's own
// save gate must not be blocked by an unrelated, unsatisfied availability
// precondition).
const ONE_SAVED_WINDOW = [{ id: "w1", dayOfWeek: 1 as const, startTime: "18:00", endTime: "20:00", label: null }];

beforeEach(() => {
  vi.resetAllMocks();
  loadPerformanceSetupAnswers.mockResolvedValue(EMPTY_ANSWERS);
  savePerformanceSetup.mockResolvedValue(undefined);
  loadAvailabilityWindows.mockResolvedValue(ONE_SAVED_WINDOW);
  saveAvailabilityWindows.mockResolvedValue(ONE_SAVED_WINDOW);
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

// V0.5_036 — a plan must never be generated from Performance Setup changes
// that are visible but not yet saved. This exercises the real wiring
// between PerformanceSetup's own dirty-tracking and
// TrainingPlanGenerationPanel's configurationReady prop (not mocked here —
// the panel itself is unit-tested in TrainingPlanGenerationPanel.test.tsx).
describe("PerformanceSetup — training plan generation save gate", () => {
  it("disables the generate button once the form has unsaved changes", async () => {
    const user = userEvent.setup();
    renderPerformanceSetup();
    await screen.findByRole("button", { name: "barbell" });
    // Availability is already satisfied (beforeEach default) — isolates
    // the profile's own dirty gate as the only variable under test.
    await waitFor(() => expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled());

    await user.click(screen.getByRole("button", { name: "barbell" }));

    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();
    expect(screen.getByText(/Enregistre ta configuration/)).toBeInTheDocument();
  });

  it("re-enables the generate button once the changes are saved", async () => {
    const user = userEvent.setup();
    renderPerformanceSetup();

    await user.click(await screen.findByRole("button", { name: "barbell" }));
    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Profil enregistré.");

    await waitFor(() => expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled());
  });
});

// V0.5_045 — availability now participates in the same generation gate,
// via its own independent loading/dirty/saving state plus the real,
// backend-mirrored hasSavedAvailability signal (never a looser rule).
describe("PerformanceSetup — availability save gate (V0.5_045)", () => {
  it("keeps generation disabled while availability is still loading", async () => {
    loadAvailabilityWindows.mockReturnValue(new Promise(() => {})); // never resolves within this test
    renderPerformanceSetup();

    await screen.findByRole("button", { name: "barbell" });

    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();
  });

  it("keeps generation disabled after load when no availability is saved, even if the profile is clean", async () => {
    loadAvailabilityWindows.mockResolvedValue([]);
    renderPerformanceSetup();

    await screen.findByText(/Aucune disponibilité enregistrée pour le moment/);
    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();
  });

  it("enables generation once availability is saved and the profile is clean", async () => {
    loadAvailabilityWindows.mockResolvedValue(ONE_SAVED_WINDOW);
    renderPerformanceSetup();

    await waitFor(() => expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled());
  });

  it("disables generation while availability has unsaved edits", async () => {
    const user = userEvent.setup();
    renderPerformanceSetup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled());

    await user.click(within(screen.getByRole("group", { name: "Mardi" })).getByRole("button", { name: "Non disponible" }));

    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();
  });

  it("re-enables generation once an availability edit is saved successfully", async () => {
    const user = userEvent.setup();
    renderPerformanceSetup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled());

    // Edit Monday's already-valid saved window (still valid after the
    // edit) — simpler than toggling a new day, which would also require
    // filling in fresh times to avoid a local validation error.
    await user.clear(screen.getByLabelText("Heure de fin — Lundi"));
    await user.type(screen.getByLabelText("Heure de fin — Lundi"), "21:00");
    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();

    saveAvailabilityWindows.mockResolvedValue(ONE_SAVED_WINDOW);
    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));
    await screen.findByText("Disponibilités enregistrées.");

    await waitFor(() => expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled());
  });

  it("keeps generation disabled when saving an availability edit fails", async () => {
    const user = userEvent.setup();
    renderPerformanceSetup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled());

    await user.clear(screen.getByLabelText("Heure de fin — Lundi"));
    await user.type(screen.getByLabelText("Heure de fin — Lundi"), "21:00");
    saveAvailabilityWindows.mockRejectedValue(new Error("boom"));
    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    await screen.findByText(/Une erreur inattendue/);
    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();
  });

  it("blocks generation when the profile is dirty even though availability is already saved", async () => {
    const user = userEvent.setup();
    renderPerformanceSetup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled());

    await user.click(screen.getByRole("button", { name: "barbell" }));

    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();
  });

  it("blocks generation when availability is dirty even though the profile is already saved", async () => {
    const user = userEvent.setup();
    renderPerformanceSetup();
    await user.click(await screen.findByRole("button", { name: "barbell" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Profil enregistré.");

    await user.click(within(screen.getByRole("group", { name: "Mardi" })).getByRole("button", { name: "Non disponible" }));

    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();
  });
});
