import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TrainingPlanPreviewPage } from "./TrainingPlanPreviewPage";
import { TrainingPlanVersionNotFoundError } from "../features/trainingPlanReview/trainingPlanReviewRepo";
import type { TrainingPlanDraftSummary, TrainingPlanReview } from "../features/trainingPlanReview/trainingPlanReviewTypes";

const { getTrainingPlanDrafts, getTrainingPlanReview, getActivePlanVersionId, getManualPlannedDates, getPlanVersionGeneratedAt } = vi.hoisted(() => ({
  getTrainingPlanDrafts: vi.fn(),
  getTrainingPlanReview: vi.fn(),
  getActivePlanVersionId: vi.fn(),
  getManualPlannedDates: vi.fn(),
  getPlanVersionGeneratedAt: vi.fn(),
}));

vi.mock("../features/trainingPlanReview/trainingPlanReviewRepo", async () => {
  const actual = await vi.importActual<typeof import("../features/trainingPlanReview/trainingPlanReviewRepo")>(
    "../features/trainingPlanReview/trainingPlanReviewRepo"
  );
  return { ...actual, getTrainingPlanDrafts, getTrainingPlanReview, getActivePlanVersionId, getManualPlannedDates, getPlanVersionGeneratedAt };
});

const { acceptTrainingPlan } = vi.hoisted(() => ({ acceptTrainingPlan: vi.fn() }));

vi.mock("../features/trainingPlanReview/acceptTrainingPlan", () => ({ acceptTrainingPlan }));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { email: "athlete@example.com" }, signOut: vi.fn() }),
}));

// Real MemoryRouter + Routes (never a mocked useNavigate/useParams) — this
// exercises the actual route matching, including ProgramDraftSummary's "pick
// another draft" flow now navigating to /training-plan-preview/:id (V0.5_038)
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
  getManualPlannedDates.mockResolvedValue([]);
  // UX-11R.9 — the active plan's generated_at; "active" stands for DRAFT_1's generation time.
  getPlanVersionGeneratedAt.mockImplementation(async (id: string) => (id === DRAFT_2.id ? DRAFT_2.generatedAt : DRAFT_1.generatedAt));
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

    expect(await screen.findByRole("heading", { name: "Ta préparation commence ici" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Construire ma préparation" })).toHaveAttribute("href", "/start");
    expect(getTrainingPlanReview).not.toHaveBeenCalled();
  });

  it("loads and displays the most recent draft when exactly one exists", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1]);
    getTrainingPlanReview.mockResolvedValue(reviewFor(DRAFT_1));

    renderPage();

    expect(await screen.findByText("Première génération de ton plan d'entraînement.")).toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenCalledWith("version-1");
  });

  it("several drafts: shows the most recent, the others folded, and lets the athlete pick another one (UX-06)", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_2, DRAFT_1]);
    getTrainingPlanReview.mockImplementation(async (id: string) => reviewFor(id === "version-2" ? DRAFT_2 : DRAFT_1));

    renderPage();

    // The most recent (version-2) is loaded by default.
    expect(await screen.findByText("Plan régénéré après une modification manuelle.")).toBeInTheDocument();
    // UX-09 — no active plan yet: a first plan, never "draft" / "version non active".
    expect(screen.getByText("Ton premier plan est prêt")).toBeInTheDocument();
    expect(screen.queryByText(/Version non active|Brouillon/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("1 autre version"));
    await userEvent.click(screen.getByRole("button", { name: /Générée le 20 septembre/ }));

    expect(await screen.findByText("Première génération de ton plan d'entraînement.")).toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenLastCalledWith("version-1");
  });

  it("a single draft: no other versions are offered", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1]);
    getTrainingPlanReview.mockResolvedValue(reviewFor(DRAFT_1));

    renderPage();

    await screen.findByText("Première génération de ton plan d'entraînement.");
    expect(screen.queryByText(/autres? versions?/)).not.toBeInTheDocument();
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
          version: { ...DRAFT_1, id: "plan-123", rationale: "Regenerated after declared equipment changed.", relaxedConstraints: [] },
          lifecycleState: "draft",
          blocks: [],
        };
      }
      return reviewFor(id === "version-2" ? DRAFT_2 : DRAFT_1);
    });

    renderPage("/training-plan-preview/plan-123");

    expect(await screen.findByText("Plan régénéré après une modification de ton équipement.")).toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenCalledWith("plan-123");
  });

  it("never falls back to draftList[0] — a more recent draft never overrides the targeted id", async () => {
    // DRAFT_2 is the most recent (generated_at 2026-09-22, after DRAFT_1's
    // 2026-09-20) — getTrainingPlanDrafts orders it first, exactly as the
    // real repository does. The URL explicitly targets DRAFT_1.
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_2, DRAFT_1]);
    getTrainingPlanReview.mockImplementation(async (id: string) => reviewFor(id === "version-2" ? DRAFT_2 : DRAFT_1));

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("Première génération de ton plan d'entraînement.")).toBeInTheDocument();
    expect(screen.queryByText("Plan régénéré après une modification manuelle.")).not.toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "Plan introuvable" })).toBeInTheDocument();
    expect(screen.getByText("Ce plan est introuvable ou n'est plus accessible.")).toBeInTheDocument();
    expect(screen.queryByText("Première génération de ton plan d'entraînement.")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan régénéré après une modification manuelle.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revenir à Programme" })).toHaveAttribute("href", "/training-plan");
  });

  it("still works for a plan whose lifecycle is no longer 'draft' (accepted/superseded/abandoned) — getTrainingPlanReview reads any state", async () => {
    getTrainingPlanDrafts.mockResolvedValue([]); // the targeted plan is no longer a draft, so it's absent from the drafts list
    getTrainingPlanReview.mockResolvedValue({
      version: { ...DRAFT_1, id: "accepted-plan", relaxedConstraints: [] },
      lifecycleState: "accepted",
      blocks: [],
    });

    renderPage("/training-plan-preview/accepted-plan");

    expect(await screen.findByText("Première génération de ton plan d'entraînement.")).toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenCalledWith("accepted-plan");
  });
});

// V0.5_050 / UX-06 — the post-acceptance state must come from the
// re-fetched, persisted lifecycle (handleAccepted → load()), never from local
// click state. UX-06 removed the "Aller à Aujourd'hui" CTA (the tab bar
// covers it): an accepted plan simply stops showing the draft card.
describe("TrainingPlanPreviewPage — acceptance (V0.5_050, UX-06)", () => {
  it("draft → accept success → re-fetch returns accepted → the draft card disappears", async () => {
    let persistedState: TrainingPlanReview["lifecycleState"] = "draft";
    getTrainingPlanDrafts.mockImplementation(async () => (persistedState === "draft" ? [DRAFT_1] : []));
    getTrainingPlanReview.mockImplementation(async () => ({ ...reviewFor(DRAFT_1), lifecycleState: persistedState }));
    acceptTrainingPlan.mockImplementation(async (id: string) => {
      persistedState = "accepted";
      return { ok: true, data: { planVersionId: id, idempotentReplay: false } };
    });

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("Ton premier plan est prêt")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Commencer ma préparation" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() => expect(screen.queryByText("Ton premier plan est prêt")).not.toBeInTheDocument());
    expect(await screen.findByText("Première génération de ton plan d'entraînement.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Commencer ma préparation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Aller à Aujourd'hui" })).not.toBeInTheDocument();
    expect(acceptTrainingPlan).toHaveBeenCalledWith(DRAFT_1.id);
    expect(getTrainingPlanReview).toHaveBeenCalledTimes(2);
  });

  it("accept failure: the plan stays draft and its card stays", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1]);
    getTrainingPlanReview.mockResolvedValue(reviewFor(DRAFT_1));
    acceptTrainingPlan.mockResolvedValue({ ok: false, error: { code: "unknown", message: "Erreur serveur.", retryable: true, action: "retry" } });

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    await userEvent.click(await screen.findByRole("button", { name: "Commencer ma préparation" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(await screen.findByText("Erreur serveur.")).toBeInTheDocument();
    expect(screen.getByText("Ton premier plan est prêt")).toBeInTheDocument();
  });

  it("refresh on an accepted plan's exact URL shows it as the active plan from persisted data alone", async () => {
    getTrainingPlanDrafts.mockResolvedValue([]);
    getTrainingPlanReview.mockResolvedValue({ ...reviewFor(DRAFT_1), lifecycleState: "accepted" });
    getActivePlanVersionId.mockResolvedValue(DRAFT_1.id);

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("Ton plan actuel")).toBeInTheDocument();
    expect(screen.queryByText("Version non active")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accepter ce plan" })).not.toBeInTheDocument();
    expect(acceptTrainingPlan).not.toHaveBeenCalled();
  });

  it("accepted plan with pending drafts: 'Nouvelle version de ton plan prête', opened on demand, older ones folded", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_2, DRAFT_1]);
    getTrainingPlanReview.mockImplementation(async (id: string) =>
      id === "active" ? { ...reviewFor(DRAFT_1), version: { ...DRAFT_1, id: "active", relaxedConstraints: [] }, lifecycleState: "accepted" } : reviewFor(id === "version-2" ? DRAFT_2 : DRAFT_1)
    );
    getActivePlanVersionId.mockResolvedValue("active");

    renderPage("/training-plan-preview/active");

    expect(await screen.findByText("Nouvelle version de ton plan prête")).toBeInTheDocument();
    expect(screen.getByText("Ton plan actuel reste actif tant que tu ne l'acceptes pas.")).toBeInTheDocument();
    expect(screen.getByText("1 ancienne version")).toBeInTheDocument();
    expect(screen.queryByText(/adaptation/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Voir la nouvelle version" }));

    expect(await screen.findByText("Version non active")).toBeInTheDocument();
    expect(getTrainingPlanReview).toHaveBeenLastCalledWith("version-2");
    expect(screen.getByRole("link", { name: "← Revenir à mon plan actif" })).toHaveAttribute("href", "/training-plan");
  });
});

// V06-02 — program days the athlete overrode in their planning: a
// supplementary read, only for the accepted plan, never blocking the page.
describe("TrainingPlanPreviewPage — athlete modifications (V06-02)", () => {
  function acceptedReviewWithSessionOn(date: string): TrainingPlanReview {
    return {
      version: { ...DRAFT_1, relaxedConstraints: [] },
      lifecycleState: "accepted",
      blocks: [
        {
          id: "block-1",
          sequenceNumber: 1,
          name: "Block",
          mode: "IN_SEASON",
          primaryFocus: "base",
          startDate: DRAFT_1.horizonStartDate,
          endDate: DRAFT_1.horizonEndDate,
          weeks: [
            {
              id: "week-1",
              blockId: "block-1",
              weekNumber: 1,
              startDate: "2026-10-19",
              endDate: "2026-10-25",
              weekType: "development",
              rationale: "Standard development week.",
              doseSummary: {
                plannedStrengthSessionCount: 1,
                plannedDhTechnicalSessionCount: 0,
                plannedAerobicSessionCount: 0,
                plannedRestOrRecoveryDayCount: 0,
                totalPlannedMinutes: 60,
              },
              sessions: [
                { id: "s-1", weekId: "week-1", date, kind: "STRENGTH_LOWER", loadProfile: "MODERATE", durationMin: 60, doseTarget: null, rationale: "Standard development week. Adjusted due to recent missed or replaced sessions pattern", prescription: null },
              ],
            },
          ],
        },
      ],
    };
  }

  it("accepted plan: a program day held as a manual row is reported; a manual row outside the program is not", async () => {
    getTrainingPlanDrafts.mockResolvedValue([]);
    getTrainingPlanReview.mockResolvedValue(acceptedReviewWithSessionOn("2026-10-20"));
    getManualPlannedDates.mockResolvedValue(["2026-10-20", "2026-10-21"]);

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("1 jour de ce programme a été modifié par toi dans ton planning.")).toBeInTheDocument();
    expect(getManualPlannedDates).toHaveBeenCalledWith(DRAFT_1.horizonStartDate, DRAFT_1.horizonEndDate);
  });

  it("accepted plan with no modification: no message", async () => {
    getTrainingPlanDrafts.mockResolvedValue([]);
    getTrainingPlanReview.mockResolvedValue(acceptedReviewWithSessionOn("2026-10-20"));
    getManualPlannedDates.mockResolvedValue([]);

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("Semaine standard de développement. Charge allégée car plusieurs séances récentes ont été manquées ou remplacées.")).toBeInTheDocument();
    await waitFor(() => expect(getManualPlannedDates).toHaveBeenCalled());
    expect(screen.queryByText(/modifiés? par toi/)).not.toBeInTheDocument();
  });

  it("read failure: the plan stays fully displayed and usable, the message is simply hidden", async () => {
    getTrainingPlanDrafts.mockResolvedValue([]);
    getTrainingPlanReview.mockResolvedValue(acceptedReviewWithSessionOn("2026-10-20"));
    getManualPlannedDates.mockRejectedValue(new Error("network down"));

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("Semaine standard de développement. Charge allégée car plusieurs séances récentes ont été manquées ou remplacées.")).toBeInTheDocument();
    await waitFor(() => expect(getManualPlannedDates).toHaveBeenCalled());
    expect(screen.getByText("Ton plan actuel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Modifier ma configuration" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/modifiés? par toi/)).not.toBeInTheDocument();
  });

  it("draft plan: never reads the athlete's planning (its days are not projected yet)", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1]);
    getTrainingPlanReview.mockResolvedValue({ ...acceptedReviewWithSessionOn("2026-10-20"), lifecycleState: "draft" });

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("Semaine standard de développement. Charge allégée car plusieurs séances récentes ont été manquées ou remplacées.")).toBeInTheDocument();
    expect(getManualPlannedDates).not.toHaveBeenCalled();
  });
});

// UX-11R.9 (F-4) — with an active plan, a draft is "new" only when generated strictly after it.
describe("TrainingPlanPreviewPage — UX-11R.9 stale drafts", () => {
  it("accepted plan with only an OLDER draft: no 'Nouvelle version' card, the draft is listed as an older version", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1]);
    getTrainingPlanReview.mockImplementation(async (id: string) =>
      id === "active" ? { ...reviewFor(DRAFT_2), version: { ...DRAFT_2, id: "active", relaxedConstraints: [] }, lifecycleState: "accepted" } : reviewFor(DRAFT_1)
    );
    getActivePlanVersionId.mockResolvedValue("active");
    getPlanVersionGeneratedAt.mockResolvedValue(DRAFT_2.generatedAt);

    renderPage("/training-plan-preview/active");

    expect(await screen.findByText("Ton plan actuel")).toBeInTheDocument();
    expect(await screen.findByText("1 ancienne version")).toBeInTheDocument();
    expect(screen.queryByText("Nouvelle version de ton plan prête")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voir la nouvelle version" })).not.toBeInTheDocument();
  });

  it("opening an older draft while a newer plan is active: readable, never 'Accepter ce plan'", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_1]);
    getTrainingPlanReview.mockResolvedValue(reviewFor(DRAFT_1));
    getActivePlanVersionId.mockResolvedValue("active");
    getPlanVersionGeneratedAt.mockResolvedValue(DRAFT_2.generatedAt);

    renderPage(`/training-plan-preview/${DRAFT_1.id}`);

    expect(await screen.findByText("Version plus ancienne que ton plan actif")).toBeInTheDocument();
    expect(screen.getByText("Une version plus récente de ton plan est déjà active : cette version ne peut plus être acceptée.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accepter ce plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Revenir à mon plan actif" })).toHaveAttribute("href", "/training-plan");
  });

  it("a draft generated at the same instant as the active plan is stale too", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT_2]);
    getTrainingPlanReview.mockResolvedValue(reviewFor(DRAFT_2));
    getActivePlanVersionId.mockResolvedValue("active");
    getPlanVersionGeneratedAt.mockResolvedValue(DRAFT_2.generatedAt);

    renderPage(`/training-plan-preview/${DRAFT_2.id}`);

    expect(await screen.findByText("Version plus ancienne que ton plan actif")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accepter ce plan" })).not.toBeInTheDocument();
  });
});
