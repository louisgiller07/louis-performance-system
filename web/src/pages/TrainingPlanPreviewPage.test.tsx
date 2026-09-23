import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TrainingPlanPreviewPage } from "./TrainingPlanPreviewPage";
import type { TrainingPlanDraftSummary, TrainingPlanReview } from "../features/trainingPlanReview/trainingPlanReviewTypes";

const { getTrainingPlanDrafts, getTrainingPlanReview, getActivePlanVersionId } = vi.hoisted(() => ({
  getTrainingPlanDrafts: vi.fn(),
  getTrainingPlanReview: vi.fn(),
  getActivePlanVersionId: vi.fn(),
}));

vi.mock("../features/trainingPlanReview/trainingPlanReviewRepo", async () => {
  const actual = await vi.importActual<typeof import("../features/trainingPlanReview/trainingPlanReviewRepo")>(
    "../features/trainingPlanReview/trainingPlanReviewRepo"
  );
  return { ...actual, getTrainingPlanDrafts, getTrainingPlanReview, getActivePlanVersionId };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { email: "athlete@example.com" }, signOut: vi.fn() }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <TrainingPlanPreviewPage />
    </MemoryRouter>
  );
}

const DRAFT_1: TrainingPlanDraftSummary = {
  id: "version-1",
  horizonStartDate: "2026-10-19",
  horizonEndDate: "2026-11-01",
  generationTrigger: "initial",
  rationale: "Initial training plan generation.",
  generatedAt: "2026-09-20T10:00:00Z",
};

const DRAFT_2: TrainingPlanDraftSummary = {
  id: "version-2",
  horizonStartDate: "2026-11-02",
  horizonEndDate: "2026-11-15",
  generationTrigger: "manual_edit",
  rationale: "Regenerated after a manual edit.",
  generatedAt: "2026-09-22T10:00:00Z",
};

function reviewFor(draft: TrainingPlanDraftSummary): TrainingPlanReview {
  return {
    version: { ...draft, relaxedConstraints: [] },
    lifecycleState: "draft",
    blocks: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getActivePlanVersionId.mockResolvedValue(null);
});

describe("TrainingPlanPreviewPage", () => {
  it("shows a loading state while fetching", () => {
    getTrainingPlanDrafts.mockReturnValue(new Promise(() => {})); // never resolves within this test

    renderPage();

    expect(screen.getByText("Chargement…")).toBeInTheDocument();
  });

  it("shows an empty state with a link to Performance Setup when there is no draft", async () => {
    getTrainingPlanDrafts.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("Aucun plan généré pour le moment.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurer mon profil" })).toHaveAttribute("href", "/performance-setup");
    expect(getTrainingPlanReview).not.toHaveBeenCalled();
  });

  it("loads and displays the most recent draft when exactly one exists", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1]);
    getTrainingPlanReview.mockResolvedValue(reviewFor(DRAFT_1));

    renderPage();

    expect(await screen.findByText("Initial training plan generation.")).toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenCalledWith("version-1");
  });

  it("shows the draft list only when several drafts exist, and lets the athlete pick another one", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_2, DRAFT_1]);
    getTrainingPlanReview.mockImplementation(async (id: string) => reviewFor(id === "version-2" ? DRAFT_2 : DRAFT_1));

    renderPage();

    expect(await screen.findByText("2 plans en attente d'acceptation")).toBeInTheDocument();
    // The most recent (version-2) is loaded by default.
    await waitFor(() => expect(getTrainingPlanReview).toHaveBeenCalledWith("version-2"));
  });

  it("never shows the draft list when only one draft exists", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1]);
    getTrainingPlanReview.mockResolvedValue(reviewFor(DRAFT_1));

    renderPage();

    await screen.findByText("Initial training plan generation.");
    expect(screen.queryByText(/plans en attente/)).not.toBeInTheDocument();
  });

  it("shows a clear error message, never a raw Supabase error, when the repository throws", async () => {
    getTrainingPlanDrafts.mockRejectedValue(new Error("relation does not exist"));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de charger ton plan d'entraînement. Réessaie.");
    expect(screen.queryByText(/relation does not exist/)).not.toBeInTheDocument();
  });
});
