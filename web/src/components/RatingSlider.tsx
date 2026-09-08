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
}

export function RatingSlider({ label, value, min = 0, max = 10, onChange, error, lowLabel, highLabel, helper }: RatingSliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-sm text-gray-700">
        <span>{label}</span>
        <span className="font-mono text-xs text-gray-400">{value === "" ? "—" : value}</span>
      </span>
      {helper && <span className="text-xs text-gray-500">{helper}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value === "" ? min : value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-full touch-manipulation accent-gray-900"
      />
      {(lowLabel || highLabel) && (
        <span className="flex items-center justify-between text-[11px] text-gray-400">
          <span>
            {min} · {lowLabel}
          </span>
          <span>
            {highLabel} · {max}
          </span>
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}
