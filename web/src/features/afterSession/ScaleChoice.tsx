// UX-08 — a 0–10 answer in one tap (large targets, no slider to drag after
// an effort). The value is exactly the number tapped; the anchors only say
// what the ends of the scale mean.
export function ScaleChoice({
  label,
  value,
  onChange,
  anchors,
  hideLabel = false,
  valueLabel,
}: {
  label: string;
  /** The step title already says it (still read by screen readers). */
  hideLabel?: boolean;
  value: number | "";
  onChange: (value: number) => void;
  anchors: readonly { value: number; label: string }[];
  /** A11 — what the chosen value means, in words (e.g. effort 7 → « Difficile »). */
  valueLabel?: (value: number) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline justify-between">
        <span className={hideLabel ? "sr-only" : "text-sm font-medium text-ink"}>{label}</span>
        <span key={String(value)} className="ux-pop flex items-baseline gap-2">
          {value !== "" && valueLabel && (
            <span className="text-sm font-medium text-ink/80" data-testid="scale-value-label">
              {valueLabel(value)}
            </span>
          )}
          <span className="font-display text-3xl font-extrabold leading-none text-gold">{value === "" ? "—" : `${value}/10`}</span>
        </span>
      </p>
      <div role="group" aria-label={label} className="grid grid-cols-6 gap-2">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            aria-label={`${label} ${n} sur 10`}
            onClick={() => onChange(n)}
            className={`ux-press min-h-12 rounded border font-display text-xl font-extrabold ${
              value === n ? "border-gold bg-gold text-bg" : "border-line text-ink/80 hover:border-gold/50"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="flex justify-between text-xs text-muted" aria-hidden="true">
        {anchors.map((anchor) => (
          <span key={anchor.value}>{`${anchor.value} · ${anchor.label}`}</span>
        ))}
      </p>
    </div>
  );
}
