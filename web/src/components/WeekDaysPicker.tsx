import { useState } from "react";
import { formatDuration } from "../features/dailyPlan/durationLabels";
import type { WeekDay } from "../features/today/todayContext";

// UX-05 / UX-06 — the shared Monday → Sunday strip (Today's "Cette semaine"
// and Programme's week timeline): one symbol per day (✓ réalisée ·
// ● aujourd'hui · ○ prévue · ⚑ course) and the selected day spelled out
// below — today by default (or `initialIndex`), any day on tap. Pure
// presentation of the days it is given.
const DAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_NAMES =["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function symbol(day: WeekDay): string {
  if (day.race) return "⚑";
  if (day.performed) return "✓";
  if (day.isToday) return "●";
  if (day.planned) return "○";
  return "·";
}

function statusLabel(day: WeekDay): string {
  if (day.performed) return "Réalisée";
  if (day.isToday && day.planned) return "Aujourd'hui";
  if (day.planned) return day.isPast ? "Prévue, non enregistrée" : "Prévue";
  return "Aucune séance prévue";
}

export function WeekDaysPicker({ days, initialIndex }: { days: WeekDay[]; initialIndex?: number }) {
  const todayIndex = days.findIndex((day) => day.isToday);
  const [selected, setSelected] = useState(initialIndex ?? Math.max(0, todayIndex));
  const day = days[selected] ?? days[0]!;

  return (
    <>
      <div role="group" aria-label="Jours de la semaine" className="mt-5 grid grid-cols-7 gap-1">
        {days.map((entry, index) => {
          const isSelected = index === selected;
          return (
            <button
              key={entry.date}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${DAY_NAMES[index]} : ${entry.race ? `course ${entry.race}` : (entry.plannedLabel ?? "aucune séance prévue")}, ${statusLabel(entry).toLowerCase()}`}
              onClick={() => setSelected(index)}
              className={`ux-press flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-md border ${
                isSelected ? "border-gold/70 bg-gold/8" : "border-transparent hover:border-line"
              }`}
            >
              <span className={`text-[0.7rem] font-semibold uppercase ${entry.isToday ? "text-gold" : "text-muted"}`}>{DAY_LETTERS[index]}</span>
              <span
                className={`text-lg leading-none ${entry.race || entry.isToday || entry.performed ? "text-gold" : entry.planned ? "text-ink/80" : "text-muted/50"}`}
                aria-hidden="true"
              >
                {symbol(entry)}
              </span>
            </button>
          );
        })}
      </div>

      {/* The selected day, spelled out. */}
      <div key={day.date} className="ux-enter mt-4 border-t border-line pt-4" aria-live="polite">
        <p className="text-sm text-muted">{day.isToday ? "Aujourd'hui" : DAY_NAMES[days.indexOf(day)]}</p>
        {day.race ? (
          <p className="mt-1 font-display text-2xl font-extrabold uppercase leading-tight text-gold">{day.race}</p>
        ) : (
          <p className="mt-1 font-display text-2xl font-extrabold uppercase leading-tight text-ink">{day.plannedLabel ?? "Libre"}</p>
        )}
        <p className="mt-1 text-sm text-ink/75">
          {[day.plannedDurationMin !== null ? formatDuration(day.plannedDurationMin) : null, day.race ? "Course" : statusLabel(day)].filter(Boolean).join(" · ")}
        </p>
      </div>
    </>
  );
}
