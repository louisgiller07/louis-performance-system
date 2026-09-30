import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { InsightsPage } from "./InsightsPage";
import type { PatternInsightCandidate, PatternInsightSnapshot } from "../features/insights/insightsTypes";

const signOut = vi.fn();
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { email: "louis@example.test" }, signOut }),
}));

const { getInsights, submitReview } = vi.hoisted(() => ({ getInsights: vi.fn(), submitReview: vi.fn() }));
vi.mock("../features/insights/insightsRepo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/insights/insightsRepo")>();
  return { ...actual, getInsights, submitReview };
});

function snapshot(overrides: Partial<PatternInsightSnapshot> = {}): PatternInsightSnapshot {
  return {
    insightProjectorVersion: "1.0.0",
    athleteId: "athlete-1",
    insightKind: "recommendation_execution_alignment",
    detectorRuleId: "recommendation_vs_actual_execution",
    detectorRuleVersion: "1.0.0",
    rangeFromDate: "1900-01-01",
    rangeToDate: "9999-12-31",
    direction: "supporting",
    title: "Exécution des recommandations",
    statement: "Les séances recommandées sont réalisées comme prévu.",
    caveats: ["Décrit l'exécution observée."],
    evidenceCount: 1,
    supportingCount: 1,
    contradictingCount: 0,
    neutralCount: 0,
    directionalEvidenceCount: 1,
    supportingRatio: 1,
    contradictingRatio: 0,
    neutralRatio: 0,
    evidenceBalance: "supporting_only",
    firstEventDate: "2026-06-20",
    lastEventDate: "2026-06-20",
    sourceEvidenceRefs: [
      { identityId: "id-1", revisionId: "rev-1", revisionNumber: 1, evaluationKey: "decision:abc", evidenceKey: "decision:abc", eventType: "supporting", eventDate: "2026-06-20" },
    ],
    ...overrides,
  };
}

function candidate(overrides: Partial<PatternInsightCandidate> = {}): PatternInsightCandidate {
  return { snapshot: snapshot(), reviewState: "unreviewed", currentReview: null, ...overrides };
}

function okInsights(candidates: PatternInsightCandidate[]) {
  return { ok: true as const, data: { range: { fromDate: "1900-01-01", toDate: "9999-12-31" }, candidates } };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/insights"]}>
      <InsightsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("InsightsPage — loading/empty/error states", () => {
  it("shows a loading state before get-insights resolves", () => {
    getInsights.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Chargement/)).toBeInTheDocument();
  });

  it("shows a normal (non-error) empty state when there are zero candidates", async () => {
    getInsights.mockResolvedValue(okInsights([]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Quand des tendances sont observées dans tes check-ins et tes séances, elles apparaissent ici.")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a recoverable error state with a retry that calls get-insights again", async () => {
    getInsights.mockResolvedValueOnce({ ok: false, error: { code: "internal_error", message: "Une erreur inattendue s'est produite côté serveur. Réessaie.", retryable: true, action: "retry" } });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Une erreur inattendue"));

    getInsights.mockResolvedValueOnce(okInsights([]));
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Quand des tendances sont observées dans tes check-ins et tes séances, elles apparaissent ici.")).toBeInTheDocument());
    expect(getInsights).toHaveBeenCalledTimes(2);
  });

  it("signs out on a session_issue load error", async () => {
    getInsights.mockResolvedValue({ ok: false, error: { code: "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" } });
    renderPage();
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

describe("InsightsPage — candidate rendering", () => {
  it("renders title, statement, and evidence summary counts", async () => {
    getInsights.mockResolvedValue(okInsights([candidate()]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());
    // UX-10B-2A — the web's rider sentence for kind × direction, observations (never days), caveats kept.
    expect(screen.getByText("Tes séances recommandées sont le plus souvent réalisées comme prévu.")).toBeInTheDocument();
    expect(screen.getByText(/^1 observation · du /)).toBeInTheDocument();
    expect(screen.getByText("Décrit l'exécution observée.")).toBeInTheDocument();
    expect(screen.getByText("Des tendances observées dans tes check-ins et tes séances. Elles ne changent pas ton plan.")).toBeInTheDocument();
    expect(screen.getByText("Ta réponse est gardée ; elle ne modifie pas ton plan.")).toBeInTheDocument();
    expect(screen.getByText("Ta précision ne modifie pas ton plan.")).toBeInTheDocument();
  });

  it("never dumps raw sourceEvidenceRefs JSON or identity/revision UUIDs into the page", async () => {
    getInsights.mockResolvedValue(okInsights([candidate()]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());
    expect(screen.queryByText(/id-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rev-1/)).not.toBeInTheDocument();
  });

  it("unreviewed state shows the unreviewed badge and no prior-review block", async () => {
    getInsights.mockResolvedValue(okInsights([candidate({ reviewState: "unreviewed", currentReview: null })]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());
    expect(screen.queryByText(/Tu as répondu/)).not.toBeInTheDocument();
  });

  it("reviewed_current state shows the current badge and the prior decision", async () => {
    const reviewed = candidate({
      reviewState: "reviewed_current",
      currentReview: { athleteId: "athlete-1", detectorRuleId: "recommendation_vs_actual_execution", detectorRuleVersion: "1.0.0", insightKind: "recommendation_execution_alignment", decision: "accepted_as_insight", reviewNumber: 1, reviewerNote: null, candidateSnapshot: snapshot() },
    });
    getInsights.mockResolvedValue(okInsights([reviewed]));
    renderPage();
    // UX-10B-2A — the rider's own answer, in their words.
    await waitFor(() => expect(screen.getByText("Tu as répondu : Ça me parle")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ça me parle" })).toBeInTheDocument();
  });

  it("reviewed_stale state visually distinguishes staleness and keeps the prior review visible, never hides it", async () => {
    const stale = candidate({
      reviewState: "reviewed_stale",
      currentReview: { athleteId: "athlete-1", detectorRuleId: "recommendation_vs_actual_execution", detectorRuleVersion: "1.0.0", insightKind: "recommendation_execution_alignment", decision: "dismissed", reviewNumber: 2, reviewerNote: "old note", candidateSnapshot: snapshot() },
    });
    getInsights.mockResolvedValue(okInsights([stale]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Cette tendance a changé depuis ta réponse. Tu peux répondre à nouveau.")).toBeInTheDocument());
    expect(screen.getByText("Tu as répondu : Pas vraiment")).toBeInTheDocument();
    expect(screen.getByText("old note")).toBeInTheDocument();
  });

  it("exposes exactly the three review action buttons, no fourth", async () => {
    getInsights.mockResolvedValue(okInsights([candidate()]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ça me parle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pas vraiment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pas encore sûr" })).toBeInTheDocument();
  });

  it("has a usable optional note field", async () => {
    getInsights.mockResolvedValue(okInsights([candidate()]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());
    const note = screen.getByLabelText(/Ajouter une précision \(facultatif\)/);
    await userEvent.type(note, "ma note");
    expect(note).toHaveValue("ma note");
  });
});

describe("InsightsPage — submitting a review", () => {
  it("submits exactly the built body including a trimmed note, and disables controls while in flight", async () => {
    getInsights.mockResolvedValue(okInsights([candidate()]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());

    let resolveSubmit: (value: unknown) => void = () => {};
    submitReview.mockReturnValue(new Promise((resolve) => (resolveSubmit = resolve)));

    await userEvent.type(screen.getByLabelText(/Ajouter une précision \(facultatif\)/), "  ma note  ");
    await userEvent.click(screen.getByRole("button", { name: "Ça me parle" }));

    expect(submitReview).toHaveBeenCalledTimes(1);
    expect(submitReview).toHaveBeenCalledWith(expect.objectContaining({ decision: "accepted_as_insight", reviewerNote: "ma note" }));
    expect(screen.getByRole("button", { name: "Ça me parle" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pas vraiment" })).toBeDisabled();

    getInsights.mockResolvedValue(okInsights([candidate({ reviewState: "reviewed_current" })]));
    resolveSubmit({ ok: true, data: { action: "inserted", reviewNumber: 1 } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Ça me parle" })).not.toBeDisabled());
  });

  it("whitespace-only note is submitted as null, never as blank/whitespace content", async () => {
    getInsights.mockResolvedValue(okInsights([candidate()]));
    submitReview.mockResolvedValue({ ok: true, data: { action: "inserted", reviewNumber: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Ajouter une précision \(facultatif\)/), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss".replace("Dismiss", "Pas vraiment") }));
    expect(submitReview).toHaveBeenCalledWith(expect.objectContaining({ reviewerNote: null }));
  });

  it("success: refetches get-insights and renders exactly the fresh server state (§30 — never locally infers reviewState)", async () => {
    getInsights.mockResolvedValueOnce(okInsights([candidate({ reviewState: "unreviewed" })]));
    submitReview.mockResolvedValue({ ok: true, data: { action: "inserted", reviewNumber: 1 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());

    // Deliberately something the client could NEVER safely infer from a
    // bare "inserted" success: reviewed_stale immediately after insertion
    // (as if evidence changed between comparison and persistence — the
    // locked semantics-A scenario). If the UI rendered this by copying
    // {action:"inserted"} into a local reviewState, this would fail.
    const refetched = candidate({
      reviewState: "reviewed_stale",
      currentReview: { athleteId: "athlete-1", detectorRuleId: "recommendation_vs_actual_execution", detectorRuleVersion: "1.0.0", insightKind: "recommendation_execution_alignment", decision: "accepted_as_insight", reviewNumber: 1, reviewerNote: null, candidateSnapshot: snapshot() },
    });
    getInsights.mockResolvedValueOnce(okInsights([refetched]));

    await userEvent.click(screen.getByRole("button", { name: "Ça me parle" }));
    await waitFor(() => expect(screen.getByText("Cette tendance a changé depuis ta réponse. Tu peux répondre à nouveau.")).toBeInTheDocument());
    expect(getInsights).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Réponse enregistrée.")).toBeInTheDocument();
  });

  it("unchanged success also triggers a refetch (not treated differently from inserted/superseded)", async () => {
    getInsights.mockResolvedValueOnce(okInsights([candidate()]));
    submitReview.mockResolvedValue({ ok: true, data: { action: "unchanged", reviewNumber: 1 } });
    getInsights.mockResolvedValueOnce(okInsights([candidate({ reviewState: "reviewed_current" })]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Ça me parle" }));
    await waitFor(() => expect(getInsights).toHaveBeenCalledTimes(2));
  });
});

describe("InsightsPage — stale_candidate (§29: must never auto-resubmit)", () => {
  it("shows the fresh candidate via refetch, displays a message, and requires a brand-new human click before any second submitReview call", async () => {
    getInsights.mockResolvedValueOnce(okInsights([candidate()]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());

    const staleCandidate = candidate({ snapshot: snapshot({ evidenceCount: 2, sourceEvidenceRefs: [] }) });
    submitReview.mockResolvedValueOnce({
      ok: false,
      kind: "stale_candidate",
      candidate: staleCandidate,
      error: { code: "stale_candidate", message: "L'insight a changé.", retryable: false, action: "user_fixable" },
    });
    const refetched = okInsights([staleCandidate]);
    getInsights.mockResolvedValueOnce(refetched);

    await userEvent.click(screen.getByRole("button", { name: "Ça me parle" }));

    await waitFor(() => expect(screen.getByText(/Cette tendance a changé depuis ta dernière visite/)).toBeInTheDocument());
    expect(screen.getByText(/^2 observations · du /)).toBeInTheDocument(); // the fresh (C2) evidenceCount, from the refetch — never the stale C1 count

    // submit-review call count = 1 — no automatic resubmit occurred.
    expect(submitReview).toHaveBeenCalledTimes(1);
    // Controls are usable again — a NEW explicit click is required, never
    // auto-approved.
    expect(screen.getByRole("button", { name: "Ça me parle" })).not.toBeDisabled();

    submitReview.mockResolvedValueOnce({ ok: true, data: { action: "inserted", reviewNumber: 1 } });
    getInsights.mockResolvedValueOnce(okInsights([candidate({ reviewState: "reviewed_current" })]));
    await userEvent.click(screen.getByRole("button", { name: "Ça me parle" }));
    await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(2));
  });
});

describe("InsightsPage — candidate_not_found", () => {
  it("refetches, the candidate disappears per fresh server state, and shows a non-fatal page message", async () => {
    getInsights.mockResolvedValueOnce(okInsights([candidate()]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());

    submitReview.mockResolvedValueOnce({ ok: false, kind: "candidate_not_found", error: { code: "candidate_not_found", message: "Cette tendance n'est plus disponible.", retryable: false, action: "user_fixable" } });
    getInsights.mockResolvedValueOnce(okInsights([])); // vanished from the fresh authoritative response

    await userEvent.click(screen.getByRole("button", { name: "Ça me parle" }));

    await waitFor(() => expect(screen.queryByText("Réalisation de tes séances")).not.toBeInTheDocument());
    expect(screen.getByText("Cette tendance n'est plus disponible.")).toBeInTheDocument();
    expect(screen.getByText("Quand des tendances sont observées dans tes check-ins et tes séances, elles apparaissent ici.")).toBeInTheDocument();
  });
});

describe("InsightsPage — generic submit error", () => {
  it("shows a sanitized per-card error message without refetching or crashing", async () => {
    getInsights.mockResolvedValueOnce(okInsights([candidate()]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Réalisation de tes séances")).toBeInTheDocument());

    submitReview.mockResolvedValueOnce({ ok: false, kind: "other", error: { code: "internal_error", message: "Une erreur inattendue s'est produite côté serveur. Réessaie.", retryable: true, action: "retry" } });

    await userEvent.click(screen.getByRole("button", { name: "Ça me parle" }));
    await waitFor(() => expect(screen.getByText("Une erreur inattendue s'est produite côté serveur. Réessaie.")).toBeInTheDocument());
    expect(getInsights).toHaveBeenCalledTimes(1); // no refetch on a generic failure — nothing changed server-side
  });
});
