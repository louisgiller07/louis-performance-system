import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { PrimaryButton } from "../../components/PrimaryButton";
import { HealthDataConsentCheckbox } from "./HealthDataConsentCheckbox";
import { recordHealthDataConsent, HealthDataConsentError } from "./consentRepo";

/**
 * Shown by RequireAuth to an athlete who completed onboarding but has not accepted the
 * current privacy notice (existing accounts, or a later notice version). Nothing else in
 * the app is reachable until they explicitly consent — consent is never inferred.
 */
export function ConsentGate() {
  const { athleteId, refreshAthlete } = useAuth();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!athleteId || !checked || saving) return;
    setError(null);
    setSaving(true);
    try {
      await recordHealthDataConsent(athleteId);
      await refreshAthlete();
    } catch (err) {
      setError(err instanceof HealthDataConsentError ? err.message : "Une erreur inattendue s'est produite. Réessaie.");
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-4 py-8">
      <div className="flex w-full max-w-105 flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Tes données de santé</h1>
          <p className="mt-2 text-sm text-muted">
            Tes check-ins peuvent contenir des informations de santé. Avant de continuer, lis les informations de confidentialité et
            donne ton accord.
          </p>
        </div>

        <HealthDataConsentCheckbox checked={checked} onChange={setChecked} disabled={saving} />

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <PrimaryButton onClick={() => void handleContinue()} disabled={!checked || saving} className="min-h-12.5 text-base tracking-wide">
          {saving ? "Enregistrement…" : "Continuer"}
        </PrimaryButton>
      </div>
    </div>
  );
}
