import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
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
  checkin_date: "2026-08-19",
  sleep_hours: 6.5,
  sleep_quality: 6,
  sleep_wake_ups: 2,
  energy: 5,
  work_stress: 4,
  motivation: 7,
  leg_fatigue: 4,
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

describe("CheckinForm", () => {
  it("prefills the form with an existing row", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);

    await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());
    expect(mockedLoad).toHaveBeenCalledWith("athlete-1", "2026-08-19");
  });

  it("saves successfully and shows the confirmation", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);
    mockedSave.mockResolvedValue(EXISTING_ROW);
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

    await waitFor(() => expect(screen.getByText("Check-in enregistré")).toBeInTheDocument());
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ pain: false, pain_intensity: null }));
  });

  it("calls onSaved only on an actual save, never on the initial load", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);
    mockedSave.mockResolvedValue(EXISTING_ROW);
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" onSaved={onSaved} />);
    await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("shows a clean error message when save fails", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);
    mockedSave.mockRejectedValue(new Error("Impossible d'enregistrer le check-in. Réessaie dans un instant."));
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Impossible d'enregistrer/));
  });

  // --- Bugfix regression: editing an existing checkin must always be re-savable. ---

  it("existing checkin: changing energy still allows a successful save", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);
    mockedSave.mockResolvedValue(EXISTING_ROW);
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

    fireSlider("Énergie", 9);
    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ energy: 9 }));
  });

  it("existing checkin: changing sleep_hours still allows a successful save", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);
    mockedSave.mockResolvedValue(EXISTING_ROW);
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    const sleepHoursInput = await screen.findByDisplayValue("6.5");

    await user.clear(sleepHoursInput);
    await user.type(sleepHoursInput, "8");
    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ sleep_hours: 8 }));
  });

  it("regression: pain=true complete then switched back to pain=false saves successfully with a fully normalized payload", async () => {
    const rowWithPain = {
      ...EXISTING_ROW,
      pain: true,
      pain_intensity: 4,
      pain_new: false,
      pain_location_code: "knee_L",
      pain_traumatic: false,
      pain_function_loss: false,
      pain_getting_worse: true,
    };
    mockedLoad.mockResolvedValue(rowWithPain);
    mockedSave.mockResolvedValue(EXISTING_ROW);
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    // Pain section starts visible (pain=true was loaded).
    await screen.findByText("Intensité de la douleur");

    await user.click(within(screen.getByRole("group", { name: "Douleur" })).getByRole("button", { name: "Non" }));

    // The conditional pain section must be gone immediately.
    expect(screen.queryByText("Intensité de la douleur")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

    // This is exactly the bug scenario: before the fix, this submit did
    // nothing visible because validateCheckin rejected the stale
    // pain_intensity attached to a now-hidden field.
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave).toHaveBeenCalledWith(
      "athlete-1",
      "2026-08-19",
      expect.objectContaining({
        pain: false,
        pain_intensity: null,
        pain_new: false,
        pain_traumatic: false,
        pain_function_loss: false,
        pain_getting_worse: false,
        pain_location_code: null,
      })
    );
    await waitFor(() => expect(screen.getByText("Check-in enregistré")).toBeInTheDocument());
  });

  it("a validation failure always produces visible error feedback, never a silent no-op", async () => {
    // A fresh (empty) form fails validation on every required field —
    // simulates loadCheckin returning null (no existing row).
    mockedLoad.mockResolvedValue(null);
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    await screen.findByRole("button", { name: /Enregistrer le check-in/ });

    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

    expect(screen.getByText("Certains champs doivent encore être complétés.")).toBeInTheDocument();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("after a successful save, editing a field and saving again works (save is not a one-shot)", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);
    mockedSave.mockResolvedValue(EXISTING_ROW);
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));
    await waitFor(() => expect(screen.getByText("Check-in enregistré")).toBeInTheDocument());

    fireSlider("Motivation", 3);
    const saveButton = screen.getByRole("button", { name: /Enregistrer le check-in/ });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2));
    expect(mockedSave).toHaveBeenLastCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ motivation: 3 }));
  });
});

function fireSlider(label: string, value: number): void {
  const slider = screen.getByRole("slider", { name: new RegExp(label) });
  fireEvent.change(slider, { target: { value: String(value) } });
}
