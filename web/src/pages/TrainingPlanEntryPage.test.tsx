import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TrainingPlanEntryPage } from "./TrainingPlanEntryPage";

const { getActivePlanVersionId, getTrainingPlanDrafts } = vi.hoisted(() => ({
  getActivePlanVersionId: vi.fn(),
  getTrainingPlanDrafts: vi.fn(),
}));
vi.mock("../features/trainingPlanReview/trainingPlanReviewRepo", () => ({ getActivePlanVersionId, getTrainingPlanDrafts }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { email: "athlete@example.test" }, signOut: vi.fn() }) }));

function renderEntry() {
  return render(
    <MemoryRouter initialEntries={["/training-plan"]}>
      <Routes>
        <Route path="/training-plan" element={<TrainingPlanEntryPage />} />
        <Route path="/training-plan-preview/:planVersionId" element={<ExactPreview />} />
        <Route path="/training-plan-preview" element={<div>Latest draft preview</div>} />
        <Route path="/performance-setup" element={<div>Performance setup page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function ExactPreview() {
  return <div>Exact preview</div>;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("TrainingPlanEntryPage — /training-plan (PILOT_012)", () => {
  it("a current plan -> its exact preview", async () => {
    getActivePlanVersionId.mockResolvedValue("plan-123");
    renderEntry();

    expect(await screen.findByText("Exact preview")).toBeInTheDocument();
    expect(getTrainingPlanDrafts).not.toHaveBeenCalled();
  });

  it("no current plan but a draft -> the existing latest-draft preview", async () => {
    getActivePlanVersionId.mockResolvedValue(null);
    getTrainingPlanDrafts.mockResolvedValue([{ id: "draft-1" }]);
    renderEntry();

    expect(await screen.findByText("Latest draft preview")).toBeInTheDocument();
  });

  it("no plan at all -> the Performance Setup to create a first plan", async () => {
    getActivePlanVersionId.mockResolvedValue(null);
    getTrainingPlanDrafts.mockResolvedValue([]);
    renderEntry();

    expect(await screen.findByText("Performance setup page")).toBeInTheDocument();
  });

  it("a lookup failure shows an error with a retry, never a fake plan", async () => {
    getActivePlanVersionId.mockRejectedValue(new Error("network"));
    renderEntry();

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de charger ton plan d'entraînement. Réessaie.");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
