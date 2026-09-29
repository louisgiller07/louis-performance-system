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
    <div className={`rounded-lg border bg-card p-3.5 ${emphasize ? "border-red-500/40" : "border-line"}`}>
      <p className={`text-sm font-medium ${emphasize ? "text-red-400" : "text-ink"}`}>{label}</p>
      {description && <p className="text-xs text-muted">{description}</p>}
      <div className="mt-2 flex gap-2" role="group" aria-label={label}>
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(true)}
          className={`ux-press min-h-12 flex-1 rounded border px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] ${
            value === true ? "border-gold bg-gold text-bg" : "border-line bg-transparent text-ink/70 hover:border-gold/50"
          }`}
        >
          Oui
        </button>
        <button
          type="button"
          aria-pressed={value === false}
          onClick={() => onChange(false)}
          className={`ux-press min-h-12 flex-1 rounded border px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] ${
            value === false ? "border-gold bg-gold text-bg" : "border-line bg-transparent text-ink/70 hover:border-gold/50"
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
