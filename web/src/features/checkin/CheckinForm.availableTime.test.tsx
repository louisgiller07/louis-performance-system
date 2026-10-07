import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckinForm } from "./CheckinForm";
import { validateCheckin } from "./checkinValidation";
import { rowToFormState, type CheckinRow } from "./checkinTypes";

vi.mock("./checkinRepo", () => ({
  loadCheckin: vi.fn(),
  saveCheckin: vi.fn(),
}));

import { loadCheckin, saveCheckin } from "./checkinRepo";

const mockedLoad = loadCheckin as unknown as ReturnType<typeof vi.fn>;
const mockedSave = saveCheckin as unknown as ReturnType<typeof vi.fn>;

// A10 — « Combien de temps as-tu aujourd'hui ? »: structured, optional, one tap.

const ROW: CheckinRow = {
  checkin_date: "2026-10-07",
  sleep_hours: 7,
  sleep_quality: 7,
  sleep_wake_ups: 1,
  energy: 6,
  work_stress: 3,
  motivation: 8,
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
  free_comment: "Réunion à 18h, 45 min max",
  available_minutes_today: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function walkToTime(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "Sommeil" });
  for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Suivant" }));
  expect(await screen.findByRole("heading", { name: "Temps" })).toBeInTheDocument();
}

describe("A10 — the time question in the check-in", () => {
  it("a V2 plan: 5 steps, « Temps » before « Santé », « Comme prévu » pre-selected; choosing 45 min saves 45", async () => {
    mockedLoad.mockResolvedValue(ROW);
    mockedSave.mockImplementation(async (_a, _d, values) => ({ ...ROW, ...values }));
    const user = userEvent.setup();
    render(<CheckinForm athleteId="a" date="2026-10-07" mode="guided" askAvailableTime />);
    await walkToTime(user);
    expect(screen.getByText("Étape 4 / 5")).toBeInTheDocument();
    expect(screen.getByText("Combien de temps as-tu aujourd'hui ?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comme prévu" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "45 min" }));
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(await screen.findByRole("heading", { name: "Santé" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer le check-in" }));
    expect(mockedSave.mock.calls[0]![2]).toMatchObject({ available_minutes_today: 45 });
  });

  it("« Comme prévu » saves null (no constraint), never a time read from the free comment", async () => {
    mockedLoad.mockResolvedValue(ROW);
    mockedSave.mockImplementation(async (_a, _d, values) => ({ ...ROW, ...values }));
    const user = userEvent.setup();
    render(<CheckinForm athleteId="a" date="2026-10-07" mode="guided" askAvailableTime />);
    await walkToTime(user);
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await user.click(await screen.findByRole("button", { name: "Enregistrer le check-in" }));
    expect(mockedSave.mock.calls[0]![2]).toMatchObject({ available_minutes_today: null, free_comment: "Réunion à 18h, 45 min max" });
  });

  it("« Autre durée »: a typed number of minutes; empty blocks « Suivant » with a clear message", async () => {
    mockedLoad.mockResolvedValue(ROW);
    mockedSave.mockImplementation(async (_a, _d, values) => ({ ...ROW, ...values }));
    const user = userEvent.setup();
    render(<CheckinForm athleteId="a" date="2026-10-07" mode="guided" askAvailableTime />);
    await walkToTime(user);
    await user.click(screen.getByRole("button", { name: "Autre durée" }));
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(screen.getByText("Indique une durée en minutes.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Minutes disponibles"), "75");
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await user.click(await screen.findByRole("button", { name: "Enregistrer le check-in" }));
    expect(mockedSave.mock.calls[0]![2]).toMatchObject({ available_minutes_today: 75 });
  });

  it("a saved time is shown again on edit (reload), e.g. 30 min pre-selected", async () => {
    mockedLoad.mockResolvedValue({ ...ROW, available_minutes_today: 30 });
    const user = userEvent.setup();
    render(<CheckinForm athleteId="a" date="2026-10-07" mode="guided" askAvailableTime />);
    await walkToTime(user);
    expect(screen.getByRole("button", { name: "30 min" })).toHaveAttribute("aria-pressed", "true");
  });

  it("no V2 plan: no question (4 steps) and the saved time is null, even if a value was loaded", async () => {
    mockedLoad.mockResolvedValue({ ...ROW, available_minutes_today: 30 });
    mockedSave.mockImplementation(async (_a, _d, values) => ({ ...ROW, ...values }));
    const user = userEvent.setup();
    render(<CheckinForm athleteId="a" date="2026-10-07" mode="guided" />);
    await screen.findByRole("heading", { name: "Sommeil" });
    expect(screen.getByText("Étape 1 / 4")).toBeInTheDocument();
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(await screen.findByRole("heading", { name: "Santé" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer le check-in" }));
    expect(mockedSave.mock.calls[0]![2]).toMatchObject({ available_minutes_today: null });
  });
});

describe("A10 — validation", () => {
  const state = (v: number | "" | null) => ({ ...rowToFormState(ROW), available_minutes_today: v });
  it("null → null; a whole number 1–1440 → kept; empty, 0, 1441 or 30.5 → refused", () => {
    expect(validateCheckin(state(null))).toMatchObject({ ok: true, values: { available_minutes_today: null } });
    expect(validateCheckin(state(45))).toMatchObject({ ok: true, values: { available_minutes_today: 45 } });
    for (const bad of ["", 0, 1441, 30.5] as const) expect(validateCheckin(state(bad)).ok).toBe(false);
  });
});
