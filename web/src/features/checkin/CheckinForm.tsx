import { useEffect, useState, type FormEvent } from "react";
import { RatingSlider } from "../../components/RatingSlider";
import { YesNoChoice } from "../../components/YesNoChoice";
import { loadCheckin, saveCheckin } from "./checkinRepo";
import { validateCheckin, type CheckinFieldErrors } from "./checkinValidation";
import { EMPTY_CHECKIN_FORM_STATE, PAIN_LOCATION_CODES, rowToFormState, type CheckinFormState } from "./checkinTypes";

type LoadState = "loading" | "loaded" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

interface CheckinFormProps {
  athleteId: string;
  date: string;
  /**
   * Reports whether a checkin currently exists for this date — fired once
   * after the initial load (row found vs. none), and again after every
   * successful save (always true then). This is the single signal
   * TodayPage needs to enable "Générer mon plan" — it never needs a
   * separate query to know whether a checkin exists.
   */
  onCheckinAvailabilityChange?: (hasCheckin: boolean) => void;
  /**
   * Fired only when a save actually persists new values — never on the
   * initial load of an existing row. TodayPage uses this (not
   * onCheckinAvailabilityChange) to bump a checkin revision counter, so a
   * DailyPlan generated from an older checkin is invalidated after an edit
   * — merely loading an already-saved checkin must not do that.
   */
  onSaved?: () => void;
}

// M4_003 — real persistence, RLS-scoped. No daily-run call, no DailyPlan
// rendering, no coaching/safety decision here — this component only
// collects and saves facts.
export function CheckinForm({ athleteId, date, onCheckinAvailabilityChange, onSaved }: CheckinFormProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [form, setForm] = useState<CheckinFormState>(EMPTY_CHECKIN_FORM_STATE);
  const [errors, setErrors] = useState<CheckinFieldErrors>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    loadCheckin(athleteId, date)
      .then((row) => {
        if (!active) return;
        setForm(rowToFormState(row));
        setLoadState("loaded");
        onCheckinAvailabilityChange?.(row !== null);
      })
      .catch(() => {
        if (!active) return;
        setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [athleteId, date]);

  function updateField<K extends keyof CheckinFormState>(key: K, value: CheckinFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveState("idle");
  }

  // Dedicated handler (not the generic updateField) — switching pain to
  // Non must immediately reset the conditional pain fields to "not
  // applicable", not just hide their inputs. Leaving stale values in
  // CheckinFormState after pain flipped to false was the root cause of a
  // real bug: validateCheckin used to reject a stale pain_intensity, but
  // the error was attached to a field the UI no longer rendered — the
  // submit silently did nothing. Both sides are fixed: this immediate
  // normalization, and validateCheckin no longer treating a stale
  // conditional value as an error when pain=false (see checkinValidation.ts).
  function handlePainChange(value: boolean) {
    setForm((prev) => ({
      ...prev,
      pain: value,
      ...(value === false
        ? {
            pain_intensity: "",
            pain_new: null,
            pain_location_code: "",
            pain_traumatic: null,
            pain_function_loss: null,
            pain_getting_worse: null,
          }
        : {}),
    }));
    setSaveState("idle");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validateCheckin(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setErrors({});
    setSaveState("saving");
    setSaveErrorMessage(null);
    try {
      const saved = await saveCheckin(athleteId, date, result.values);
      setForm(rowToFormState(saved));
      setSaveState("saved");
      onCheckinAvailabilityChange?.(true);
      onSaved?.();
    } catch (error) {
      setSaveState("error");
      setSaveErrorMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    }
  }

  if (loadState === "loading") {
    return <p className="text-sm text-gray-400">Chargement du check-in…</p>;
  }

  if (loadState === "error") {
    return <p className="text-sm text-red-600">Impossible de charger le check-in du jour. Réessaie dans un instant.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400">Sommeil</legend>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Heures de sommeil
          <input
            type="number"
            inputMode="decimal"
            step={0.5}
            min={0}
            max={24}
            value={form.sleep_hours}
            onChange={(event) => updateField("sleep_hours", event.target.value === "" ? "" : Number(event.target.value))}
            className="rounded border border-gray-300 px-3 py-2"
          />
          {errors.sleep_hours && (
            <span role="alert" className="text-xs text-red-600">
              {errors.sleep_hours}
            </span>
          )}
        </label>
        <RatingSlider
          label="Qualité du sommeil"
          value={form.sleep_quality}
          onChange={(value) => updateField("sleep_quality", value)}
          error={errors.sleep_quality}
        />
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Réveils nocturnes
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            step={1}
            value={form.sleep_wake_ups}
            onChange={(event) => updateField("sleep_wake_ups", event.target.value === "" ? "" : Number(event.target.value))}
            className="rounded border border-gray-300 px-3 py-2"
          />
          {errors.sleep_wake_ups && (
            <span role="alert" className="text-xs text-red-600">
              {errors.sleep_wake_ups}
            </span>
          )}
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400">État général</legend>
        <RatingSlider label="Énergie" value={form.energy} onChange={(value) => updateField("energy", value)} error={errors.energy} />
        <RatingSlider
          label="Stress professionnel"
          value={form.work_stress}
          onChange={(value) => updateField("work_stress", value)}
          error={errors.work_stress}
        />
        <RatingSlider
          label="Motivation"
          value={form.motivation}
          onChange={(value) => updateField("motivation", value)}
          error={errors.motivation}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400">Fatigue</legend>
        <RatingSlider
          label="Jambes"
          value={form.leg_fatigue}
          onChange={(value) => updateField("leg_fatigue", value)}
          error={errors.leg_fatigue}
        />
        <RatingSlider
          label="Avant-bras / grip"
          value={form.grip_fatigue}
          onChange={(value) => updateField("grip_fatigue", value)}
          error={errors.grip_fatigue}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400">Santé / douleur</legend>
        <YesNoChoice label="Douleur" value={form.pain} onChange={handlePainChange} error={errors.pain} />

        {form.pain === true && (
          <div className="flex flex-col gap-3 border-l-2 border-gray-200 pl-3">
            <RatingSlider
              label="Intensité de la douleur"
              value={form.pain_intensity}
              onChange={(value) => updateField("pain_intensity", value)}
              error={errors.pain_intensity}
            />
            <YesNoChoice
              label="Douleur nouvelle"
              value={form.pain_new}
              onChange={(value) => updateField("pain_new", value)}
              error={errors.pain_new}
            />
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Localisation
              <select
                value={form.pain_location_code}
                onChange={(event) => updateField("pain_location_code", event.target.value as CheckinFormState["pain_location_code"])}
                className="rounded border border-gray-300 px-3 py-2"
              >
                <option value="">—</option>
                {PAIN_LOCATION_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <YesNoChoice
              label="Douleur traumatique"
              value={form.pain_traumatic}
              onChange={(value) => updateField("pain_traumatic", value)}
              error={errors.pain_traumatic}
            />
            <YesNoChoice
              label="Perte de fonction"
              value={form.pain_function_loss}
              onChange={(value) => updateField("pain_function_loss", value)}
              error={errors.pain_function_loss}
            />
            <YesNoChoice
              label="S'aggrave"
              value={form.pain_getting_worse}
              onChange={(value) => updateField("pain_getting_worse", value)}
              error={errors.pain_getting_worse}
            />
          </div>
        )}

        <YesNoChoice
          label="Suspicion de commotion"
          value={form.suspected_concussion}
          onChange={(value) => updateField("suspected_concussion", value)}
          error={errors.suspected_concussion}
          emphasize
        />
        <YesNoChoice
          label="Fièvre / maladie"
          value={form.fever_or_illness}
          onChange={(value) => updateField("fever_or_illness", value)}
          error={errors.fever_or_illness}
          emphasize
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400">Commentaire</legend>
        <textarea
          value={form.free_comment}
          onChange={(event) => updateField("free_comment", event.target.value)}
          rows={3}
          placeholder="Optionnel"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </fieldset>

      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-600">
          Certains champs doivent encore être complétés.
        </p>
      )}

      {saveState === "error" && saveErrorMessage && (
        <p role="alert" className="text-sm text-red-600">
          {saveErrorMessage}
        </p>
      )}
      {saveState === "saved" && <p className="text-sm text-green-600">Check-in enregistré</p>}

      <button
        type="submit"
        disabled={saveState === "saving"}
        className="rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {saveState === "saving" ? "Enregistrement…" : "Enregistrer le check-in"}
      </button>
    </form>
  );
}
