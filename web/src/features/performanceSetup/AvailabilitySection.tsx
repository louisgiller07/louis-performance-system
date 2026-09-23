import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Card } from "../../components/Card";
import { PrimaryButton } from "../../components/PrimaryButton";
import {
  loadAvailabilityWindows,
  saveAvailabilityWindows,
  deriveAvailabilityForm,
  AvailabilityError,
  type AvailabilityFormDay,
  type AvailabilityDayOfWeek,
  type SaveAvailabilityWindowInput,
} from "./availabilityRepo";

const DAY_LABELS: Record<AvailabilityDayOfWeek, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  0: "Dimanche",
};

// French display order (Monday first) — independent of the DB's own
// 0=Sunday storage convention, which stays untouched end to end.
const DISPLAY_ORDER: readonly AvailabilityDayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

export interface AvailabilityGateState {
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  /** True once >=1 window is actually persisted — mirrors the backend's own missing_availability gate (windows.length > 0), never a separate/looser rule invented here (V0.5_044 lock). */
  hasSavedAvailability: boolean;
}

export interface AvailabilitySectionProps {
  /** Reports this section's gate-relevant state up to PerformanceSetup.tsx, which owns the actual generation gate — no global context, no lifted form state (V0.5_044 lock: "callbacks/props ou pattern local simple"). */
  onGateStateChange: (state: AvailabilityGateState) => void;
}

/** Local toggle — same visual language as PerformanceSetup.tsx's own ToggleChip, not imported (siblings in the same feature folder, kept decoupled — same reasoning as TrainingPlanGenerationPanel.tsx staying self-contained). */
function DayToggle({ available, onClick }: { available: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={available}
      className={`rounded-full border px-3 py-2 text-sm transition-colors ${
        available ? "border-gold bg-gold/10 text-ink" : "border-white/10 bg-bg text-ink/80 hover:border-white/25"
      }`}
    >
      {available ? "Disponible" : "Non disponible"}
    </button>
  );
}

function validateDays(days: readonly AvailabilityFormDay[]): string | null {
  for (const day of days) {
    if (!day.available) continue;
    if (!day.startTime || !day.endTime) {
      return `Indique une heure de début et de fin pour ${DAY_LABELS[day.dayOfWeek]}.`;
    }
    if (day.endTime <= day.startTime) {
      return `L'heure de fin doit être après l'heure de début pour ${DAY_LABELS[day.dayOfWeek]}.`;
    }
  }
  return null;
}

/**
 * /performance-setup's "Disponibilités" section (V0.5_045) — the athlete's
 * only real way to satisfy `missing_availability` today. Owns its own
 * load/edit/validate/save lifecycle entirely (no component outside this
 * file ever calls Supabase for this data), and reports only the 4 booleans
 * PerformanceSetup.tsx actually needs for its generation gate via
 * `onGateStateChange` — never the form data itself.
 *
 * V0.5_045 scope lock: `athlete_availability_windows` only. Exceptions and
 * locked dates are out of scope (V0.5_044 decision) — not represented here
 * even as disabled/placeholder UI.
 */
export function AvailabilitySection({ onGateStateChange }: AvailabilitySectionProps) {
  const { athleteId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<AvailabilityFormDay[]>(deriveAvailabilityForm([]));
  const [existingIds, setExistingIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!athleteId) return;
    let active = true;

    loadAvailabilityWindows()
      .then((windows) => {
        if (!active) return;
        setDays(deriveAvailabilityForm(windows));
        setExistingIds(windows.map((w) => w.id));
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("Impossible de charger tes disponibilités. Réessaie.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [athleteId]);

  const hasSavedAvailability = existingIds.length > 0;

  useEffect(() => {
    onGateStateChange({ loading, dirty, saving, hasSavedAvailability });
  }, [loading, dirty, saving, hasSavedAvailability, onGateStateChange]);

  function updateDay(dayOfWeek: AvailabilityDayOfWeek, updater: (d: AvailabilityFormDay) => AvailabilityFormDay) {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? updater(d) : d)));
    setDirty(true);
    setSaved(false);
    setError(null);
  }

  function handleToggle(dayOfWeek: AvailabilityDayOfWeek) {
    updateDay(dayOfWeek, (d) => ({ ...d, available: !d.available }));
  }

  function handleStartTimeChange(dayOfWeek: AvailabilityDayOfWeek, value: string) {
    updateDay(dayOfWeek, (d) => ({ ...d, startTime: value }));
  }

  function handleEndTimeChange(dayOfWeek: AvailabilityDayOfWeek, value: string) {
    updateDay(dayOfWeek, (d) => ({ ...d, endTime: value }));
  }

  async function handleSave() {
    if (!athleteId || saving) return;

    const validationError = validateDays(days);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const newWindows: SaveAvailabilityWindowInput[] = days
        .filter((d) => d.available)
        .map((d) => ({ dayOfWeek: d.dayOfWeek, startTime: d.startTime, endTime: d.endTime }));

      const result = await saveAvailabilityWindows(athleteId, newWindows, existingIds);

      setExistingIds(result.map((w) => w.id));
      setDays(deriveAvailabilityForm(result));
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof AvailabilityError ? err.message : "Une erreur inattendue s'est produite. Réessaie.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-ink">Disponibilités</p>
        <p className="text-sm text-ink/70">Indique les jours où tu peux généralement t'entraîner.</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {DISPLAY_ORDER.map((dayOfWeek) => {
              const day = days.find((d) => d.dayOfWeek === dayOfWeek);
              if (!day) return null;
              return (
                <div key={dayOfWeek} role="group" aria-label={DAY_LABELS[dayOfWeek]} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink">{DAY_LABELS[dayOfWeek]}</span>
                    <DayToggle available={day.available} onClick={() => handleToggle(dayOfWeek)} />
                  </div>
                  {day.available && (
                    <div className="flex items-center gap-2 text-sm text-ink/80">
                      <span>De</span>
                      <input
                        type="time"
                        aria-label={`Heure de début — ${DAY_LABELS[dayOfWeek]}`}
                        value={day.startTime}
                        onChange={(e) => handleStartTimeChange(dayOfWeek, e.target.value)}
                        className="rounded border border-white/10 bg-transparent px-3 py-2 text-sm text-ink"
                      />
                      <span>à</span>
                      <input
                        type="time"
                        aria-label={`Heure de fin — ${DAY_LABELS[dayOfWeek]}`}
                        value={day.endTime}
                        onChange={(e) => handleEndTimeChange(dayOfWeek, e.target.value)}
                        className="rounded border border-white/10 bg-transparent px-3 py-2 text-sm text-ink"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {saved && !error && <p className="text-sm text-gold">Disponibilités enregistrées.</p>}
          {!hasSavedAvailability && !error && (
            <p className="text-sm text-muted">
              Aucune disponibilité enregistrée pour le moment — la génération de plan restera bloquée tant que tu n'en as pas sauvegardé au moins une.
            </p>
          )}

          <PrimaryButton onClick={() => void handleSave()} disabled={saving} className="w-full">
            {saving ? "Enregistrement…" : "Enregistrer mes disponibilités"}
          </PrimaryButton>
        </>
      )}
    </Card>
  );
}
