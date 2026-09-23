import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AcceptTrainingPlanButton } from "./AcceptTrainingPlanButton";
import type { TrainingPlanReview } from "../trainingPlanReviewTypes";

const { acceptTrainingPlan } = vi.hoisted(() => ({ acceptTrainingPlan: vi.fn() }));
vi.mock("../acceptTrainingPlan", () => ({ acceptTrainingPlan }));

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
});

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
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

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
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(await screen.findByText("Ce plan ne peut pas être accepté dans son état actuel.")).toBeInTheDocument();
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
