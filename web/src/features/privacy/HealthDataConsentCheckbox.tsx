interface HealthDataConsentCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Explicit health-data consent — never pre-checked; the notice opens in a new tab so no in-progress form state is lost. */
export function HealthDataConsentCheckbox({ checked, onChange, disabled }: HealthDataConsentCheckboxProps) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-bg p-4 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-5 w-5 shrink-0 accent-gold"
      />
      <span>
        J'ai lu les{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-gold underline">
          informations de confidentialité
        </a>{" "}
        et j'accepte que les données de santé que je renseigne dans mes check-ins (douleur, maladie, fatigue, suspicion de commotion)
        soient utilisées par NALYNT pour adapter mes recommandations d'entraînement.
      </span>
    </label>
  );
}
