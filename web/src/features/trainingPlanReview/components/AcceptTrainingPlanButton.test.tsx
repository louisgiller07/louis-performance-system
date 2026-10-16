import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AcceptTrainingPlanButton } from "./AcceptTrainingPlanButton";
import type { TrainingPlanReview } from "../trainingPlanReviewTypes";

const { acceptTrainingPlan } = vi.hoisted(() => ({ acceptTrainingPlan: vi.fn() }));
vi.mock("../acceptTrainingPlan", () => ({ acceptTrainingPlan }));
// CONSISTENCY-01 — the manual sessions this acceptance would replace (none by default).
const { getManualDatesReplacedByAcceptance } = vi.hoisted(() => ({ getManualDatesReplacedByAcceptance: vi.fn() }));
vi.mock("../trainingPlanReviewRepo", () => ({ getManualDatesReplacedByAcceptance }));
const clock = vi.hoisted(() => ({ today: "2026-10-16" }));
vi.mock("../../../lib/date", async () => ({ ...(await vi.importActual<typeof import("../../../lib/date")>("../../../lib/date")), todayLocal: () => clock.today }));

const REVIEW: TrainingPlanReview = {
  version: {
    id: "version-1",
    horizonStartDate: "2026-10-19",
    horizonEndDate: "2026-11-01",
    generationTrigger: "initial",
    rationale: "Initial training plan generation.",
    relaxedConstraints: [],
    generatedAt: "2026-09-20T10:00:00Z",
  },
  lifecycleState: "draft",
  blocks: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  getManualDatesReplacedByAcceptance.mockResolvedValue([]);
  clock.today = "2026-10-16";
});

/** The confirmation button once the CONSISTENCY-01 check has answered (disabled while checking). */
async function confirmButton(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe("AcceptTrainingPlanButton", () => {
  it("renders nothing when the reviewed version is not a draft", () => {
    const { container } = render(
      <AcceptTrainingPlanButton review={{ ...REVIEW, lifecycleState: "accepted" }} hasActivePlan={false} onAccepted={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("reveals a confirmation step before calling acceptTrainingPlan", async () => {
    const user = userEvent.setup();
    render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={false} onAccepted={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));

    expect(screen.getByRole("button", { name: "Confirmer" })).toBeInTheDocument();
    expect(acceptTrainingPlan).not.toHaveBeenCalled();
  });

  it("shows a warning in the confirmation step when another plan is already active", async () => {
    const user = userEvent.setup();
    render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={true} onAccepted={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));

    expect(screen.getByText(/remplacera ton plan actuellement actif/)).toBeInTheDocument();
  });

  it("clicking Confirmer calls acceptTrainingPlan with the reviewed version's id, and calls onAccepted on success", async () => {
    acceptTrainingPlan.mockResolvedValue({ ok: true, data: { planVersionId: "version-1", idempotentReplay: false } });
    const onAccepted = vi.fn();
    const user = userEvent.setup();
    render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={false} onAccepted={onAccepted} />);

    await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));
    await user.click(await confirmButton("Confirmer"));

    expect(acceptTrainingPlan).toHaveBeenCalledWith("version-1");
    expect(onAccepted).toHaveBeenCalledWith({ planVersionId: "version-1", idempotentReplay: false });
  });

  it("clicking Annuler returns to idle without calling acceptTrainingPlan", async () => {
    const user = userEvent.setup();
    render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={false} onAccepted={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.getByRole("button", { name: "Accepter ce plan" })).toBeInTheDocument();
    expect(acceptTrainingPlan).not.toHaveBeenCalled();
  });

  it("shows an error message and never calls onAccepted when acceptTrainingPlan fails", async () => {
    acceptTrainingPlan.mockResolvedValue({
      ok: false,
      error: { code: "accept_rejected", message: "Ce plan ne peut pas être accepté dans son état actuel.", retryable: false, action: "generic" },
    });
    const onAccepted = vi.fn();
    const user = userEvent.setup();
    render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={false} onAccepted={onAccepted} />);

    await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));
    await user.click(await confirmButton("Confirmer"));

    expect(await screen.findByText("Ce plan ne peut pas être accepté dans son état actuel.")).toBeInTheDocument();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  describe("CONSISTENCY-01 — manual sessions replaced by the acceptance", () => {
    it("no manual session concerned: the usual « Confirmer », no warning, no extra step", async () => {
      const user = userEvent.setup();
      render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={true} onAccepted={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));
      expect(await confirmButton("Confirmer")).toBeInTheDocument();
      expect(screen.queryByText(/modifications manuelles/)).not.toBeInTheDocument();
      expect(getManualDatesReplacedByAcceptance).toHaveBeenCalledWith("2026-10-19", "2026-11-01"); // from the horizon start (after today)
    });

    it("future manual sessions concerned: the HPM warning, then the rider confirms explicitly before the operation", async () => {
      getManualDatesReplacedByAcceptance.mockResolvedValue(["2026-10-21", "2026-10-24"]);
      acceptTrainingPlan.mockResolvedValue({ ok: true, data: { planVersionId: "version-1", idempotentReplay: false } });
      const onAccepted = vi.fn();
      const user = userEvent.setup();
      render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={true} onAccepted={onAccepted} />);
      await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));
      expect(
        await screen.findByText(
          "En acceptant ce nouveau programme, tes modifications manuelles des prochaines séances de l'ancien programme seront remplacées. Les séances déjà commencées ou terminées restent conservées."
        )
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirmer" })).not.toBeInTheDocument();
      expect(acceptTrainingPlan).not.toHaveBeenCalled();
      await user.click(await confirmButton("Confirmer et remplacer mes modifications"));
      expect(acceptTrainingPlan).toHaveBeenCalledWith("version-1");
      expect(onAccepted).toHaveBeenCalled();
    });

    it("a first programme says it in its own words; the window starts today when the horizon already started", async () => {
      clock.today = "2026-10-25";
      getManualDatesReplacedByAcceptance.mockResolvedValue(["2026-10-27"]);
      const user = userEvent.setup();
      render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={false} onAccepted={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));
      expect(await screen.findByText(/les séances que tu as ajoutées à la main sur ses dates seront remplacées/)).toBeInTheDocument();
      expect(getManualDatesReplacedByAcceptance).toHaveBeenCalledWith("2026-10-25", "2026-11-01");
    });

    it("the check cannot be read: the rider is warned anyway (fail closed) and confirms explicitly", async () => {
      getManualDatesReplacedByAcceptance.mockRejectedValue(new Error("network"));
      const user = userEvent.setup();
      render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={true} onAccepted={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));
      expect(await screen.findByText(/Si tu as modifié à la main des séances à venir/)).toBeInTheDocument();
      expect(await confirmButton("Confirmer et remplacer mes modifications")).toBeInTheDocument();
    });

    it("the confirmation waits for the check: never accepted before the rider could read the warning", async () => {
      getManualDatesReplacedByAcceptance.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      render(<AcceptTrainingPlanButton review={REVIEW} hasActivePlan={true} onAccepted={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Accepter ce plan" }));
      expect(screen.getByText("Vérification de tes séances modifiées…")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Confirmer" });
      expect(button).toBeDisabled();
      await user.click(button);
      expect(acceptTrainingPlan).not.toHaveBeenCalled();
    });
  });
});
