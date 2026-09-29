import { Link } from "react-router-dom";
import type { RaceHorizon, WeekSummary } from "./todayContext";

// UX-04 — "Cette semaine": Monday → Sunday, what is planned, what was
// actually done, the race if one falls this week, and the objective as
// context. Counts are plain counts of existing rows — no score.
const DAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

function contextLabel(horizon: RaceHorizon | null, objective: string | null): string | null {
  if (horizon?.kind === "ongoing") return `En course · ${horizon.race.eventName}`;
  if (horizon?.kind === "countdown") return `Cap · ${horizon.race.eventName} · J-${horizon.days}`;
  if (horizon?.kind === "horizon") return `Cap · ${horizon.race.eventName}`;
  if (objective) return `Objectif · ${objective}`;
  return null;
}

export function WeekStrip({ week, horizon, objective }: { week: WeekSummary; horizon: RaceHorizon | null; objective: string | null }) {
  const context = contextLabel(horizon, objective);
  const plannedText = `${week.plannedCount} séance${week.plannedCount > 1 ? "s" : ""} prévue${week.plannedCount > 1 ? "s" : ""}`;
  const performedText = `${week.performedCount} réalisée${week.performedCount > 1 ? "s" : ""}`;

  return (
    <section aria-labelledby="week-title" className="ux-enter rounded-xl border border-line bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-title" className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          Cette semaine
        </h2>
        <p className="text-xs text-muted">
          {plannedText} · {performedText}
        </p>
      </div>
      {context && <p className="mt-2 text-sm text-ink/80">{context}</p>}

      <ol className="mt-4 grid grid-cols-7 gap-1.5">
        {week.days.map((day, index) => {
          const status = day.performed ? "Réalisée" : day.planned ? "Prévue" : "Libre";
          return (
            <li
              key={day.date}
              className={`flex flex-col items-center gap-1.5 rounded-md border px-0.5 py-2.5 ${day.isToday ? "border-gold/70 bg-gold/8" : "border-line"}`}
              aria-label={`${DAY_LETTERS[index]} ${day.date} : ${day.race ? `course ${day.race}` : (day.planned ?? "libre")}, ${status.toLowerCase()}`}
            >
              <span className={`text-[0.65rem] font-semibold uppercase ${day.isToday ? "text-gold" : "text-muted"}`}>{DAY_LETTERS[index]}</span>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[0.7rem] ${
                  day.race
                    ? "bg-gold text-bg"
                    : day.performed
                      ? "border border-gold text-gold"
                      : day.planned
                        ? day.isPast
                          ? "border border-line text-muted"
                          : "border border-ink/40 text-ink"
                        : "text-line"
                }`}
                aria-hidden="true"
              >
                {day.race ? "⚑" : day.performed ? "✓" : day.planned ? "•" : "·"}
              </span>
              <span className={`w-full truncate text-center text-[0.62rem] ${day.planned || day.race ? "text-ink/75" : "text-muted/60"}`}>
                {day.race ? "Course" : (day.planned ?? "—")}
              </span>
            </li>
          );
        })}
      </ol>

      <Link to="/training-plan" className="ux-press mt-4 inline-flex min-h-10 items-center text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
        Voir le programme →
      </Link>
    </section>
  );
}
