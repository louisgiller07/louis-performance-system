import { AVAILABLE_TIME_PRESETS } from "./checkinTypes";

interface AvailableTimeChoiceProps {
  /** null: « Comme prévu »; "" : « Autre durée » chosen, not typed yet; a number: minutes. */
  value: number | "" | null;
  onChange: (value: number | "" | null) => void;
  error?: string;
}

const chip = (selected: boolean) =>
  `ux-press min-h-12 rounded border px-3 py-2 text-sm font-semibold tracking-[0.06em] ${
    selected ? "border-gold bg-gold text-bg" : "border-line bg-transparent text-ink/70 hover:border-gold/50"
  }`;

/**
 * A10 — « Combien de temps as-tu aujourd'hui ? » in one tap: « Comme prévu »
 * (pre-selected, no constraint), a few common durations, or another
 * duration typed in minutes. The plan itself is unchanged: only today's
 * session is fitted into this time.
 */
export function AvailableTimeChoice({ value, onChange, error }: AvailableTimeChoiceProps) {
  const isPreset = typeof value === "number" && (AVAILABLE_TIME_PRESETS as readonly number[]).includes(value);
  const isOther = value === "" || (typeof value === "number" && !isPreset);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-xs font-semibold uppercase tracking-widest text-muted">Temps disponible</legend>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Temps disponible aujourd'hui">
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={`${chip(value === null)} col-span-3`}>
          Comme prévu
        </button>
        {AVAILABLE_TIME_PRESETS.map((minutes) => (
          <button key={minutes} type="button" aria-pressed={value === minutes} onClick={() => onChange(minutes)} className={chip(value === minutes)}>
            {minutes} min
          </button>
        ))}
        <button type="button" aria-pressed={isOther} onClick={() => onChange(isOther ? value : "")} className={`${chip(isOther)} col-span-2`}>
          Autre durée
        </button>
      </div>
      {isOther && (
        <label className="flex flex-col gap-1 text-sm text-ink/80">
          Minutes disponibles
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            value={value}
            onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
            className="rounded border border-white/10 bg-transparent px-3 py-3 text-base text-ink"
          />
        </label>
      )}
      <p className="text-xs text-muted">Ton plan ne change pas : seule la séance du jour est adaptée pour tenir dans ce temps.</p>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </fieldset>
  );
}
