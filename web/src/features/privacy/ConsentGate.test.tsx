import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentGate } from "./ConsentGate";
import { HealthDataConsentError } from "./consentRepo";

const { recordHealthDataConsent, refreshAthlete } = vi.hoisted(() => ({
  recordHealthDataConsent: vi.fn(),
  refreshAthlete: vi.fn(),
}));

vi.mock("./consentRepo", async () => {
  const actual = await vi.importActual<typeof import("./consentRepo")>("./consentRepo");
  return { ...actual, recordHealthDataConsent };
});
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ athleteId: "athlete-1", refreshAthlete }) }));

beforeEach(() => {
  vi.resetAllMocks();
  recordHealthDataConsent.mockResolvedValue(undefined);
  refreshAthlete.mockResolvedValue({ status: "resolved" });
});

describe("ConsentGate (PILOT_012)", () => {
  it("the checkbox is unchecked by default and Continuer is disabled until it is checked", async () => {
    const user = userEvent.setup();
    render(<ConsentGate />);

    const checkbox = screen.getByRole("checkbox");
    const button = screen.getByRole("button", { name: "Continuer" });
    expect(checkbox).not.toBeChecked();
    expect(button).toBeDisabled();
    expect(screen.getByRole("link", { name: "informations de confidentialité" })).toHaveAttribute("href", "/privacy");

    await user.click(button);
    expect(recordHealthDataConsent).not.toHaveBeenCalled();
  });

  it("consenting records the consent for the athlete's own id, then refreshes the athlete", async () => {
    const user = userEvent.setup();
    render(<ConsentGate />);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    await waitFor(() => expect(recordHealthDataConsent).toHaveBeenCalledWith("athlete-1"));
    await waitFor(() => expect(refreshAthlete).toHaveBeenCalledTimes(1));
  });

  it("a failed save shows an error and does not refresh", async () => {
    recordHealthDataConsent.mockRejectedValue(new HealthDataConsentError());
    const user = userEvent.setup();
    render(<ConsentGate />);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d'enregistrer ton consentement. Réessaie.");
    expect(refreshAthlete).not.toHaveBeenCalled();
  });
});
