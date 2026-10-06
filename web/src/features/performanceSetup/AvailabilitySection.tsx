import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Card } from "../../components/Card";
import { PrimaryButton } from "../../components/PrimaryButton";
import { loadAvailabilityWindows, saveAvailabilityWindows, AvailabilityError, type AvailabilityWindow } from "./availabilityRepo";
import type { RidingDay } from "../athleteOnboarding/onboardingOptions";
import { TrainingAvailabilityEditor } from "../availability/TrainingAvailabilityEditor";
import { emptyWeek, isLegacyAvailability, weekFromWindows, windowsFromWeek, type WeekAvailability } from "../availability/trainingAvailability";

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
  /** UX-10B-1 — told after a successful save (the section's summary refreshes). */
  onSaved?: (windows: AvailabilityWindow[]) => void;
  /** UX-10B-1 — inside "Tes créneaux": no own card or title. */
  bare?: boolean;
  /** BUG-V2-1 — onboarding riding days, a starting point for a profile without typed availability. */
  ridingDays?: readonly RidingDay[];
}

export const LEGACY_AVAILABILITY_HINT = "Précise ce qui est physique et ce qui est vélo : ton plan placera chaque séance sur un jour qui lui convient.";

/**
 * BUG-V2-1 — physical and riding availability, per day. Saving replaces the
 * whole set (availabilityRepo.saveAvailabilityWindows), every window typed.
 */
export function AvailabilitySection({ onGateStateChange, onSaved, bare = false, ridingDays = [] }: AvailabilitySectionProps) {
  const { athleteId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<WeekAvailability>(emptyWeek());
  const [existing, setExisting] = useState<AvailabilityWindow[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!athleteId) return;
    let active = true;

    loadAvailabilityWindows()
      .then((windows) => {
        if (!active) return;
        setWeek(weekFromWindows(windows, ridingDays));
        setExisting(windows);
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
    // ridingDays only seeds the very first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

  const hasSavedAvailability = existing.length > 0;

  useEffect(() => {
    onGateStateChange({ loading, dirty, saving, hasSavedAvailability });
  }, [loading, dirty, saving, hasSavedAvailability, onGateStateChange]);

  function handleChange(next: WeekAvailability) {
    setWeek(next);
    setDirty(true);
    setSaved(false);
    setError(null);
  }

  async function handleSave() {
    if (!athleteId || saving) return;
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const result = await saveAvailabilityWindows(athleteId, windowsFromWeek(week), existing.map((w) => w.id));
      setExisting(result);
      setWeek(weekFromWindows(result));
      setDirty(false);
      setSaved(true);
      onSaved?.(result);
    } catch (err) {
      setError(err instanceof AvailabilityError ? err.message : "Une erreur inattendue s'est produite. Réessaie.");
    } finally {
      setSaving(false);
    }
  }

  const Wrapper = bare ? "div" : Card;
  return (
    <Wrapper className="flex flex-col gap-4">
      {!bare && (
        <div>
          <p className="text-sm font-medium text-ink">Disponibilités</p>
          <p className="text-sm text-ink/70">Le temps dont tu disposes chaque jour, pour le physique et pour le vélo.</p>
        </div>
      )}

      {loading ? (
        <div aria-busy="true">
          <p className="sr-only">Chargement…</p>
          <div className="ux-skeleton h-40 rounded-xl" />
        </div>
      ) : (
        <>
          {isLegacyAvailability(existing) && !dirty && <p className="text-sm text-gold">{LEGACY_AVAILABILITY_HINT}</p>}
          <TrainingAvailabilityEditor value={week} onChange={handleChange} />

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
    </Wrapper>
  );
}
