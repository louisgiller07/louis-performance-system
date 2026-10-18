// PHYS-04 — guided mobility session (MOBILITY, catalogue protocol
// mobility_routine_v1): the movements in the protocol order, one at a time,
// with their duration, their cue and the vigilance of the routine. Nothing to
// measure: completing it is the rider's own "done" (no result required, by
// the server either). The step shown is UI state only (never written).
import { FinalPrescriptionV2Card } from "../../finalPrescriptionV2/FinalPrescriptionV2Card";
import { formatMeasure, span } from "../../finalPrescriptionV2/finalPrescriptionV2Copy";
import type { BlockView, ExerciseItemView, FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import type { GuidedSessionModuleProps, ModuleCompletion } from "../sessionModules";

export const MOBILITY_COPY = {
  note: "Rien à mesurer : enchaîne les mouvements dans l'ordre, sans forcer l'amplitude, puis termine la séance.",
  previous: "Mouvement précédent",
  next: "Mouvement suivant",
  last: "Dernier mouvement : termine la séance quand tu as fini.",
} as const;

export interface MobilityStep {
  block: BlockView;
  item: ExerciseItemView;
}

export function isGuidedMobilityPrescription(p: FinalPrescriptionV2View): boolean {
  return p.family === "mobility";
}

/** The movements in the prescription order (blocks, then items). */
export function mobilitySteps(p: FinalPrescriptionV2View): MobilityStep[] {
  return p.blocks.flatMap((block) => block.items.filter((i): i is ExerciseItemView => i.kind === "exercise").map((item) => ({ block, item })));
}

export function mobilityCompletion(): ModuleCompletion {
  return { canComplete: true, completionNeedsConfirmation: false, hint: "", confirmationMessage: "", pending: {} };
}

const stepIndex = (uiState: unknown, count: number): number => {
  const raw = typeof uiState === "object" && uiState !== null ? (uiState as { step?: unknown }).step : undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < count ? raw : 0;
};

export function MobilitySessionModule({ prescription, editable, uiState, setUiState }: GuidedSessionModuleProps) {
  const steps = mobilitySteps(prescription);
  // Before the start or once closed: the whole session, read only.
  if (!editable || steps.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <FinalPrescriptionV2Card state={{ kind: "created", prescription }} />
        <p className="text-sm text-muted" data-testid="mobility-note">
          {MOBILITY_COPY.note}
        </p>
      </div>
    );
  }
  const index = stepIndex(uiState, steps.length);
  const { block, item } = steps[index]!;
  const isLast = index === steps.length - 1;
  return (
    <div className="flex flex-col gap-3" data-testid="mobility-guide">
      <p className="text-sm text-muted" data-testid="mobility-note">
        {MOBILITY_COPY.note}
      </p>
      <section className="flex flex-col gap-1.5 rounded border border-line p-3" data-testid="mobility-step" data-item-id={item.prescriptionItemId}>
        <p className="text-xs text-muted">
          Mouvement {index + 1} sur {steps.length} · {block.roleLabel}
          {block.durationMinutes && ` · ${span(block.durationMinutes, " min")}`}
        </p>
        <p className="text-lg font-medium text-ink">{item.name}</p>
        <p className="text-ink/80">{formatMeasure(item.measure)}</p>
        {block.instructions.map((instruction) => (
          <p key={instruction} className="text-sm text-ink/80">
            {instruction}
          </p>
        ))}
        <p className="text-sm text-ink/80">Consigne : {item.cue}</p>
        {item.vigilances.map((v) => (
          <p key={v} className="text-sm text-muted">
            Vigilance : {v}
          </p>
        ))}
        {isLast && <p className="text-sm text-gold">{MOBILITY_COPY.last}</p>}
      </section>
      <div className="flex gap-2">
        <button type="button" className="ux-press min-h-11 flex-1 rounded border border-line px-3 text-sm text-ink/80 disabled:opacity-40" disabled={index === 0} onClick={() => setUiState({ step: index - 1 })}>
          {MOBILITY_COPY.previous}
        </button>
        <button type="button" className="ux-press min-h-11 flex-1 rounded border border-line px-3 text-sm text-ink/80 disabled:opacity-40" disabled={isLast} onClick={() => setUiState({ step: index + 1 })}>
          {MOBILITY_COPY.next}
        </button>
      </div>
    </div>
  );
}
