import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvailabilitySection, LEGACY_AVAILABILITY_HINT, type AvailabilityGateState } from "./AvailabilitySection";
import type { AvailabilityWindow } from "./availabilityRepo";
import type { RidingDay } from "../athleteOnboarding/onboardingOptions";

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

function renderSection(onGateStateChange: (state: AvailabilityGateState) => void = vi.fn(), ridingDays: RidingDay[] = []) {
  return render(<AvailabilitySection onGateStateChange={onGateStateChange} ridingDays={ridingDays} />);
}

const select = (name: string) => screen.getByRole("combobox", { name });
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

beforeEach(() => {
  vi.resetAllMocks();
  loadAvailabilityWindows.mockResolvedValue([]);
  saveAvailabilityWindows.mockResolvedValue([]);
});

describe("AvailabilitySection — BUG-V2-1 physical / riding", () => {
  it("empty state: every day at '—' for both physical and riding, and the generation blocker is shown", async () => {
    renderSection();
    await screen.findByText("Disponibilités");
    for (const day of DAYS) {
      expect(select(`Physique — ${day}`)).toHaveValue("0");
      expect(select(`Vélo — ${day}`)).toHaveValue("0");
    }
    expect(screen.getByText(/Aucune disponibilité enregistrée/)).toBeInTheDocument();
  });

  it("pre-fills each day from the saved typed windows (a non-preset duration stays selectable)", async () => {
    const existing: AvailabilityWindow[] = [
      { id: "w1", dayOfWeek: 1, startTime: "18:00", endTime: "19:20", label: null, activity: "physical" },
      { id: "w2", dayOfWeek: 6, startTime: "08:00", endTime: "18:00", label: null, activity: "riding" },
    ];
    loadAvailabilityWindows.mockResolvedValue(existing);
    renderSection(vi.fn(), ["Tuesday"]);
    await screen.findByText("Disponibilités");
    expect(select("Physique — Lundi")).toHaveValue("80");
    expect(select("Vélo — Samedi")).toHaveValue("600");
    expect(select("Vélo — Mardi")).toHaveValue("0"); // typed data saved: onboarding riding days not re-applied
    expect(screen.queryByText(LEGACY_AVAILABILITY_HINT)).not.toBeInTheDocument();
  });

  it("a legacy profile is asked to specify physical vs riding, starting from its windows and its riding days", async () => {
    loadAvailabilityWindows.mockResolvedValue([{ id: "old", dayOfWeek: 2, startTime: "17:00", endTime: "18:30", label: null, activity: "any" }]);
    renderSection(vi.fn(), ["Sunday"]);
    await screen.findByText("Disponibilités");
    expect(screen.getByText(LEGACY_AVAILABILITY_HINT)).toBeInTheDocument();
    expect(select("Physique — Mardi")).toHaveValue("90");
    expect(select("Vélo — Dimanche")).toHaveValue("600");
  });

  it("saves typed windows, replacing every existing one by id, and reports a clean gate", async () => {
    loadAvailabilityWindows.mockResolvedValue([{ id: "old", dayOfWeek: 2, startTime: "17:00", endTime: "18:30", label: null, activity: "any" }]);
    const saved: AvailabilityWindow[] = [{ id: "n1", dayOfWeek: 2, startTime: "18:00", endTime: "19:30", label: null, activity: "physical" }];
    saveAvailabilityWindows.mockResolvedValue(saved);
    const onGateStateChange = vi.fn();
    const user = userEvent.setup();
    renderSection(onGateStateChange);
    await screen.findByText("Disponibilités");

    await user.selectOptions(select("Vélo — Samedi"), "600");
    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    await screen.findByText("Disponibilités enregistrées.");
    expect(saveAvailabilityWindows).toHaveBeenCalledWith(
      "athlete-1",
      [
        { dayOfWeek: 2, startTime: "18:00", endTime: "19:30", activity: "physical" },
        { dayOfWeek: 6, startTime: "08:00", endTime: "18:00", activity: "riding" },
      ],
      ["old"]
    );
    expect(onGateStateChange).toHaveBeenLastCalledWith({ loading: false, dirty: false, saving: false, hasSavedAvailability: true });
  });
});

describe("AvailabilitySection — dirty tracking and save outcome", () => {
  it("marks dirty on any edit and reports it via onGateStateChange", async () => {
    const onGateStateChange = vi.fn();
    const user = userEvent.setup();
    renderSection(onGateStateChange);
    await screen.findByText("Disponibilités");
    onGateStateChange.mockClear();

    await user.selectOptions(select("Physique — Lundi"), "60");

    expect(onGateStateChange).toHaveBeenCalledWith(expect.objectContaining({ dirty: true }));
  });

  it("keeps dirty true when the save fails", async () => {
    saveAvailabilityWindows.mockRejectedValue(new Error("boom"));
    const onGateStateChange = vi.fn();
    const user = userEvent.setup();
    renderSection(onGateStateChange);
    await screen.findByText("Disponibilités");
    await user.selectOptions(select("Physique — Lundi"), "60");

    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    expect(await screen.findByText(/Une erreur inattendue/)).toBeInTheDocument();
    expect(onGateStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true, saving: false }));
  });
});

describe("AvailabilitySection — generation blocker message (PILOT_015)", () => {
  it("the 'no availability saved' blocker disappears once a window is actually saved, and stays gone on reload", async () => {
    const saved: AvailabilityWindow[] = [{ id: "w1", dayOfWeek: 6, startTime: "08:00", endTime: "12:00", label: null, activity: "riding" }];
    saveAvailabilityWindows.mockResolvedValue(saved);
    const user = userEvent.setup();
    const { unmount } = renderSection();
    await screen.findByText("Disponibilités");
    expect(screen.getByText(/Aucune disponibilité enregistrée/)).toBeInTheDocument();

    await user.selectOptions(select("Vélo — Samedi"), "240");
    await user.click(screen.getByRole("button", { name: "Enregistrer mes disponibilités" }));

    await screen.findByText("Disponibilités enregistrées.");
    expect(screen.queryByText(/Aucune disponibilité enregistrée/)).not.toBeInTheDocument();

    unmount();
    loadAvailabilityWindows.mockResolvedValue(saved);
    renderSection();
    await screen.findByText("Disponibilités");
    await waitFor(() => expect(select("Vélo — Samedi")).toHaveValue("240"));
    expect(screen.queryByText(/Aucune disponibilité enregistrée/)).not.toBeInTheDocument();
  });
});
