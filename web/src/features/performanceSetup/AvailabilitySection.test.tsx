import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvailabilitySection, type AvailabilityGateState } from "./AvailabilitySection";
import type { AvailabilityWindow } from "./availabilityRepo";

const { loadAvailabilityWindows, saveAvailabilityWindows } = vi.hoisted(() => ({
  loadAvailabilityWindows: vi.fn(),
  saveAvailabilityWindows: vi.fn(),
}));

vi.mock("./availabilityRepo", async () => {
  const actual = await vi.importActual<typeof import("./availabilityRepo")>("./availabilityRepo");
  return { ...actual, loadAvailabilityWindows, saveAvailabilityWindows };
});

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ athleteId: "athlete-1" }),
}));

function renderSection(onGateStateChange: (state: AvailabilityGateState) => void = vi.fn()) {
  return render(<AvailabilitySection onGateStateChange={onGateStateChange} />);
}

function dayGroup(label: string) {
  return within(screen.getByRole("group", { name: label }));
}

beforeEach(() => {
  vi.resetAllMocks();
  loadAvailabilityWindows.mockResolvedValue([]);
  saveAvailabilityWindows.mockResolvedValue([]);
});

describe("AvailabilitySection — empty state", () => {
  it("shows all 7 days as unavailable, with no arbitrary default times, when nothing is saved", async () => {
    renderSection();

    await screen.findByText("Disponibilités");
    for (const label of ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]) {
      expect(dayGroup(label).getByRole("button", { name: "Non disponible" })).toBeInTheDocument();
      expect(screen.queryByLabelText(`Heure de début — ${label}`)).not.toBeInTheDocument();
    }
    expect(screen.getByText(/Aucune disponibilité enregistrée/)).toBeInTheDocument();
  });
});

describe("AvailabilitySection — existing state", () => {
  it("pre-fills the correct day and times from an existing window", async () => {
    const existing: AvailabilityWindow[] = [{ id: "w1", dayOfWeek: 1, startTime: "18:00", endTime: "20:00", label: null }];
    loadAvailabilityWindows.mockResolvedValue(existing);

    renderSection();

    await screen.findByText("Disponibilités");
    expect(dayGroup("Lundi").getByRole("button", { name: "Disponible" })).toBeInTheDocument();
    expect(screen.getByLabelText("Heure de début — Lundi")).toHaveValue("18:00");
    expect(screen.getByLabelText("Heure de fin — Lundi")).toHaveValue("20:00");
    // Untouched days remain unavailable.
    expect(dayGroup("Mardi").getByRole("button", { name: "Non disponible" })).toBeInTheDocument();
  });
});

describe("AvailabilitySection — toggle", () => {
  it("shows time inputs only once a day is marked available, and hides them again when toggled off", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Disponibilités");

    expect(screen.queryByLabelText("Heure de début — Lundi")).not.toBeInTheDocument();

    await user.click(dayGroup("Lundi").getByRole("button", { name: "Non disponible" }));
    expect(screen.getByLabelText("Heure de début — Lundi")).toBeInTheDocument();

    await user.click(dayGroup("Lundi").getByRole("button", { name: "Disponible" }));
    expect(screen.queryByLabelText("Heure de début — Lundi")).not.toBeInTheDocument();
  });
});

describe("AvailabilitySection — validation", () => {
  async function markMondayAvailable(user: ReturnType<typeof userEvent.setup>) {
    await user.click(dayGroup("Lundi").getByRole("button", { name: "Non disponible" }));
  }

  it("rejects a missing start time", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Disponibilités");
    await markMondayAvailable(user);
    await user.type(screen.getByLabelText("Heure de fin — Lundi"), "20:00");

    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    expect(await screen.findByText(/Indique une heure de début et de fin pour Lundi/)).toBeInTheDocument();
    expect(saveAvailabilityWindows).not.toHaveBeenCalled();
  });

  it("rejects a missing end time", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Disponibilités");
    await markMondayAvailable(user);
    await user.type(screen.getByLabelText("Heure de début — Lundi"), "18:00");

    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    expect(await screen.findByText(/Indique une heure de début et de fin pour Lundi/)).toBeInTheDocument();
    expect(saveAvailabilityWindows).not.toHaveBeenCalled();
  });

  it("rejects endTime equal to startTime", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Disponibilités");
    await markMondayAvailable(user);
    await user.type(screen.getByLabelText("Heure de début — Lundi"), "18:00");
    await user.type(screen.getByLabelText("Heure de fin — Lundi"), "18:00");

    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    expect(await screen.findByText(/L'heure de fin doit être après l'heure de début pour Lundi/)).toBeInTheDocument();
    expect(saveAvailabilityWindows).not.toHaveBeenCalled();
  });

  it("rejects endTime before startTime", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Disponibilités");
    await markMondayAvailable(user);
    await user.type(screen.getByLabelText("Heure de début — Lundi"), "20:00");
    await user.type(screen.getByLabelText("Heure de fin — Lundi"), "18:00");

    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    expect(await screen.findByText(/L'heure de fin doit être après l'heure de début pour Lundi/)).toBeInTheDocument();
    expect(saveAvailabilityWindows).not.toHaveBeenCalled();
  });

  it("accepts a valid window and calls saveAvailabilityWindows", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Disponibilités");
    await markMondayAvailable(user);
    await user.type(screen.getByLabelText("Heure de début — Lundi"), "18:00");
    await user.type(screen.getByLabelText("Heure de fin — Lundi"), "20:00");

    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    await waitFor(() =>
      expect(saveAvailabilityWindows).toHaveBeenCalledWith("athlete-1", [{ dayOfWeek: 1, startTime: "18:00", endTime: "20:00" }], [])
    );
  });
});

describe("AvailabilitySection — dirty tracking and save outcome", () => {
  it("marks dirty on any edit and reports it via onGateStateChange", async () => {
    const onGateStateChange = vi.fn();
    const user = userEvent.setup();
    renderSection(onGateStateChange);
    await screen.findByText("Disponibilités");
    onGateStateChange.mockClear();

    await user.click(dayGroup("Lundi").getByRole("button", { name: "Non disponible" }));

    expect(onGateStateChange).toHaveBeenCalledWith(expect.objectContaining({ dirty: true }));
  });

  it("clears dirty after a successful save", async () => {
    saveAvailabilityWindows.mockResolvedValue([{ id: "w1", dayOfWeek: 1, startTime: "18:00", endTime: "20:00", label: null }]);
    const onGateStateChange = vi.fn();
    const user = userEvent.setup();
    renderSection(onGateStateChange);
    await screen.findByText("Disponibilités");
    await user.click(dayGroup("Lundi").getByRole("button", { name: "Non disponible" }));
    await user.type(screen.getByLabelText("Heure de début — Lundi"), "18:00");
    await user.type(screen.getByLabelText("Heure de fin — Lundi"), "20:00");

    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    await screen.findByText("Disponibilités enregistrées.");
    expect(onGateStateChange).toHaveBeenLastCalledWith({ loading: false, dirty: false, saving: false, hasSavedAvailability: true });
  });

  it("keeps dirty true when the save fails", async () => {
    saveAvailabilityWindows.mockRejectedValue(new Error("boom"));
    const onGateStateChange = vi.fn();
    const user = userEvent.setup();
    renderSection(onGateStateChange);
    await screen.findByText("Disponibilités");
    await user.click(dayGroup("Lundi").getByRole("button", { name: "Non disponible" }));
    await user.type(screen.getByLabelText("Heure de début — Lundi"), "18:00");
    await user.type(screen.getByLabelText("Heure de fin — Lundi"), "20:00");

    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    expect(await screen.findByText(/Une erreur inattendue/)).toBeInTheDocument();
    expect(onGateStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true, saving: false }));
  });
});

describe("AvailabilitySection — no arbitrary defaults", () => {
  it("leaves time inputs empty when a day is newly toggled available, never inventing a default time", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Disponibilités");

    await user.click(dayGroup("Mardi").getByRole("button", { name: "Non disponible" }));

    expect(screen.getByLabelText("Heure de début — Mardi")).toHaveValue("");
    expect(screen.getByLabelText("Heure de fin — Mardi")).toHaveValue("");
  });
});
