import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("shows a clean error message when save fails", async () => {
    mockedLoad.mockResolvedValue(EXISTING_ROW);
    mockedSave.mockRejectedValue(new Error("Impossible d'enregistrer le check-in. Réessaie dans un instant."));
    const user = userEvent.setup();

    render(<CheckinForm athleteId="athlete-1" date="2026-08-19" />);
    await waitFor(() => expect(screen.getByDisplayValue("6.5")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Enregistrer le check-in/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Impossible d'enregistrer/));
  });
});
