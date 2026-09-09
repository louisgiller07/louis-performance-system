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

  // V0.3_006C1 — the location <select> must display friendly French labels,
  // never the raw pain_location_code, while the submitted value stays the
  // canonical raw code (payload semantics unchanged).
  it("displays friendly French labels for pain location, but keeps the raw code as the submitted value", async () => {
    const rowWithPain = {
      ...EXISTING_ROW,
      pain: true,
      pain_intensity: 4,
      pain_new: false,
      pain_location_code: "wrist_L",
      pain_traumatic: false,
      pain_function_loss: false,
      pain_getting_worse: false,
    };
    mockedLoad.mockResolvedValue(rowWithPain);
    mockedSave.mockResolvedValue(EXISTING_ROW);
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    const select = (await screen.findByRole("combobox", { name: "Localisation" })) as HTMLSelectElement;

    // Prefilled to the raw code internally, but the visible option text is the friendly label.
    expect(select.value).toBe("wrist_L");
    expect(within(select).getByText("Poignet gauche")).toBeInTheDocument();
    expect(within(select).queryByText("wrist_L")).not.toBeInTheDocument();

    await user.selectOptions(select, "knee_R");
    expect(select.value).toBe("knee_R");

    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    // Submitted payload uses the canonical raw code, never the French label.
    expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ pain_location_code: "knee_R" }));
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

  // --- NAL-004: check-in scale clarity ---
  // Endpoint wording verified against head-coach-engine/src/engine/computeDimensions.ts
  // and types/checkin.ts's own "plus haut = ..." doc comments before being
  // written here — never assumed from the field name alone. Numeric
  // contract (min/max/step/submitted value) must stay byte-identical.

  const ALWAYS_VISIBLE_SCALES: Array<{
    sliderLabel: string;
    fieldKey: keyof typeof EXISTING_ROW;
    lowLabel: string;
    highLabel: string;
  }> = [
    { sliderLabel: "Qualité du sommeil", fieldKey: "sleep_quality", lowLabel: "Très mauvaise", highLabel: "Excellente" },
    { sliderLabel: "Énergie", fieldKey: "energy", lowLabel: "Épuisé", highLabel: "Plein d'énergie" },
    { sliderLabel: "Stress professionnel", fieldKey: "work_stress", lowLabel: "Aucun stress", highLabel: "Stress maximal" },
    { sliderLabel: "Motivation", fieldKey: "motivation", lowLabel: "Aucune", highLabel: "Très motivé" },
    { sliderLabel: "Jambes", fieldKey: "leg_fatigue", lowLabel: "Fraîches", highLabel: "Très lourdes" },
    { sliderLabel: "Avant-bras / grip", fieldKey: "grip_fatigue", lowLabel: "Frais", highLabel: "Très fatigué" },
  ];

  describe.each(ALWAYS_VISIBLE_SCALES)("$sliderLabel scale", ({ sliderLabel, fieldKey, lowLabel, highLabel }) => {
    it("A, B: shows the correct low-end and high-end semantic labels", async () => {
      mockedLoad.mockResolvedValue(EXISTING_ROW);
      render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
      await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

      const slider = screen.getByRole("slider", { name: new RegExp(sliderLabel) });
      expect(within(slider.closest("label")!).getByText(new RegExp(lowLabel))).toBeInTheDocument();
      expect(within(slider.closest("label")!).getByText(new RegExp(highLabel))).toBeInTheDocument();
    });

    it("C: selecting 0 submits exactly 0", async () => {
      mockedLoad.mockResolvedValue(EXISTING_ROW);
      mockedSave.mockResolvedValue(EXISTING_ROW);
      const user = userEvent.setup();

      render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
      await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

      fireSlider(sliderLabel, 0);
      await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

      await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
      expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ [fieldKey]: 0 }));
    });

    it("D: selecting 10 submits exactly 10", async () => {
      mockedLoad.mockResolvedValue(EXISTING_ROW);
      mockedSave.mockResolvedValue(EXISTING_ROW);
      const user = userEvent.setup();

      render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
      await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

      fireSlider(sliderLabel, 10);
      await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

      await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
      expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ [fieldKey]: 10 }));
    });

    it("E: an intermediate value is submitted unchanged", async () => {
      mockedLoad.mockResolvedValue(EXISTING_ROW);
      mockedSave.mockResolvedValue(EXISTING_ROW);
      const user = userEvent.setup();

      render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
      await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

      fireSlider(sliderLabel, 6);
      await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

      await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
      expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ [fieldKey]: 6 }));
    });
  });

  describe("Intensité de la douleur scale (conditional on pain=true)", () => {
    const painRow = { ...EXISTING_ROW, pain: true, pain_intensity: 4, pain_new: false, pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false };

    it("A, B: shows the correct low-end and high-end semantic labels", async () => {
      mockedLoad.mockResolvedValue(painRow);
      render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
      await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

      const slider = screen.getByRole("slider", { name: /Intensité de la douleur/ });
      expect(within(slider.closest("label")!).getByText(/Aucune douleur/)).toBeInTheDocument();
      expect(within(slider.closest("label")!).getByText(/Douleur maximale/)).toBeInTheDocument();
    });

    it("C, D: selecting 0 and 10 submit exactly 0 and 10", async () => {
      mockedLoad.mockResolvedValue(painRow);
      mockedSave.mockResolvedValue(painRow);
      const user = userEvent.setup();

      render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
      await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

      fireSlider("Intensité de la douleur", 0);
      await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));
      await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
      expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ pain_intensity: 0 }));

      mockedSave.mockClear();
      fireSlider("Intensité de la douleur", 10);
      await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));
      await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
      expect(mockedSave).toHaveBeenCalledWith("athlete-1", "2026-08-19", expect.objectContaining({ pain_intensity: 10 }));
    });
  });
});

function fireSlider(label: string, value: number): void {
  const slider = screen.getByRole("slider", { name: new RegExp(label) });
  fireEvent.change(slider, { target: { value: String(value) } });
}
