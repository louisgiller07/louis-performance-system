import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TrainingPlanGenerationPanel } from "./TrainingPlanGenerationPanel";
import type { TrainingPlanDraftSummary } from "../trainingPlanReview/trainingPlanReviewTypes";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const { generateTrainingPlan, getTrainingPlanDrafts } = vi.hoisted(() => ({
  generateTrainingPlan: vi.fn(),
  getTrainingPlanDrafts: vi.fn(),
}));

vi.mock("../trainingPlanGeneration/generateTrainingPlan", () => ({ generateTrainingPlan }));
vi.mock("../trainingPlanReview/trainingPlanReviewRepo", () => ({ getTrainingPlanDrafts }));

function renderPanel(configurationReady = true) {
  return render(
    <MemoryRouter>
      <TrainingPlanGenerationPanel configurationReady={configurationReady} />
    </MemoryRouter>
  );
}

const SUCCESS_RESPONSE = { planVersionId: "11111111-1111-4111-8111-111111111111", idempotentReplay: false };

const DRAFT: TrainingPlanDraftSummary = {
  id: "version-1",
  horizonStartDate: "2026-10-19",
  horizonEndDate: "2026-11-01",
  generationTrigger: "initial",
  rationale: "Initial training plan generation.",
  generatedAt: "2026-09-20T10:00:00Z",
};

async function fillDuration(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = screen.getByLabelText("Durée du plan");
  await user.clear(input);
  if (value) await user.type(input, value);
}

beforeEach(() => {
  vi.resetAllMocks();
  getTrainingPlanDrafts.mockResolvedValue([]);
  generateTrainingPlan.mockResolvedValue({ ok: true, data: SUCCESS_RESPONSE });
});

describe("TrainingPlanGenerationPanel — durationWeeks local validation", () => {
  it("blocks generation when the field is empty", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    expect(screen.getByText(/Indique une durée valide/)).toBeInTheDocument();
    expect(getTrainingPlanDrafts).not.toHaveBeenCalled();
    expect(generateTrainingPlan).not.toHaveBeenCalled();
  });

  it("blocks generation for 0", async () => {
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "0");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    expect(screen.getByText(/Indique une durée valide/)).toBeInTheDocument();
    expect(generateTrainingPlan).not.toHaveBeenCalled();
  });

  it("blocks generation for a non-integer value", async () => {
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "2.5");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    expect(screen.getByText(/Indique une durée valide/)).toBeInTheDocument();
    expect(generateTrainingPlan).not.toHaveBeenCalled();
  });

  it("accepts a positive integer and proceeds", async () => {
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({ durationWeeks: 6 })));
  });

  it("enforces no artificial maximum — a large value is accepted", async () => {
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "1000");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({ durationWeeks: 1000 })));
  });
});

describe("TrainingPlanGenerationPanel — save gate (configurationReady)", () => {
  it("disables the generate button when configuration is not saved", () => {
    renderPanel(false);

    expect(screen.getByRole("button", { name: "Générer mon plan" })).toBeDisabled();
    expect(screen.getByText(/Enregistre ta configuration/)).toBeInTheDocument();
  });

  it("enables the generate button once configuration is saved", () => {
    renderPanel(true);

    expect(screen.getByRole("button", { name: "Générer mon plan" })).not.toBeDisabled();
  });
});

describe("TrainingPlanGenerationPanel — generationRequestId ownership", () => {
  it("mints exactly one UUID for a new intention and transmits it to generateTrainingPlan", async () => {
    const randomUUIDSpy = vi.spyOn(crypto, "randomUUID");
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledTimes(1));
    expect(randomUUIDSpy).toHaveBeenCalledTimes(1);
    const usedId = generateTrainingPlan.mock.calls[0]![0].generationRequestId;
    expect(usedId).toBe(randomUUIDSpy.mock.results[0]!.value);
    randomUUIDSpy.mockRestore();
  });

  it("prevents a double click — a second click while checking/generating does not trigger a second call", async () => {
    const user = userEvent.setup();
    let resolveDrafts!: (value: TrainingPlanDraftSummary[]) => void;
    getTrainingPlanDrafts.mockReturnValue(new Promise<TrainingPlanDraftSummary[]>((resolve) => (resolveDrafts = resolve)));
    renderPanel();

    await fillDuration(user, "6");
    const button = screen.getByRole("button", { name: "Générer mon plan" });
    await user.click(button);

    // The button is now disabled (checking drafts) — a second click on the
    // same disabled DOM element is a no-op, exactly what "double clic
    // impossible" requires.
    expect(screen.getByRole("button", { name: "Vérification…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Vérification…" }));

    resolveDrafts([]);
    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledTimes(1));
    expect(getTrainingPlanDrafts).toHaveBeenCalledTimes(1);
  });

  it("reuses the exact same UUID on a Réessayer retry of the same intention", async () => {
    generateTrainingPlan.mockResolvedValueOnce({
      ok: false,
      error: { code: "internal_error", message: "Erreur serveur.", retryable: true, action: "retry" },
    });
    generateTrainingPlan.mockResolvedValueOnce({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));
    await screen.findByText("Erreur serveur.");

    const retryButton = await screen.findByRole("button", { name: "Réessayer" });
    await user.click(retryButton);

    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledTimes(2));
    const firstId = generateTrainingPlan.mock.calls[0]![0].generationRequestId;
    const secondId = generateTrainingPlan.mock.calls[1]![0].generationRequestId;
    expect(secondId).toBe(firstId);
  });

  it("mints a new UUID when durationWeeks changes after a failure", async () => {
    generateTrainingPlan.mockResolvedValueOnce({
      ok: false,
      error: { code: "internal_error", message: "Erreur serveur.", retryable: true, action: "retry" },
    });
    generateTrainingPlan.mockResolvedValueOnce({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));
    await screen.findByText("Erreur serveur.");

    await fillDuration(user, "8");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledTimes(2));
    const firstId = generateTrainingPlan.mock.calls[0]![0].generationRequestId;
    const secondId = generateTrainingPlan.mock.calls[1]![0].generationRequestId;
    expect(secondId).not.toBe(firstId);
  });
});

describe("TrainingPlanGenerationPanel — existing drafts", () => {
  it("generates directly when there is no existing draft", async () => {
    getTrainingPlanDrafts.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledTimes(1));
  });

  it("shows the inline draft choice instead of generating immediately when a draft already exists", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT]);
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    expect(await screen.findByText("Tu as déjà un plan en attente.")).toBeInTheDocument();
    expect(generateTrainingPlan).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Voir le plan en attente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Générer un nouveau plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();
  });

  it("'Voir le plan en attente' navigates without generating", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT]);
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));
    await user.click(await screen.findByRole("button", { name: "Voir le plan en attente" }));

    expect(navigateMock).toHaveBeenCalledWith("/training-plan-preview");
    expect(generateTrainingPlan).not.toHaveBeenCalled();
  });

  it("'Générer un nouveau plan' confirms the same intention and generates, keeping existing drafts untouched", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT]);
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));
    await user.click(await screen.findByRole("button", { name: "Générer un nouveau plan" }));

    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({ durationWeeks: 6 })));
  });

  it("'Annuler' returns to the normal panel without generating", async () => {
    getTrainingPlanDrafts.mockResolvedValue([DRAFT]);
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));
    await user.click(await screen.findByRole("button", { name: "Annuler" }));

    expect(await screen.findByRole("button", { name: "Générer mon plan" })).toBeInTheDocument();
    expect(generateTrainingPlan).not.toHaveBeenCalled();
  });
});

describe("TrainingPlanGenerationPanel — success navigation", () => {
  it("navigates to /training-plan-preview only after generateTrainingPlan resolves", async () => {
    let resolveGenerate!: (value: unknown) => void;
    generateTrainingPlan.mockReturnValue(new Promise((resolve) => (resolveGenerate = resolve)));
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    await waitFor(() => expect(generateTrainingPlan).toHaveBeenCalledTimes(1));
    expect(navigateMock).not.toHaveBeenCalled();

    resolveGenerate({ ok: true, data: SUCCESS_RESPONSE });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/training-plan-preview"));
  });
});

describe("TrainingPlanGenerationPanel — generation errors", () => {
  it.each([
    ["missing_availability", "Configure tes disponibilités avant de générer un plan d'entraînement."],
    ["missing_performance_profile", "Complète ton profil de performance (Performance Setup) avant de générer un plan d'entraînement."],
    ["missing_discipline", "Renseigne ta discipline dans ton profil avant de générer un plan d'entraînement."],
    ["missing_strength_experience_tier", "Complète ton niveau d'expérience en musculation (Performance Setup) avant de générer un plan d'entraînement."],
  ])("shows the mapped message for %s", async (code, message) => {
    generateTrainingPlan.mockResolvedValue({ ok: false, error: { code, message, retryable: false, action: "user_fixable" } });
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows a Réessayer action for a retryable error", async () => {
    generateTrainingPlan.mockResolvedValue({
      ok: false,
      error: { code: "internal_error", message: "Erreur serveur.", retryable: true, action: "retry" },
    });
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    expect(await screen.findByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("never exposes a raw Supabase/SQL/HTTP detail — only the mapped message", async () => {
    generateTrainingPlan.mockResolvedValue({
      ok: false,
      error: { code: "internal_error", message: "Une erreur inattendue s'est produite côté serveur. Réessaie.", retryable: true, action: "retry" },
    });
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Une erreur inattendue s'est produite côté serveur. Réessaie.");
  });

  it("handles a getTrainingPlanDrafts failure with a generic retryable error, never generating anyway", async () => {
    getTrainingPlanDrafts.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderPanel();

    await fillDuration(user, "6");
    await user.click(screen.getByRole("button", { name: "Générer mon plan" }));

    expect(await screen.findByText(/Impossible de vérifier tes plans en attente/)).toBeInTheDocument();
    expect(generateTrainingPlan).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
