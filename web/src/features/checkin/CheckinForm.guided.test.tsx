import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckinForm } from "./CheckinForm";

vi.mock("./checkinRepo", () => ({
  loadCheckin: vi.fn(),
  saveCheckin: vi.fn(),
}));

import { loadCheckin, saveCheckin } from "./checkinRepo";

const mockedLoad = loadCheckin as unknown as ReturnType<typeof vi.fn>;
const mockedSave = saveCheckin as unknown as ReturnType<typeof vi.fn>;

const EXISTING_ROW = {
  checkin_date: "2026-09-29",
  sleep_hours: 7,
  sleep_quality: 7,
  sleep_wake_ups: 1,
  energy: 6,
  work_stress: 3,
  motivation: 8,
  leg_fatigue: 7,
  grip_fatigue: 3,
  pain: false,
  pain_intensity: null,
  pain_new: false,
  pain_location_code: null,
  pain_traumatic: false,
  pain_function_loss: false,
  pain_getting_worse: false,
  suspected_concussion: false,
  fever_or_illness: false,
  free_comment: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

const heading = (name: string) => screen.findByRole("heading", { name });

describe("CheckinForm — guided mode (UX-03)", () => {
  it("shows one themed step at a time, with its progress", async () => {
    mockedLoad.mockResolvedValue(null);
    render(<CheckinForm athleteId="athlete-1" date="2026-09-29" mode="guided" />);

    expect(await heading("Sommeil")).toBeInTheDocument();
    expect(screen.getByText("Étape 1 / 4")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /Qualité du sommeil/ })).toBeInTheDocument();
    // Later steps are not on screen yet.
    expect(screen.queryByRole("slider", { name: /Énergie/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Suspicion de commotion" })).not.toBeInTheDocument();
  });

  it("'Suivant' is blocked by the existing validation of the current step's own fields, never by later steps", async () => {
    mockedLoad.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<CheckinForm athleteId="athlete-1" date="2026-09-29" mode="guided" />);
    await heading("Sommeil");

    await user.click(screen.getByRole("button", { name: "Suivant" }));

    expect(screen.getByText("Heures de sommeil est requis.")).toBeInTheDocument();
    expect(screen.getByText("Étape 1 / 4")).toBeInTheDocument();
    // An error belonging to a later step (e.g. the health questions) is never surfaced here.
    expect(screen.queryByText("Réponds Oui ou Non.")).not.toBeInTheDocument();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("walks Sommeil → Énergie → Fatigue → Santé on an existing check-in, 'Retour' goes back, and the last step saves the exact same payload as the full form", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);
    mockedSave.mockResolvedValue(EXISTING_ROW);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<CheckinForm athleteId="athlete-1" date="2026-09-29" mode="guided" onSaved={onSaved} />);

    await heading("Sommeil");
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(await heading("Énergie")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retour" }));
    expect(await heading("Sommeil")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await heading("Énergie");
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(await heading("Fatigue")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(await heading("Santé")).toBeInTheDocument();
    expect(screen.getByText("Étape 4 / 4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer le check-in" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith(
      "athlete-1",
      "2026-09-29",
      expect.objectContaining({ sleep_hours: 7, leg_fatigue: 7, pain: false, pain_intensity: null, suspected_concussion: false, fever_or_illness: false })
    );
  });

  it("the health step keeps the tri-state rule: on a fresh check-in, unanswered Douleur / commotion / fièvre block the save", async () => {
    mockedLoad.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<CheckinForm athleteId="athlete-1" date="2026-09-29" mode="guided" />);
    const setSlider = (name: RegExp, value: number) => fireEvent.change(screen.getByRole("slider", { name }), { target: { value: String(value) } });

    await heading("Sommeil");
    fireEvent.change(screen.getByLabelText("Heures de sommeil"), { target: { value: "7" } });
    setSlider(/Qualité du sommeil/, 7);
    fireEvent.change(screen.getByLabelText("Réveils nocturnes"), { target: { value: "1" } });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await heading("Énergie");
    setSlider(/Énergie/, 6);
    setSlider(/Stress professionnel/, 3);
    setSlider(/Motivation/, 8);
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await heading("Fatigue");
    setSlider(/Jambes/, 5);
    setSlider(/Avant-bras/, 3);
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await heading("Santé");
    await user.click(screen.getByRole("button", { name: "Enregistrer le check-in" }));

    expect(mockedSave).not.toHaveBeenCalled();
    expect(screen.getAllByText("Réponds Oui ou Non.")).toHaveLength(3);
    expect(screen.getByText("Étape 4 / 4")).toBeInTheDocument();
  });
});
