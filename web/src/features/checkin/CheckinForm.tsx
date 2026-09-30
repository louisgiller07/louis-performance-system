import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { RatingSlider } from "../../components/RatingSlider";
import { YesNoChoice } from "../../components/YesNoChoice";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { Select } from "../../components/Select";
import { loadCheckin, saveCheckin } from "./checkinRepo";
import { validateCheckin, type CheckinFieldErrors } from "./checkinValidation";
import { EMPTY_CHECKIN_FORM_STATE, PAIN_LOCATION_CODES, PAIN_LOCATION_LABELS, rowToFormState, type CheckinFormState, type CheckinRow } from "./checkinTypes";

type LoadState = "loading" | "loaded" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * UX-03 — the guided check-in ritual: the same fields, grouped into four
 * themed steps shown one at a time. Purely a presentation of the existing
 * form — same state, same validateCheckin(), same saveCheckin(). "Suivant"
 * only advances once validateCheckin() reports no error for the current
 * step's own fields (the rules themselves are never re-implemented here).
 */
type StepId = "sommeil" | "energie" | "fatigue" | "sante";

interface GuidedStep {
  id: StepId;
  title: string;
  question: string;
  fields: (keyof CheckinFormState)[];
}

const GUIDED_STEPS: GuidedStep[] = [
  { id: "sommeil", title: "Sommeil", question: "Comment as-tu dormi cette nuit ?", fields: ["sleep_hours", "sleep_quality", "sleep_wake_ups"] },
  { id: "energie", title: "Énergie", question: "Où en est ta tête ce matin ?", fields: ["energy", "work_stress", "motivation"] },
  { id: "fatigue", title: "Fatigue", question: "Qu'est-ce que tes jambes et tes avant-bras te disent ?", fields: ["leg_fatigue", "grip_fatigue"] },
  {
    id: "sante",
    title: "Santé",
    question: "Un dernier point, le plus important.",
    fields: [
      "pain",
      "pain_intensity",
      "pain_new",
      "pain_location_code",
      "pain_traumatic",
      "pain_function_loss",
      "pain_getting_worse",
      "suspected_concussion",
      "fever_or_illness",
      "free_comment",
    ],
  },
];

/**
 * V0.3 UX PREMIUM REDESIGN — dynamic status word shown next to the sleep
 * quality slider, computed purely from the value already on screen.
 * Presentational only: never sent to the backend, never changes
 * `sleep_quality` itself (see RatingSlider.tsx's `valueLabel` doc). Exact
 * thresholds as specified for this field only — not generalized to any
 * other slider (energy/stress/motivation/fatigue semantics differ and
 * weren't given equivalent thresholds).
 */
function sleepQualityLabel(value: number | ""): string | undefined {
  if (value === "") return undefined;
  if (value >= 8) return "Bonne récupération";
  if (value >= 5) return "Récupération moyenne";
  return "Dette de sommeil";
}

interface CheckinFormProps {
  athleteId: string;
  date: string;
  /**
   * Reports whether a checkin currently exists for this date — fired once
   * after the initial load (row found vs. none), and again after every
   * successful save (always true then). This is the single signal
   * TodayPage needs to enable "Préparer ma séance du jour" — it never needs a
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
  /**
   * UX-03 — "full" (default): every field on one page, the historical
   * layout. "guided": one themed step at a time with progress (Today's
   * check-in ritual). Same data, validation and save in both modes.
   */
  mode?: "full" | "guided";
  /**
   * UX-04 — read-only: today's check-in as loaded, then as saved (null when
   * none exists yet). Lets Today show the athlete's own declared values.
   */
  onValuesChange?: (row: CheckinRow | null) => void;
}

// M4_003 — real persistence, RLS-scoped. No daily-run call, no DailyPlan
// rendering, no coaching/safety decision here — this component only
// collects and saves facts.
export function CheckinForm({ athleteId, date, onCheckinAvailabilityChange, onSaved, mode = "full", onValuesChange }: CheckinFormProps) {
  const guided = mode === "guided";
  const [step, setStep] = useState(0);
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
        onValuesChange?.(row);
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

  // Guided mode — advance only when the current step's own fields pass the
  // existing validation; errors in later steps never block "Suivant".
  function handleNext() {
    const fields = GUIDED_STEPS[step]!.fields;
    const result = validateCheckin(form);
    const stepErrors: CheckinFieldErrors = {};
    if (!result.ok) {
      for (const field of fields) {
        if (result.errors[field]) stepErrors[field] = result.errors[field];
      }
    }
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) setStep((current) => Math.min(current + 1, GUIDED_STEPS.length - 1));
  }

  function handleBack() {
    setErrors({});
    setStep((current) => Math.max(current - 1, 0));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (guided && step < GUIDED_STEPS.length - 1) {
      handleNext();
      return;
    }
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
      if (guided) setStep(0);
      onValuesChange?.(saved);
      onCheckinAvailabilityChange?.(true);
      onSaved?.();
    } catch (error) {
      setSaveState("error");
      setSaveErrorMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    }
  }

  if (loadState === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <p className="sr-only">Chargement du check-in…</p>
        <div className="ux-skeleton h-5 w-1/3 rounded" />
        <div className="ux-skeleton h-12 rounded-lg" />
        <div className="ux-skeleton h-12 rounded-lg" />
      </div>
    );
  }

  if (loadState === "error") {
    return <p className="text-sm text-red-400">Impossible de charger le check-in du jour. Réessaie dans un instant.</p>;
  }

  // UX-03 — the same field groups, rendered all at once ("full") or one
  // themed step at a time ("guided"). Each group is defined exactly once.
  const sections: Record<StepId, ReactNode> = {
    sommeil: (
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-widest text-muted">Sommeil</legend>
        <label className="flex flex-col gap-1 text-sm text-ink/80">
          Heures de sommeil
          <input
            type="number"
            inputMode="decimal"
            step={0.5}
            min={0}
            max={24}
            value={form.sleep_hours}
            onChange={(event) => updateField("sleep_hours", event.target.value === "" ? "" : Number(event.target.value))}
            className="rounded border border-white/10 bg-transparent px-3 py-3 text-base text-ink"
          />
          {errors.sleep_hours && (
            <span role="alert" className="text-xs text-red-400">
              {errors.sleep_hours}
            </span>
          )}
        </label>
        <RatingSlider
          label="Qualité du sommeil"
          value={form.sleep_quality}
          onChange={(value) => updateField("sleep_quality", value)}
          error={errors.sleep_quality}
          lowLabel="Très mauvaise"
          highLabel="Excellente"
          valueLabel={sleepQualityLabel(form.sleep_quality)}
        />
        <label className="flex flex-col gap-1 text-sm text-ink/80">
          Réveils nocturnes
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            step={1}
            value={form.sleep_wake_ups}
            onChange={(event) => updateField("sleep_wake_ups", event.target.value === "" ? "" : Number(event.target.value))}
            className="rounded border border-white/10 bg-transparent px-3 py-3 text-base text-ink"
          />
          {errors.sleep_wake_ups && (
            <span role="alert" className="text-xs text-red-400">
              {errors.sleep_wake_ups}
            </span>
          )}
        </label>
      </fieldset>
    ),
    energie: (
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-widest text-muted">État général</legend>
        <RatingSlider
          label="Énergie"
          value={form.energy}
          onChange={(value) => updateField("energy", value)}
          error={errors.energy}
          lowLabel="Épuisé"
          highLabel="Plein d'énergie"
        />
        <RatingSlider
          label="Stress professionnel"
          value={form.work_stress}
          onChange={(value) => updateField("work_stress", value)}
          error={errors.work_stress}
          lowLabel="Aucun stress"
          highLabel="Stress maximal"
        />
        <RatingSlider
          label="Motivation"
          value={form.motivation}
          onChange={(value) => updateField("motivation", value)}
          error={errors.motivation}
          lowLabel="Aucune"
          highLabel="Très motivé"
        />
      </fieldset>
    ),
    fatigue: (
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-widest text-muted">Fatigue</legend>
        <RatingSlider
          label="Jambes"
          value={form.leg_fatigue}
          onChange={(value) => updateField("leg_fatigue", value)}
          error={errors.leg_fatigue}
          lowLabel="Fraîches"
          highLabel="Très lourdes"
        />
        <RatingSlider
          label="Avant-bras / grip"
          value={form.grip_fatigue}
          onChange={(value) => updateField("grip_fatigue", value)}
          error={errors.grip_fatigue}
          lowLabel="Frais"
          highLabel="Très fatigué"
        />
      </fieldset>
    ),
    sante: (
      <>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs font-semibold uppercase tracking-widest text-muted">Santé / douleur</legend>
          <YesNoChoice label="Douleur" value={form.pain} onChange={handlePainChange} error={errors.pain} />

          {form.pain === true && (
            <div className="flex flex-col gap-3 border-l-2 border-white/10 pl-3">
              <RatingSlider
                label="Intensité de la douleur"
                value={form.pain_intensity}
                onChange={(value) => updateField("pain_intensity", value)}
                error={errors.pain_intensity}
                lowLabel="Aucune douleur"
                highLabel="Douleur maximale"
              />
              <YesNoChoice
                label="Douleur nouvelle"
                value={form.pain_new}
                onChange={(value) => updateField("pain_new", value)}
                error={errors.pain_new}
              />
              <label className="flex flex-col gap-1 text-sm text-ink/80">
                Localisation
                <Select
                  value={form.pain_location_code}
                  onChange={(event) => updateField("pain_location_code", event.target.value as CheckinFormState["pain_location_code"])}
                >
                  <option value="">—</option>
                  {PAIN_LOCATION_CODES.map((code) => (
                    <option key={code} value={code}>
                      {PAIN_LOCATION_LABELS[code]}
                    </option>
                  ))}
                </Select>
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
          <legend className="text-xs font-semibold uppercase tracking-widest text-muted">Commentaire</legend>
          <textarea
            aria-label="Commentaire"
            value={form.free_comment}
            onChange={(event) => updateField("free_comment", event.target.value)}
            rows={3}
            placeholder="Optionnel"
            className="rounded border border-white/10 bg-transparent px-3 py-3 text-base text-ink placeholder:text-muted"
          />
        </fieldset>
      </>
    ),
  };

  const feedback = (
    <>
    {Object.keys(errors).length > 0 && (
      <p role="alert" className="text-sm text-red-400">
        Certains champs doivent encore être complétés.
      </p>
    )}

    {saveState === "error" && saveErrorMessage && (
      <p role="alert" className="text-sm text-red-400">
        {saveErrorMessage}
      </p>
    )}
    {saveState === "saved" && <p className="text-sm text-gold">Check-in enregistré</p>}
    </>
  );

  if (!guided) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {sections.sommeil}
        {sections.energie}
        {sections.fatigue}
        {sections.sante}
        {feedback}
        <PrimaryButton type="submit" disabled={saveState === "saving"}>
          {saveState === "saving" ? "Enregistrement…" : "Enregistrer le check-in"}
        </PrimaryButton>
      </form>
    );
  }

  const current = GUIDED_STEPS[step]!;
  const isLast = step === GUIDED_STEPS.length - 1;
  return (
    <form onSubmit={handleSubmit} className="flex min-h-full flex-col" aria-label="Check-in du jour">
      <div className="flex gap-1.5" aria-hidden="true">
        {GUIDED_STEPS.map((guidedStep, index) => (
          <span key={guidedStep.id} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${index <= step ? "bg-gold" : "bg-line"}`} />
        ))}
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-muted">
        Étape {step + 1} / {GUIDED_STEPS.length}
      </p>

      <div key={current.id} className="ux-enter mt-2 flex flex-1 flex-col gap-6">
        <div>
          <h2 className="font-display text-5xl font-extrabold uppercase leading-none text-ink">{current.title}</h2>
          <p className="mt-2 text-base text-ink/70">{current.question}</p>
        </div>
        <div className="checkin-guided flex flex-col gap-5">{sections[current.id]}</div>
      </div>

      <div className="sticky bottom-0 -mx-5 mt-8 flex flex-col gap-3 border-t border-line bg-bg/95 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur-md">
        {feedback}
        <div className="flex gap-3">
          {step > 0 && (
            <SecondaryButton onClick={handleBack} className="min-h-12 px-5">
              Retour
            </SecondaryButton>
          )}
          <PrimaryButton type="submit" disabled={saveState === "saving"} className="flex-1 tracking-[0.08em]">
            {isLast ? (saveState === "saving" ? "Enregistrement…" : "Enregistrer le check-in") : "Suivant"}
          </PrimaryButton>
        </div>
      </div>
    </form>
  );
}
