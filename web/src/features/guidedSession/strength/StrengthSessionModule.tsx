// UX-11C.2 — guided Force session module (STRENGTH_LOWER / STRENGTH_UPPER).
// Works only from the execution's own final prescription. Warm-up and
// ramp-up stay instructions; the exercise items of the main / complementary
// blocks take one result per performed set. A set is "recorded" only once
// the server confirmed it (the results shown are re-read from the database);
// a prescribed set without a row has no result. Editing a recorded set
// creates an append-only correction (supersedes_id), at most once.
import { useEffect, useRef, type ReactNode } from "react";
import { PrimaryButton } from "../../../components/PrimaryButton";
import { SecondaryButton } from "../../../components/SecondaryButton";
import { formatMeasure, formatSeconds, setsLabel, span } from "../../finalPrescriptionV2/finalPrescriptionV2Copy";
import type { BlockView, ExerciseItemView } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import type { GuidedSessionModuleProps } from "../sessionModules";
import { draftOf, EMPTY_FORM, liveForm, type OpenForm } from "./strengthDraft";
import {
  formFromResult,
  isCorrectable,
  slotKey,
  strengthProgress,
  validateSetForm,
  WORK_BLOCK_ROLES,
  type SetFormValues,
  type StrengthMeasureType,
  type StrengthSlot,
} from "./strengthSets";
import { STRENGTH_COPY, formatResult, strengthProgressLine } from "./strengthCopy";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function prescribedDose(item: ExerciseItemView): string {
  const parts = [`${setsLabel(item.sets)} × ${formatMeasure(item.measure)}`];
  if (item.rpeTarget) parts.push(`RPE ${span(item.rpeTarget)}`);
  if (item.restSeconds) parts.push(`repos ${formatSeconds(item.restSeconds)}`);
  return parts.join(" · ");
}

function ReadOnlyBlock({ block }: { block: BlockView }) {
  return (
    <section className="flex flex-col gap-1.5" data-block-role={block.role}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{block.roleLabel}</h2>
      {block.instructions.map((instruction) => (
        <p key={instruction} className="text-sm text-ink/80">
          {instruction}
        </p>
      ))}
      <ul className="flex flex-col gap-2">
        {block.items.map((item) => (
          <li key={item.prescriptionItemId} className="text-sm">
            <span className="font-medium text-ink">{item.name}</span>
            {item.kind === "exercise" && <span className="text-ink/80"> — {`${setsLabel(item.sets)} × ${formatMeasure(item.measure)}`}</span>}
            <span className="block text-ink/70">{item.cue}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const fieldId = (form: OpenForm, field: keyof SetFormValues) => `set-${form.key.replace(/[^a-z0-9]/gi, "-")}-${field}`;

function SetForm({ form, item, busy, onChange, onSave, onCancel }: { form: OpenForm; item: ExerciseItemView; busy: boolean; onChange: (patch: Partial<SetFormValues>) => void; onSave: () => void; onCancel: () => void }) {
  const firstInput = useRef<HTMLInputElement>(null);
  // The entry takes the keyboard focus when it opens.
  useEffect(() => firstInput.current?.focus(), []);
  const field = (name: keyof SetFormValues, label: string, props: { inputMode: "numeric" | "decimal"; step: string; min: number; max?: number }, hint?: string) => {
    const id = fieldId(form, name);
    const error = form.errors[name];
    const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm text-ink/80">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-muted">
            {hint}
          </p>
        )}
        <input
          id={id}
          ref={name === "value" ? firstInput : undefined}
          type="number"
          value={form.values[name]}
          onChange={(e) => onChange({ [name]: e.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-h-12 w-full rounded border border-white/10 bg-transparent px-3 py-3 text-base text-ink"
          {...props}
        />
        {error && (
          <p id={`${id}-error`} className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  };
  const perSide = form.perSide ? ` ${STRENGTH_COPY.perSide}` : "";
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      noValidate
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-ink">
          {form.supersedes ? "Corriger" : "Saisir"} la série {form.setNumber} — {form.itemName}
        </legend>
        {field("value", form.measureType === "reps" ? `Répétitions réalisées${perSide}` : `Durée réalisée en secondes${perSide}`, { inputMode: "numeric", step: "1", min: 1 })}
        {field("rpe", "RPE ressenti (1–10, facultatif)", { inputMode: "decimal", step: "0.5", min: 1, max: 10 }, item.rpeTarget ? `Prévu : RPE ${span(item.rpeTarget)}` : undefined)}
        {field("load", "Charge utilisée en kg (facultatif)", { inputMode: "decimal", step: "0.5", min: 0, max: 1000 })}
      </fieldset>
      <PrimaryButton type="submit" disabled={busy} className="w-full">
        {form.supersedes ? "Enregistrer la correction" : "Enregistrer la série"}
      </PrimaryButton>
      <SecondaryButton onClick={onCancel} className="min-h-12 w-full">
        Annuler
      </SecondaryButton>
    </form>
  );
}

function SlotRow({ slot, isCurrent, canEdit, busy, form, onOpen, children }: { slot: StrengthSlot; isCurrent: boolean; canEdit: boolean; busy: boolean; form: OpenForm | null; onOpen: () => void; children?: ReactNode }) {
  const r = slot.result;
  const perSide = "perSide" in slot.item.measure && slot.item.measure.perSide;
  const label = `série ${slot.setNumber} — ${slot.item.name}`;
  return (
    <li className="flex flex-col gap-2 border-t border-white/10 pt-2 first:border-t-0 first:pt-0" data-slot={slotKey(slot.item.prescriptionItemId, slot.setNumber)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">Série {slot.setNumber}</p>
        {isCurrent && <p className="text-xs font-semibold uppercase tracking-wide text-gold">{STRENGTH_COPY.current}</p>}
      </div>
      <p className="text-sm text-ink/80" data-testid="slot-result">
        {r ? `Réalisé : ${formatResult(r, perSide)}${r.supersedes_id ? ` · ${STRENGTH_COPY.corrected}` : ""}` : STRENGTH_COPY.noResult}
      </p>
      {canEdit && !form && (!r || isCorrectable(r)) && (
        <SecondaryButton onClick={onOpen} disabled={busy} className="min-h-12 w-full" aria-label={`${r ? "Modifier" : "Saisir"} la ${label}`}>
          {r ? "Modifier" : "Saisir"}
        </SecondaryButton>
      )}
      {canEdit && r && !isCorrectable(r) && <p className="text-xs text-muted">{STRENGTH_COPY.correctedOnce}</p>}
      {children}
    </li>
  );
}

function ExerciseCard({ item, measureType, slots, current, canEdit, showSlots, busy, form, onOpen, renderForm }: {
  item: ExerciseItemView;
  measureType: StrengthMeasureType | null;
  slots: StrengthSlot[];
  current: StrengthSlot | null;
  canEdit: boolean;
  showSlots: boolean;
  busy: boolean;
  form: OpenForm | null;
  onOpen: (slot: StrengthSlot) => void;
  renderForm: (slot: StrengthSlot) => ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-white/10 p-3" data-item-id={item.prescriptionItemId}>
      <h3 className="text-base font-semibold text-ink">{item.name}</h3>
      <p className="text-sm text-ink/80">
        <span className="font-medium">Prévu : </span>
        {prescribedDose(item)}
      </p>
      {item.rampUp && (
        <p className="text-sm text-muted">
          Montée en charge : {span(item.rampUp.sets)} {item.rampUp.sets.max > 1 ? "séries" : "série"} — {item.rampUp.instruction}
        </p>
      )}
      <p className="text-sm text-ink/80">Consigne : {item.cue}</p>
      {item.vigilances.map((v) => (
        <p key={v} className="text-sm text-muted">
          Vigilance : {v}
        </p>
      ))}
      {showSlots &&
        (measureType === null ? (
          <p className="text-sm text-muted">{STRENGTH_COPY.unsupportedItem}</p>
        ) : (
          <ol className="flex flex-col gap-2" aria-label={`Séries — ${item.name}`}>
            {slots.map((slot) => (
              <SlotRow key={slot.setNumber} slot={slot} isCurrent={current === slot} canEdit={canEdit} busy={busy} form={form} onOpen={() => onOpen(slot)}>
                {form && form.key === slotKey(item.prescriptionItemId, slot.setNumber) && renderForm(slot)}
              </SlotRow>
            ))}
          </ol>
        ))}
    </article>
  );
}

export function StrengthSessionModule({ prescription, executionId, setResults, editable, busy, uiState, setUiState, submit, newId, now }: GuidedSessionModuleProps) {
  const form = liveForm(uiState, setResults);
  const progress = strengthProgress(prescription, setResults);
  const canEdit = editable && executionId !== null;
  const showSlots = executionId !== null;

  const open = (slot: StrengthSlot) => {
    if (slot.measureType === null) return;
    const correcting = slot.result && isCorrectable(slot.result) ? slot.result : null;
    const measure = slot.item.measure;
    setUiState({
      form: {
        key: slotKey(slot.item.prescriptionItemId, slot.setNumber),
        itemId: slot.item.prescriptionItemId,
        itemName: slot.item.name,
        setNumber: slot.setNumber,
        measureType: slot.measureType,
        perSide: "perSide" in measure && measure.perSide,
        supersedes: correcting,
        id: newId(),
        occurredAt: null,
        values: correcting ? formFromResult(correcting) : EMPTY_FORM,
        errors: {},
      } satisfies OpenForm,
    });
  };

  const save = async (current: OpenForm) => {
    const v = validateSetForm(current.measureType, current.values);
    if (!v.ok) {
      setUiState({ form: { ...current, errors: v.errors } });
      return;
    }
    const sent: OpenForm = { ...current, occurredAt: current.occurredAt ?? now(), errors: {} };
    setUiState({ form: sent });
    const draft = draftOf(sent, executionId, now);
    if (draft.kind !== "valid") {
      // A correction identical to the recorded values: nothing to send.
      setUiState({ form: null });
      return;
    }
    const outcome = await submit(`set:${sent.key}`, { events: [], sets: [draft.set] });
    // ok → the reloaded results contain this id: the entry closes by itself.
    // retryable → the entry stays open with the SAME id (no second row on replay).
    // refused (e.g. already recorded elsewhere, already corrected) → the confirmed state is shown.
    if (outcome === "refused") setUiState({ form: null });
  };

  const workRoles = WORK_BLOCK_ROLES as readonly string[];
  return (
    <div className="flex flex-col gap-5">
      {showSlots && (
        <p className="text-sm font-medium text-ink" aria-live="polite" data-testid="strength-progress">
          {strengthProgressLine(progress)}
        </p>
      )}
      {prescription.blocks.map((block) =>
        workRoles.includes(block.role) ? (
          <section key={block.blockId} className="flex flex-col gap-3" data-block-role={block.role}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{block.roleLabel}</h2>
            {block.instructions.map((instruction) => (
              <p key={instruction} className="text-sm text-ink/80">
                {instruction}
              </p>
            ))}
            {block.items.map((item) =>
              item.kind === "exercise" ? (
                <ExerciseCard
                  key={item.prescriptionItemId}
                  item={item}
                  measureType={progress.slots.find((s) => s.item === item)?.measureType ?? null}
                  slots={progress.slots.filter((s) => s.item === item)}
                  current={progress.current}
                  canEdit={canEdit}
                  showSlots={showSlots}
                  busy={busy}
                  form={form}
                  onOpen={open}
                  renderForm={() =>
                    form && (
                      <SetForm
                        form={form}
                        item={item}
                        busy={busy}
                        onChange={(patch) => setUiState({ form: { ...form, values: { ...form.values, ...patch } } })}
                        onSave={() => void save(form)}
                        onCancel={() => setUiState({ form: null })}
                      />
                    )
                  }
                />
              ) : null
            )}
          </section>
        ) : (
          <ReadOnlyBlock key={block.blockId} block={block} />
        )
      )}
    </div>
  );
}
