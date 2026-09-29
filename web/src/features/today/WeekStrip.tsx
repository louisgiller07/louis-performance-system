import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDuration } from "../dailyPlan/durationLabels";
import type { WeekDay, WeekSummary } from "./todayContext";

// UX-04 / UX-05 — "Cette semaine": Monday → Sunday as a training notebook,
// not a tracker. Plain counts of existing rows (planned, performed), one
// symbol per day (✓ réalisée · ● aujourd'hui · ○ prévue · ⚑ course), and the
// selected day spelled out below — today by default, any day on tap. No
// chart, gauge, score or percentage.
const DAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

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

/** Singular only for exactly one ("1 séance prévue", "0 réalisées", "5 séances prévues"). */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function WeekStrip({ week }: { week: WeekSummary }) {
  const todayIndex = Math.max(0, week.days.findIndex((day) => day.isToday));
  const [selected, setSelected] = useState(todayIndex);
  const day = week.days[selected] ?? week.days[todayIndex]!;

  return (
    <section aria-labelledby="week-title" className="ux-enter rounded-xl border border-line bg-card p-5">
      <h2 id="week-title" className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        Cette semaine
      </h2>
      <div className="mt-3 flex items-baseline gap-5">
        <p className="font-display text-2xl font-extrabold uppercase leading-none text-ink">{plural(week.plannedCount, "séance prévue", "séances prévues")}</p>
        <p className="font-display text-2xl font-extrabold uppercase leading-none text-gold">{plural(week.performedCount, "réalisée", "réalisées")}</p>
      </div>

      <div role="group" aria-label="Jours de la semaine" className="mt-5 grid grid-cols-7 gap-1">
        {week.days.map((entry, index) => {
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
                className={`text-lg leading-none ${
                  entry.race || entry.isToday || entry.performed ? "text-gold" : entry.planned ? "text-ink/80" : "text-muted/50"
                }`}
                aria-hidden="true"
              >
                {symbol(entry)}
              </span>
            </button>
          );
        })}
      </div>

      {/* The selected day, spelled out (today by default). */}
      <div key={day.date} className="ux-enter mt-4 border-t border-line pt-4" aria-live="polite">
        <p className="text-sm text-muted">{day.isToday ? "Aujourd'hui" : DAY_NAMES[week.days.indexOf(day)]}</p>
        {day.race ? (
          <p className="mt-1 font-display text-2xl font-extrabold uppercase leading-tight text-gold">{day.race}</p>
        ) : (
          <p className="mt-1 font-display text-2xl font-extrabold uppercase leading-tight text-ink">{day.plannedLabel ?? "Libre"}</p>
        )}
        <p className="mt-1 text-sm text-ink/75">
          {[day.plannedDurationMin !== null ? formatDuration(day.plannedDurationMin) : null, day.race ? "Course" : statusLabel(day)].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[0.68rem] text-muted">✓ réalisée · ● aujourd'hui · ○ prévue · ⚑ course</p>
        <Link to="/training-plan" className="ux-press shrink-0 text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
          Programme →
        </Link>
      </div>
    </section>
  );
}
