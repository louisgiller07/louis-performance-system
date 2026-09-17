interface RatingSliderProps {
  label: string;
  value: number | "";
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  error?: string;
  /**
   * NAL-004 — compact endpoint semantics ("what does 0/10 actually mean"),
   * e.g. lowLabel="Épuisé" highLabel="Plein d'énergie". Purely descriptive
   * text, never affects the numeric value submitted (min/max/step/value are
   * unchanged) — see checkin scale semantics audited against
   * head-coach-engine/src/engine/computeDimensions.ts and
   * types/checkin.ts's own "plus haut = ..." doc comments before wording
   * any of these at call sites. Optional so a future consumer without
   * verified endpoint semantics isn't forced to invent wording.
   */
  lowLabel?: string;
  highLabel?: string;
  /**
   * V0.3_005C (NAL-006) — a short clarifying sentence shown under the
   * label, e.g. "À quel point cette séance t'a sollicité globalement ?"
   * for RPE. Distinct from lowLabel/highLabel (endpoint semantics): this
   * is for a field whose overall meaning needs a one-line clarification,
   * not just what 0/10 mean. Purely descriptive — never affects the
   * numeric value submitted.
   */
  helper?: string;
  /**
   * V0.3 UX PREMIUM REDESIGN — an optional short dynamic status word next
   * to the numeric value (e.g. "Bonne récupération"), computed by the
   * caller from the SAME value already shown — purely presentational,
   * never sent to the backend and never affects onChange/value. Callers
   * only pass this where the exact threshold wording has been explicitly
   * specified (see CheckinForm.tsx's sleep quality field) — never invented
   * generically here.
   */
  valueLabel?: string;
}

export function RatingSlider({ label, value, min = 0, max = 10, onChange, error, lowLabel, highLabel, helper, valueLabel }: RatingSliderProps) {
  const percent = value === "" ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-sm text-ink/80">
        <span>{label}</span>
        <span className="flex items-baseline gap-2">
          {valueLabel && <span className="text-[10px] font-semibold uppercase tracking-wide text-gold">{valueLabel}</span>}
          <span className="font-mono text-xs text-muted">{value === "" ? "—" : value}</span>
        </span>
      </span>
      {helper && <span className="text-xs text-muted">{helper}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value === "" ? min : value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full touch-manipulation appearance-none rounded-full accent-gold"
        style={{ background: `linear-gradient(to right, var(--color-gold) ${percent}%, rgba(255,255,255,0.08) ${percent}%)` }}
      />
      {(lowLabel || highLabel) && (
        <span className="flex items-center justify-between text-[11px] text-muted">
          <span>
            {min} · {lowLabel}
          </span>
          <span>
            {highLabel} · {max}
          </span>
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}
