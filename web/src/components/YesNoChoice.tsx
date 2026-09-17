interface YesNoChoiceProps {
  label: string;
  description?: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
  emphasize?: boolean;
  error?: string;
}

// Explicit tri-state Oui/Non — no option pre-selected. A checkbox defaults
// to "unchecked", which silently reads as "non" for a health/safety
// question the user never actually answered; this component makes
// "unanswered" a real, visible, non-default state instead.
export function YesNoChoice({ label, description, value, onChange, emphasize, error }: YesNoChoiceProps) {
  return (
    <div className={`rounded-lg p-3 ${emphasize ? "border border-red-500/40 bg-red-950/30" : "border border-white/5 bg-card"}`}>
      <p className={`text-sm font-medium ${emphasize ? "text-red-400" : "text-ink"}`}>{label}</p>
      {description && <p className="text-xs text-muted">{description}</p>}
      <div className="mt-2 flex gap-2" role="group" aria-label={label}>
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(true)}
          className={`min-h-11 flex-1 rounded border px-3 py-2 text-sm font-medium ${
            value === true ? "border-gold bg-gold text-bg" : "border-white/10 bg-transparent text-ink/70"
          }`}
        >
          Oui
        </button>
        <button
          type="button"
          aria-pressed={value === false}
          onClick={() => onChange(false)}
          className={`min-h-11 flex-1 rounded border px-3 py-2 text-sm font-medium ${
            value === false ? "border-gold bg-gold text-bg" : "border-white/10 bg-transparent text-ink/70"
          }`}
        >
          Non
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
