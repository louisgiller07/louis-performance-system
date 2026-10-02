// UX-11C.4 — guided endurance session module. The prescription (intent,
// allowed activities, warm-up / main / cool-down with durations, RPE and
// talk test) is shown as prescribed, then « Ce que tu as réalisé »: the ONE
// activity actually performed, its real duration (minutes, required), and
// optionally distance (km) and RPE. Nothing is preselected or prefilled
// from the prescription. A result is "recorded" only once the server
// confirmed it; editing appends one correction (supersedes_id).
import { useEffect, useRef } from "react";
import { PrimaryButton } from "../../../components/PrimaryButton";
import { SecondaryButton } from "../../../components/SecondaryButton";
import { FinalPrescriptionV2Card } from "../../finalPrescriptionV2/FinalPrescriptionV2Card";
import { span } from "../../finalPrescriptionV2/finalPrescriptionV2Copy";
import type { GuidedSessionModuleProps } from "../sessionModules";
import { activeActivityResult, isCorrectable } from "../results/activeResults";
import {
  allowedActivities,
  EMPTY_ACTIVITY_FORM,
  formatDistance,
  formatDuration,
  formFromActivity,
  mainBlockRpe,
  plannedMinutes,
  validateActivityForm,
  type ActivityFormValues,
  type ActivityOption,
} from "./enduranceActivity";
import { enduranceDraft, liveEnduranceForm, type EnduranceForm } from "./enduranceDraft";
import { ENDURANCE_COPY } from "./enduranceCopy";

const INPUT = "min-h-12 w-full rounded border border-white/10 bg-transparent px-3 py-3 text-base text-ink";

function ActivityEntry({
  form,
  allowed,
  plannedLabel,
  rpeLabel,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  form: EnduranceForm | null;
  allowed: readonly ActivityOption[];
  plannedLabel: string | null;
  rpeLabel: string | null;
  busy: boolean;
  onChange: (patch: Partial<ActivityFormValues>) => void;
  onSave: () => void;
  onCancel: (() => void) | null;
}) {
  const values = form?.values ?? EMPTY_ACTIVITY_FORM;
  const errors = form?.errors ?? {};
  const correcting = form?.supersedes != null;
  const groupRef = useRef<HTMLFieldSetElement>(null);
  // A correction takes the keyboard focus (on the recorded activity) when it opens.
  useEffect(() => {
    if (correcting) groupRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, [correcting]);
  const described = (id: string, hint: string | null, error: string | undefined) => [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const field = (id: string, label: string, name: "minutes" | "km" | "rpe", inputMode: "numeric" | "decimal", hint: string | null) => (
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
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={values[name]}
        onChange={(e) => onChange({ [name]: e.target.value })}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={described(id, hint, errors[name])}
        className={INPUT}
      />
      {errors[name] && (
        <p id={`${id}-error`} className="text-xs text-red-400">
          {errors[name]}
        </p>
      )}
    </div>
  );
  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-line bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel?.()}
      noValidate
    >
      <fieldset ref={groupRef} className="flex flex-col gap-2" aria-describedby={errors.activityId ? "activity-error" : undefined}>
        <legend className="mb-1 text-sm font-semibold text-ink">{ENDURANCE_COPY.activityLegend}</legend>
        {allowed.map((a) => (
          <label key={a.id} className="flex min-h-12 items-center gap-3 rounded border border-white/10 px-3 text-base text-ink">
            <input type="radio" name="activity" value={a.id} checked={values.activityId === a.id} onChange={() => onChange({ activityId: a.id })} aria-invalid={errors.activityId ? true : undefined} className="h-5 w-5" />
            {a.label}
          </label>
        ))}
        {errors.activityId && (
          <p id="activity-error" className="text-xs text-red-400">
            {errors.activityId}
          </p>
        )}
      </fieldset>
      {field("activity-minutes", ENDURANCE_COPY.minutesLabel, "minutes", "numeric", plannedLabel ? `Prévu : ${plannedLabel}` : null)}
      {field("activity-km", ENDURANCE_COPY.kmLabel, "km", "decimal", null)}
      {field("activity-rpe", ENDURANCE_COPY.rpeLabel, "rpe", "decimal", rpeLabel ? `Prévu : RPE ${rpeLabel} (bloc principal)` : null)}
      <PrimaryButton type="submit" disabled={busy} className="w-full">
        {correcting ? "Enregistrer la correction" : "Enregistrer l'activité"}
      </PrimaryButton>
      {onCancel && (
        <SecondaryButton onClick={onCancel} className="min-h-12 w-full">
          Annuler
        </SecondaryButton>
      )}
    </form>
  );
}

export function EnduranceSessionModule({ prescription, executionId, activityResults, editable, busy, uiState, setUiState, submit, newId, now }: GuidedSessionModuleProps) {
  const allowed = allowedActivities(prescription);
  if (!allowed) {
    // Missing, empty or duplicated activity choice: fail closed, never a default activity.
    return (
      <p className="text-ink/80" data-reason="invalid_endurance_prescription">
        {ENDURANCE_COPY.invalid}
      </p>
    );
  }
  const active = activeActivityResult(activityResults);
  const form = liveEnduranceForm(uiState, activityResults);
  const canEdit = editable && executionId !== null;
  const planned = plannedMinutes(prescription);
  const plannedLabel = planned ? span(planned, " min") : null;
  const rpe = mainBlockRpe(prescription);
  const labelOf = (id: string) => allowed.find((a) => a.id === id)?.label ?? id;

  const change = (patch: Partial<ActivityFormValues>) => {
    const current: EnduranceForm = form ?? { id: newId(), occurredAt: null, supersedes: null, values: EMPTY_ACTIVITY_FORM, errors: {} };
    setUiState({ form: { ...current, values: { ...current.values, ...patch } } });
  };

  const save = async () => {
    const current: EnduranceForm = form ?? { id: newId(), occurredAt: null, supersedes: null, values: EMPTY_ACTIVITY_FORM, errors: {} };
    const v = validateActivityForm(allowed, current.values);
    if (!v.ok) {
      setUiState({ form: { ...current, errors: v.errors } });
      return;
    }
    const sent: EnduranceForm = { ...current, occurredAt: current.occurredAt ?? now(), errors: {} };
    setUiState({ form: sent });
    const draft = enduranceDraft(sent, allowed, executionId, now);
    if (draft.kind !== "valid") {
      // A correction identical to the recorded values: nothing to send.
      setUiState({ form: null });
      return;
    }
    const outcome = await submit("activity", { events: [], activities: [draft.activity] });
    // ok → the reloaded results contain this id: the entry closes by itself.
    // retryable → the entry stays with the SAME id. refused → the confirmed state is shown.
    if (outcome === "refused") setUiState({ form: null });
  };

  const correct = () => {
    if (!active || !isCorrectable(active)) return;
    setUiState({ form: { id: newId(), occurredAt: null, supersedes: active, values: formFromActivity(active), errors: {} } satisfies EnduranceForm });
  };

  const showEntry = canEdit && (form !== null || active === null);
  return (
    <div className="flex flex-col gap-5">
      <FinalPrescriptionV2Card state={{ kind: "created", prescription }} />
      {executionId !== null && (
        <section className="flex flex-col gap-3" aria-labelledby="realised-title" data-testid="realised">
          <h2 id="realised-title" className="text-xs font-semibold uppercase tracking-wide text-muted">
            {ENDURANCE_COPY.realisedTitle}
          </h2>
          {active && !(form && form.supersedes) && (
            <div className="flex flex-col gap-1 rounded-lg border border-white/10 p-3" data-testid="activity-result">
              <p className="text-sm text-ink">
                Activité : {labelOf(active.activity_id)}
                {active.supersedes_id ? ` · ${ENDURANCE_COPY.corrected}` : ""}
              </p>
              <p className="text-sm text-ink/80">
                Durée : {formatDuration(active.duration_seconds)}
                {plannedLabel ? ` (prévu : ${plannedLabel})` : ""}
              </p>
              {active.distance_m !== null && <p className="text-sm text-ink/80">Distance : {formatDistance(active.distance_m)}</p>}
              {active.rpe_actual !== null && <p className="text-sm text-ink/80">RPE ressenti : {active.rpe_actual}</p>}
              {canEdit && isCorrectable(active) && (
                <SecondaryButton onClick={correct} disabled={busy} className="mt-2 min-h-12 w-full" aria-label="Modifier l'activité réalisée">
                  Modifier
                </SecondaryButton>
              )}
              {canEdit && !isCorrectable(active) && <p className="text-xs text-muted">{ENDURANCE_COPY.correctedOnce}</p>}
            </div>
          )}
          {showEntry && (
            <ActivityEntry
              form={form}
              allowed={allowed}
              plannedLabel={plannedLabel}
              rpeLabel={rpe ? span(rpe) : null}
              busy={busy}
              onChange={change}
              onSave={() => void save()}
              onCancel={form?.supersedes ? () => setUiState({ form: null }) : null}
            />
          )}
          {!active && !canEdit && <p className="text-sm text-muted">{ENDURANCE_COPY.noResultYet}</p>}
        </section>
      )}
    </div>
  );
}
