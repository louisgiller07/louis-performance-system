import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { PageShell } from "../../components/PageShell";
import { AppHeader } from "../../components/AppHeader";
import { SectionHeader } from "../../components/SectionHeader";
import { Card } from "../../components/Card";
import { Select } from "../../components/Select";
import { PrimaryButton } from "../../components/PrimaryButton";
import {
  loadPerformanceSetupAnswers,
  savePerformanceSetup,
  PerformanceSetupError,
  type PerformanceSetupAnswers,
} from "./performanceSetupRepo";
import {
  EQUIPMENT_OPTIONS,
  EQUIPMENT_LABELS,
  TERRAIN_OPTIONS,
  TERRAIN_LABELS,
  TECHNICAL_PRIORITY_OPTIONS,
  TECHNICAL_PRIORITY_LABELS,
  STRENGTH_EXPERIENCE_TIER_OPTIONS,
  STRENGTH_EXPERIENCE_TIER_LABELS,
} from "./performanceSetupOptions";
import { TrainingPlanGenerationPanel } from "./TrainingPlanGenerationPanel";
import { AvailabilitySection, type AvailabilityGateState } from "./AvailabilitySection";

const EMPTY_ANSWERS: PerformanceSetupAnswers = {
  equipment: [],
  terrainAccess: [],
  strengths: [],
  weaknesses: [],
  priorityAreas: [],
  strengthExperienceTier: null,
  seasonObjective: null,
};

/** Local toggle chip for multi-select fields — same visual family as AthleteOnboarding's own local ChoiceCard, adapted for multiple selection instead of one-of. Not a shared component: this exact toggle shape has no other consumer yet (same precedent as ChoiceCard staying local to its own feature). */
function ToggleChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full border px-3 py-2 text-sm transition-colors ${
        selected ? "border-gold bg-gold/10 text-ink" : "border-white/10 bg-bg text-ink/80 hover:border-white/25"
      }`}
    >
      {label}
    </button>
  );
}

function ToggleGroup<T extends string>({
  options,
  labels,
  selected,
  onToggle,
}: {
  options: readonly T[];
  /** Display label per persisted value — the value itself is never rendered. */
  labels: Record<T, string>;
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <ToggleChip key={option} label={labels[option]} selected={selected.includes(option)} onClick={() => onToggle(option)} />
      ))}
    </div>
  );
}

function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * /performance-setup (V0.5_021) — a single-page settings form, deliberately
 * NOT a step-by-step wizard like AthleteOnboarding: onboarding's per-step
 * saves exist specifically to let a refresh resume mid-wizard at the right
 * step (V0.3_008A); this page has no equivalent sequential flow to resume —
 * every field belongs to the same one row (athlete_performance_profiles)
 * and is saved together on a single explicit action. Collects data only: no
 * coaching logic, no catalogue/compatibility computation, no engine call —
 * `buildPlanInputSnapshot()`/planning-engine own the real validation
 * (GenerationBlockedError/PlanningEngineValidationError); this page only
 * prevents submitting a literally empty form (UX-level guard, never a
 * reimplementation of that validation, V0.5_021 lock).
 *
 * `declaredLimitations` is intentionally not exposed here — no
 * planning-engine/prescription-engine rule consumes it today (V0.5_017/018
 * audits) — exposing a field with no real effect on generation would be
 * misleading.
 */
export function PerformanceSetup() {
  const { athleteId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [answers, setAnswers] = useState<PerformanceSetupAnswers>(EMPTY_ANSWERS);
  // V0.5_036 — no existing dirty-tracking mechanism to reuse (confirmed:
  // `saved` only ever flips true on success and is never reset on a later
  // edit). This is the deliberately simple, component-local substitute the
  // ticket asked for: every user-driven edit (never the initial load) marks
  // the form dirty; only a successful save clears it. A plan must never be
  // generated from unsaved changes — see TrainingPlanGenerationPanel's
  // `configurationReady` prop below.
  const [dirty, setDirty] = useState(false);
  // V0.5_045 — availability lives in its own section/component with its own
  // load/save lifecycle (AvailabilitySection.tsx); this page only tracks the
  // small slice of its state the generation gate actually needs, reported
  // via onGateStateChange. loading starts true so the gate never reads
  // "ready" before the athlete's real saved availability is known.
  const [availabilityGate, setAvailabilityGate] = useState<AvailabilityGateState>({
    loading: true,
    dirty: false,
    saving: false,
    hasSavedAvailability: false,
  });

  function updateAnswers(updater: (a: PerformanceSetupAnswers) => PerformanceSetupAnswers) {
    setAnswers(updater);
    setDirty(true);
  }

  useEffect(() => {
    if (!athleteId) return;
    let active = true;

    loadPerformanceSetupAnswers()
      .then((loaded) => {
        if (!active) return;
        setAnswers(loaded);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("Impossible de charger ton profil de performance. Réessaie.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [athleteId]);

  const isEmpty =
    answers.equipment.length === 0 &&
    answers.terrainAccess.length === 0 &&
    answers.strengths.length === 0 &&
    answers.weaknesses.length === 0 &&
    answers.priorityAreas.length === 0 &&
    answers.strengthExperienceTier === null &&
    (answers.seasonObjective ?? "").trim().length === 0;

  async function handleSave() {
    if (!athleteId || saving || isEmpty) return;
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      await savePerformanceSetup(athleteId, answers);
      setSaved(true);
      setDirty(false);
    } catch (err) {
      setError(err instanceof PerformanceSetupError ? err.message : "Une erreur inattendue s'est produite. Réessaie.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageShell header={<AppHeader />}>
        <p className="text-center text-sm text-muted">Chargement…</p>
      </PageShell>
    );
  }

  return (
    <PageShell header={<AppHeader />}>
      <SectionHeader title="Profil de performance" subtitle="Ces informations orientent la génération de ton plan d'entraînement." />

      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink">Équipement disponible</p>
        <ToggleGroup
          options={EQUIPMENT_OPTIONS}
          labels={EQUIPMENT_LABELS}
          selected={answers.equipment}
          onToggle={(value) => updateAnswers((a) => ({ ...a, equipment: toggleValue(a.equipment, value) }))}
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink">Terrain accessible</p>
        <ToggleGroup
          options={TERRAIN_OPTIONS}
          labels={TERRAIN_LABELS}
          selected={answers.terrainAccess}
          onToggle={(value) => updateAnswers((a) => ({ ...a, terrainAccess: toggleValue(a.terrainAccess, value) }))}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <p className="text-sm font-medium text-ink">Priorités techniques</p>

        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-widest text-muted">Points forts</p>
          <ToggleGroup
            options={TECHNICAL_PRIORITY_OPTIONS}
            labels={TECHNICAL_PRIORITY_LABELS}
            selected={answers.strengths}
            onToggle={(value) => updateAnswers((a) => ({ ...a, strengths: toggleValue(a.strengths, value) }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-widest text-muted">Points faibles</p>
          <ToggleGroup
            options={TECHNICAL_PRIORITY_OPTIONS}
            labels={TECHNICAL_PRIORITY_LABELS}
            selected={answers.weaknesses}
            onToggle={(value) => updateAnswers((a) => ({ ...a, weaknesses: toggleValue(a.weaknesses, value) }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-widest text-muted">Priorités pour ce plan</p>
          <ToggleGroup
            options={TECHNICAL_PRIORITY_OPTIONS}
            labels={TECHNICAL_PRIORITY_LABELS}
            selected={answers.priorityAreas}
            onToggle={(value) => updateAnswers((a) => ({ ...a, priorityAreas: toggleValue(a.priorityAreas, value) }))}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink">Expérience en préparation physique</p>
        <Select
          value={answers.strengthExperienceTier ?? ""}
          onChange={(e) =>
            updateAnswers((a) => ({
              ...a,
              strengthExperienceTier: e.target.value === "" ? null : (e.target.value as PerformanceSetupAnswers["strengthExperienceTier"]),
            }))
          }
        >
          <option value="">— Choisir —</option>
          {STRENGTH_EXPERIENCE_TIER_OPTIONS.map((tier) => (
            <option key={tier} value={tier}>
              {STRENGTH_EXPERIENCE_TIER_LABELS[tier]}
            </option>
          ))}
        </Select>
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink">Objectif de saison (optionnel)</p>
        <textarea
          value={answers.seasonObjective ?? ""}
          onChange={(e) => updateAnswers((a) => ({ ...a, seasonObjective: e.target.value }))}
          rows={3}
          className="rounded border border-white/10 bg-transparent px-3 py-2 text-sm text-ink placeholder:text-muted"
          placeholder="Ex. Podium aux championnats nationaux"
        />
      </Card>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved && !error && <p className="text-sm text-gold">Profil enregistré.</p>}

      <PrimaryButton onClick={() => void handleSave()} disabled={saving || isEmpty} className="w-full">
        {saving ? "Enregistrement…" : "Enregistrer"}
      </PrimaryButton>

      <AvailabilitySection onGateStateChange={setAvailabilityGate} />

      <TrainingPlanGenerationPanel
        configurationReady={
          !dirty &&
          !saving &&
          !availabilityGate.loading &&
          !availabilityGate.dirty &&
          !availabilityGate.saving &&
          availabilityGate.hasSavedAvailability
        }
      />
    </PageShell>
  );
}
