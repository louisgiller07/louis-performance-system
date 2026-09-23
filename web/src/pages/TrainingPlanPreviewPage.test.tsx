import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TrainingPlanPreviewPage } from "./TrainingPlanPreviewPage";
import { TrainingPlanVersionNotFoundError } from "../features/trainingPlanReview/trainingPlanReviewRepo";
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

// Real MemoryRouter + Routes (never a mocked useNavigate/useParams) — this
// exercises the actual route matching, including DraftList's "pick another
// draft" flow now navigating to /training-plan-preview/:id (V0.5_038)
// instead of fetching locally: clicking an entry drives a real route
// change, which re-renders this same page with a new :planVersionId param.
function renderPage(path: string = "/training-plan-preview") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/training-plan-preview" element={<TrainingPlanPreviewPage />} />
        <Route path="/training-plan-preview/:planVersionId" element={<TrainingPlanPreviewPage />} />
      </Routes>
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

// V0.5_038 — an explicit :planVersionId in the URL is the source of truth
// whenever present. This is what closes the real race condition: a
// just-generated plan must never be silently replaced by "whichever draft
// happens to be most recent" once another generation completes.
describe("TrainingPlanPreviewPage — targeted /:planVersionId route", () => {
  it("loads getTrainingPlanReview(planVersionId) directly and displays exactly that plan", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1, DRAFT_2]);
    getTrainingPlanReview.mockImplementation(async (id: string) => {
      if (id === "plan-123") {
        return {
          version: { ...DRAFT_1, id: "plan-123", rationale: "Targeted plan.", relaxedConstraints: [] },
          lifecycleState: "draft",
          blocks: [],
        };
      }
      return reviewFor(id === "version-2" ? DRAFT_2 : DRAFT_1);
    });

    renderPage("/training-plan-preview/plan-123");

    expect(await screen.findByText("Targeted plan.")).toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenCalledWith("plan-123");
  });

  it("never falls back to draftList[0] — a more recent draft never overrides the targeted id", async () => {
    // DRAFT_2 is the most recent (generated_at 2026-09-22, after DRAFT_1's
    // 2026-09-20) — getTrainingPlanDrafts orders it first, exactly as the
    // real repository does. The URL explicitly targets DRAFT_1.
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_2, DRAFT_1]);
    getTrainingPlanReview.mockImplementation(async (id: string) => reviewFor(id === "version-2" ? DRAFT_2 : DRAFT_1));

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("Initial training plan generation.")).toBeInTheDocument();
    expect(screen.queryByText("Regenerated after a manual edit.")).not.toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenCalledWith(DRAFT_1.id);
    expect(getTrainingPlanReview).not.toHaveBeenCalledWith(DRAFT_2.id);
  });

  it("shows a dedicated not-found state when the targeted id does not resolve, never a silent fallback to another draft", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1, DRAFT_2]);
    getTrainingPlanReview.mockImplementation(async (id: string) => {
      if (id === "missing-id") throw new TrainingPlanVersionNotFoundError("missing-id");
      return reviewFor(id === "version-2" ? DRAFT_2 : DRAFT_1);
    });

    renderPage("/training-plan-preview/missing-id");

    expect(await screen.findByText("Ce plan est introuvable ou n'est plus accessible.")).toBeInTheDocument();
    expect(screen.queryByText("Initial training plan generation.")).not.toBeInTheDocument();
    expect(screen.queryByText("Regenerated after a manual edit.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir les plans disponibles" })).toHaveAttribute("href", "/training-plan-preview");
  });

  it("still works for a plan whose lifecycle is no longer 'draft' (accepted/superseded/abandoned) — getTrainingPlanReview reads any state", async () => {
    getTrainingPlanDrafts.mockResolvedValue([]); // the targeted plan is no longer a draft, so it's absent from the drafts list
    getTrainingPlanReview.mockResolvedValue({
      version: { ...DRAFT_1, id: "accepted-plan", relaxedConstraints: [] },
      lifecycleState: "accepted",
      blocks: [],
    });

    renderPage("/training-plan-preview/accepted-plan");

    expect(await screen.findByText("Initial training plan generation.")).toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenCalledWith("accepted-plan");
  });
});
