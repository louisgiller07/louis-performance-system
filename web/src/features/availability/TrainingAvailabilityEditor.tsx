import type { AvailabilityActivity, AvailabilityDayOfWeek } from "../performanceSetup/availabilityRepo";
import { AVAILABILITY_COPY, PHYSICAL_OPTIONS, RIDING_OPTIONS, WEEK_ORDER, optionsWith, type DurationOption, type WeekAvailability } from "./trainingAvailability";

// BUG-V2-1 — one row per day, two durations: physical training and riding.
// Shared by the first run and the configuration page (same model, same save).

const DAY_FULL: Record<AvailabilityDayOfWeek, string> = { 1: "Lundi", 2: "Mardi", 3: "Mercredi", 4: "Jeudi", 5: "Vendredi", 6: "Samedi", 0: "Dimanche" };

function DurationSelect({ label, value, options, onChange }: { label: string; value: number; options: readonly DurationOption[]; onChange: (minutes: number) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`min-h-11 w-full rounded-lg border bg-card px-2 text-sm ${value > 0 ? "border-gold/60 text-ink" : "border-line text-muted"}`}
    >
      {optionsWith(options, value).map((option) => (
        <option key={option.minutes} value={option.minutes}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function TrainingAvailabilityEditor({ value, onChange }: { value: WeekAvailability; onChange: (next: WeekAvailability) => void }) {
  const set = (day: AvailabilityDayOfWeek, activity: AvailabilityActivity, minutes: number) => onChange({ ...value, [day]: { ...value[day], [activity]: minutes } });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)_minmax(0,7rem)] items-start gap-2 text-xs text-muted">
        <span />
        <span>
          <span className="block font-semibold text-ink">{AVAILABILITY_COPY.physical}</span>
          {AVAILABILITY_COPY.physicalHint}
        </span>
        <span>
          <span className="block font-semibold text-ink">{AVAILABILITY_COPY.riding}</span>
          {AVAILABILITY_COPY.ridingHint}
        </span>
      </div>
      {WEEK_ORDER.map((day) => (
        <div key={day} role="group" aria-label={DAY_FULL[day]} className="grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)_minmax(0,7rem)] items-center gap-2">
          <span className="text-sm text-ink">{DAY_FULL[day]}</span>
          <DurationSelect label={`${AVAILABILITY_COPY.physical} — ${DAY_FULL[day]}`} value={value[day].physical} options={PHYSICAL_OPTIONS} onChange={(m) => set(day, "physical", m)} />
          <DurationSelect label={`${AVAILABILITY_COPY.riding} — ${DAY_FULL[day]}`} value={value[day].riding} options={RIDING_OPTIONS} onChange={(m) => set(day, "riding", m)} />
        </div>
      ))}
    </div>
  );
}
