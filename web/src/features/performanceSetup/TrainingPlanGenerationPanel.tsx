import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components/Card";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { generateTrainingPlan, type GenerateTrainingPlanResult } from "../trainingPlanGeneration/generateTrainingPlan";
import type { GenerateTrainingPlanError } from "../trainingPlanGeneration/generateTrainingPlanErrors";
import { getTrainingPlanDrafts } from "../trainingPlanReview/trainingPlanReviewRepo";
import type { TrainingPlanDraftSummary } from "../trainingPlanReview/trainingPlanReviewTypes";

export interface TrainingPlanGenerationPanelProps {
  /**
   * True exactly when Performance Setup has no unsaved changes (V0.5_036
   * lock, §3): a plan must never be generated from configuration the
   * athlete has edited but not yet saved. PerformanceSetup.tsx owns the
   * dirty-tracking itself (this panel has no visibility into the form) and
   * passes the already-computed result down.
   */
  configurationReady: boolean;
}

const DRAFTS_CHECK_ERROR: GenerateTrainingPlanError = {
  code: "drafts_check_failed",
  message: "Impossible de vérifier tes plans en attente. Réessaie.",
  retryable: true,
  action: "retry",
};

type PanelState =
  | { kind: "idle" }
  | { kind: "checking_drafts" }
  | { kind: "existing_draft_choice"; drafts: TrainingPlanDraftSummary[] }
  | { kind: "generating" }
  | { kind: "error"; error: GenerateTrainingPlanError };

/**
 * Parses the raw text input into a strictly positive integer, or `null` if
 * invalid — digits only (no decimal point, no sign, no leading/trailing
 * text), matching "integer >= 1, no maximum" (V0.5_031/036 lock: no other
 * bound is a locked product decision, so none is invented here).
 */
function parseDurationWeeks(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

/**
 * /performance-setup's generation trigger (V0.5_036) — the real bridge
 * between a saved Performance Setup and /training-plan-preview. Never
 * exposes TrainingPlanBlock fields (mode/name/primaryFocus/startDate/
 * endDate/sequenceNumber) or generationRequestId to the athlete — only
 * `durationWeeks` is a real user input (V0.5_031/032/034 lock).
 *
 * generationRequestId ownership: this component is the UI intention owner
 * (V0.5_031's diagram) — it mints the one `crypto.randomUUID()` call for
 * this whole feature, on the first real click of a new generation intent,
 * and never elsewhere. The id is invalidated (set back to `null`, forcing a
 * fresh mint on the next click) whenever: the athlete edits durationWeeks,
 * a new Performance Setup save completes, or generation succeeds (a used
 * intention is consumed). It is deliberately preserved across a drafts
 * check, an "existing draft" choice, a "Réessayer" retry of a retryable
 * error, and an "Annuler" — none of those are a new intention.
 */
export function TrainingPlanGenerationPanel({ configurationReady }: TrainingPlanGenerationPanelProps) {
  const navigate = useNavigate();
  const [durationWeeksInput, setDurationWeeksInput] = useState("");
  const [durationWeeksError, setDurationWeeksError] = useState<string | null>(null);
  const [generationRequestId, setGenerationRequestId] = useState<string | null>(null);
  const [state, setState] = useState<PanelState>({ kind: "idle" });

  // A completed save (configurationReady flips false -> true) invalidates
  // any pending intention — V0.5_036 §5, trigger (b). The initial mount
  // also presents as "false -> true" from an undefined starting point; the
  // ref below skips that first render so a fresh page load never clears a
  // (nonexistent) intention.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (configurationReady) {
      setGenerationRequestId(null);
      setState({ kind: "idle" });
    }
  }, [configurationReady]);

  function handleDurationWeeksChange(raw: string) {
    setDurationWeeksInput(raw);
    setDurationWeeksError(null);
    // Editing the duration invalidates any pending intention — V0.5_036
    // §5, trigger (a). Same reasoning as the save-completion effect above.
    if (generationRequestId !== null) {
      setGenerationRequestId(null);
      setState({ kind: "idle" });
    }
  }

  async function runGeneration(requestId: string, durationWeeks: number) {
    // Defensive re-check — the button is already disabled whenever
    // !configurationReady, same "belt and suspenders" discipline as
    // PerformanceSetup.tsx's own handleSave guard.
    if (!configurationReady) {
      setState({ kind: "idle" });
      return;
    }

    setState({ kind: "generating" });
    const result: GenerateTrainingPlanResult = await generateTrainingPlan({ generationRequestId: requestId, durationWeeks });

    if (result.ok) {
      // Success consumes the intention — the next click starts a new one.
      // V0.5_038 — navigates to the exact planVersionId returned, never the
      // id-less "/training-plan-preview" (which would resolve to whatever
      // happens to be the latest draft at load time — a real race if
      // another generation completes first). This works identically for
      // idempotentReplay: true — the id returned is still the correct one
      // to show, regardless of how recent it is relative to other drafts.
      setGenerationRequestId(null);
      navigate(`/training-plan-preview/${encodeURIComponent(result.data.planVersionId)}`);
      return;
    }

    setState({ kind: "error", error: result.error });
  }

  async function handleGenerateClick() {
    if (!configurationReady) return;
    if (state.kind === "checking_drafts" || state.kind === "generating") return;

    const durationWeeks = parseDurationWeeks(durationWeeksInput);
    if (durationWeeks === null) {
      setDurationWeeksError("Indique une durée valide : un nombre entier de semaines, au moins 1.");
      return;
    }
    setDurationWeeksError(null);

    // Reuse the existing id only if one is already pending for this exact
    // intention (a retry after a retryable error, or a return from
    // "Annuler") — otherwise mint the one new id for this new intention.
    const requestId = generationRequestId ?? crypto.randomUUID();
    if (generationRequestId === null) {
      setGenerationRequestId(requestId);
    }

    setState({ kind: "checking_drafts" });
    let drafts: TrainingPlanDraftSummary[];
    try {
      drafts = await getTrainingPlanDrafts();
    } catch {
      setState({ kind: "error", error: DRAFTS_CHECK_ERROR });
      return;
    }

    if (drafts.length === 0) {
      await runGeneration(requestId, durationWeeks);
      return;
    }

    setState({ kind: "existing_draft_choice", drafts });
  }

  function handleViewExistingDraft() {
    navigate("/training-plan-preview");
  }

  async function handleConfirmNewGeneration() {
    if (state.kind !== "existing_draft_choice") return;
    const durationWeeks = parseDurationWeeks(durationWeeksInput);
    if (durationWeeks === null || generationRequestId === null) {
      // Structurally unreachable (both were already validated/minted to
      // reach this state) — falls back to idle rather than crashing.
      setState({ kind: "idle" });
      return;
    }
    await runGeneration(generationRequestId, durationWeeks);
  }

  function handleCancelExistingDraftChoice() {
    setState({ kind: "idle" });
  }

  const busy = state.kind === "checking_drafts" || state.kind === "generating";
  const canRetrySameIntention = state.kind === "error" && state.error.retryable;

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-ink">Créer mon plan</p>
        <p className="text-sm text-ink/70">
          NALYNT utilisera ta configuration enregistrée, tes disponibilités et ton contexte sportif.
        </p>
      </div>

      {state.kind === "existing_draft_choice" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink/80">
            {state.drafts.length === 1 ? "Tu as déjà un plan en attente." : `Tu as déjà ${state.drafts.length} plans en attente.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={handleViewExistingDraft}>Voir le plan en attente</SecondaryButton>
            <PrimaryButton onClick={() => void handleConfirmNewGeneration()}>Générer un nouveau plan</PrimaryButton>
            <SecondaryButton onClick={handleCancelExistingDraftChoice}>Annuler</SecondaryButton>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor="duration-weeks" className="text-sm font-medium text-ink">
              Durée du plan
            </label>
            <div className="flex items-center gap-2">
              <input
                id="duration-weeks"
                type="number"
                min={1}
                step={1}
                value={durationWeeksInput}
                onChange={(e) => handleDurationWeeksChange(e.target.value)}
                disabled={busy}
                className="w-24 rounded border border-white/10 bg-transparent px-3 py-2 text-sm text-ink placeholder:text-muted"
                placeholder="6"
              />
              <span className="text-sm text-ink/70">semaines</span>
            </div>
            {durationWeeksError && <p className="text-sm text-red-400">{durationWeeksError}</p>}
          </div>

          {state.kind === "error" && (
            <p role="alert" className="text-sm text-red-400">
              {state.error.message}
            </p>
          )}

          {!configurationReady && (
            <p className="text-sm text-muted">Enregistre ta configuration avant de générer un plan.</p>
          )}

          <PrimaryButton onClick={() => void handleGenerateClick()} disabled={!configurationReady || busy} className="w-full">
            {state.kind === "generating"
              ? "Génération…"
              : state.kind === "checking_drafts"
                ? "Vérification…"
                : canRetrySameIntention
                  ? "Réessayer"
                  : "Générer mon plan"}
          </PrimaryButton>
        </>
      )}
    </Card>
  );
}
