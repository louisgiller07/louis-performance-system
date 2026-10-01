// UX-11C.3 — guided DH technical session module. Works only from the
// execution's own final prescription: brief, warm-up, application and
// cool-down stay instructions; the ONE main drill takes one result per pass
// actually ridden (Passage 1..N, N = the prescription's pass count). A pass
// is "recorded" only once the server confirmed it. `success` answers "was
// the drill's criterion met on this pass?" (Oui / Non / Non évalué) and is
// never a completion condition. Editing a recorded pass appends a correction
// (supersedes_id), at most once. No pass time is recorded (no contract).
import { useEffect, useRef, type ReactNode } from "react";
import { PrimaryButton } from "../../../components/PrimaryButton";
import { SecondaryButton } from "../../../components/SecondaryButton";
import type { BlockView, DrillItemView } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import type { GuidedSessionModuleProps } from "../sessionModules";
import { isCorrectable, slotKey } from "../results/activeResults";
import { choiceOf, dhProgress, type PassSlot, type SuccessChoice } from "./dhPasses";
import { dhDraftSet, liveDhForm, type DhOpenForm } from "./dhDraft";
import { DH_COPY, passesLabel, SUCCESS_LABELS } from "./dhCopy";

const CHOICES: SuccessChoice[] = ["yes", "no", "unrated"];

function InstructionBlock({ block }: { block: BlockView }) {
  return (
    <section className="flex flex-col gap-1.5" data-block-role={block.role}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{block.roleLabel}</h2>
      {block.instructions.map((instruction) => (
        <p key={instruction} className="text-sm text-ink/80">
          {instruction}
        </p>
      ))}
    </section>
  );
}

function PassForm({ form, busy, onChoose, onSave, onCancel }: { form: DhOpenForm; busy: boolean; onChoose: (c: SuccessChoice) => void; onSave: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLFieldSetElement>(null);
  // The entry takes the keyboard focus (on the selected answer) when it opens.
  useEffect(() => ref.current?.querySelector<HTMLInputElement>("input:checked")?.focus(), []);
  const name = `pass-${form.ordinal}-success`;
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <fieldset ref={ref} className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink">
          Passage {form.ordinal} — {DH_COPY.successQuestion}
        </legend>
        {CHOICES.map((c) => (
          <label key={c} className="flex min-h-12 items-center gap-3 rounded border border-white/10 px-3 text-base text-ink">
            <input type="radio" name={name} value={c} checked={form.choice === c} onChange={() => onChoose(c)} className="h-5 w-5" />
            {SUCCESS_LABELS[c]}
          </label>
        ))}
      </fieldset>
      <PrimaryButton type="submit" disabled={busy} className="w-full">
        {form.supersedes ? "Enregistrer la correction" : "Enregistrer le passage"}
      </PrimaryButton>
      <SecondaryButton onClick={onCancel} className="min-h-12 w-full">
        Annuler
      </SecondaryButton>
    </form>
  );
}

function PassRow({ slot, isCurrent, canEdit, busy, entryOpen, onOpen, children }: { slot: PassSlot; isCurrent: boolean; canEdit: boolean; busy: boolean; entryOpen: boolean; onOpen: () => void; children?: ReactNode }) {
  const r = slot.result;
  return (
    <li className="flex flex-col gap-2 border-t border-white/10 pt-2 first:border-t-0 first:pt-0" data-pass={slot.ordinal}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">Passage {slot.ordinal}</p>
        {isCurrent && <p className="text-xs font-semibold uppercase tracking-wide text-gold">{DH_COPY.current}</p>}
      </div>
      <p className="text-sm text-ink/80" data-testid="pass-result">
        {r ? `${DH_COPY.recorded} · Critère atteint : ${SUCCESS_LABELS[choiceOf(r.success)]}${r.supersedes_id ? ` · ${DH_COPY.corrected}` : ""}` : DH_COPY.noResult}
      </p>
      {canEdit && !entryOpen && (!r || isCorrectable(r)) && (
        <SecondaryButton onClick={onOpen} disabled={busy} className="min-h-12 w-full" aria-label={`${r ? "Modifier" : "Enregistrer"} le passage ${slot.ordinal}`}>
          {r ? "Modifier" : "Enregistrer"}
        </SecondaryButton>
      )}
      {canEdit && r && !isCorrectable(r) && <p className="text-xs text-muted">{DH_COPY.correctedOnce}</p>}
      {children}
    </li>
  );
}

function DrillCard({ drill, children, progress }: { drill: DrillItemView; children?: ReactNode; progress: ReactNode }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-white/10 p-3" data-item-id={drill.prescriptionItemId}>
      <h3 className="text-base font-semibold text-ink">{drill.name}</h3>
      <p className="text-sm text-ink/80">
        <span className="font-medium">Prévu : </span>
        {passesLabel(drill.passes)}
      </p>
      <p className="text-sm text-ink/80">Consigne : {drill.cue}</p>
      <p className="text-sm text-ink/80" data-testid="success-criterion">
        Critère de réussite : {drill.successCriterion}
      </p>
      {drill.vigilances.map((v) => (
        <p key={v} className="text-sm text-muted">
          Vigilance : {v}
        </p>
      ))}
      {progress}
      {children}
    </article>
  );
}

export function DhSessionModule({ prescription, executionId, setResults, editable, busy, uiState, setUiState, submit, newId, now }: GuidedSessionModuleProps) {
  const progress = dhProgress(prescription, setResults);
  if (!progress) {
    // Zero or several result-bearing main items: fail closed, never an arbitrary pick.
    return (
      <p className="text-ink/80" data-reason="invalid_dh_prescription">
        {DH_COPY.invalid}
      </p>
    );
  }
  const { drill } = progress;
  const form = liveDhForm(uiState, setResults);
  const canEdit = editable && executionId !== null;
  const showPasses = executionId !== null;

  const open = (slot: PassSlot) => {
    const correcting = slot.result && isCorrectable(slot.result) ? slot.result : null;
    setUiState({
      form: { itemId: drill.prescriptionItemId, ordinal: slot.ordinal, supersedes: correcting, id: newId(), occurredAt: null, choice: correcting ? choiceOf(correcting.success) : "unrated", touched: false } satisfies DhOpenForm,
    });
  };

  const save = async (current: DhOpenForm) => {
    // Saving explicitly records the pass, even with "Non évalué" untouched.
    const sent: DhOpenForm = { ...current, touched: true, occurredAt: current.occurredAt ?? now() };
    setUiState({ form: sent });
    const set = dhDraftSet(sent, executionId, now);
    if (!set) {
      // A correction identical to the recorded value: nothing to send.
      setUiState({ form: null });
      return;
    }
    const outcome = await submit(`pass:${slotKey(sent.itemId, sent.ordinal)}`, { events: [], sets: [set] });
    // ok → the reloaded results contain this id: the entry closes by itself.
    // retryable → the entry stays open with the SAME id. refused → the confirmed state is shown.
    if (outcome === "refused") setUiState({ form: null });
  };

  return (
    <div className="flex flex-col gap-5">
      {prescription.blocks.map((block) =>
        block.role === "main" ? (
          <section key={block.blockId} className="flex flex-col gap-3" data-block-role="main">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{block.roleLabel}</h2>
            {block.instructions.map((instruction) => (
              <p key={instruction} className="text-sm text-ink/80">
                {instruction}
              </p>
            ))}
            <DrillCard
              drill={drill}
              progress={
                showPasses && (
                  <p className="text-sm font-medium text-ink" aria-live="polite" data-testid="dh-progress">
                    {progress.recorded} / {drill.passes} passages enregistrés
                  </p>
                )
              }
            >
              {showPasses && (
                <ol className="flex flex-col gap-2" aria-label={`Passages — ${drill.name}`}>
                  {progress.slots.map((slot) => (
                    <PassRow key={slot.ordinal} slot={slot} isCurrent={progress.current === slot} canEdit={canEdit} busy={busy} entryOpen={form !== null} onOpen={() => open(slot)}>
                      {form && form.ordinal === slot.ordinal && (
                        <PassForm
                          form={form}
                          busy={busy}
                          onChoose={(choice) => setUiState({ form: { ...form, choice, touched: true } })}
                          onSave={() => void save(form)}
                          onCancel={() => setUiState({ form: null })}
                        />
                      )}
                    </PassRow>
                  ))}
                </ol>
              )}
            </DrillCard>
          </section>
        ) : (
          <InstructionBlock key={block.blockId} block={block} />
        )
      )}
    </div>
  );
}
