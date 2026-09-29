import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { historyZones, type HistoryDay } from "./historyDays";
import { HistoryDayCard, HistoryDayRow } from "./HistoryDayCard";

// UX-07 — the journey in three zones: today, this calendar week (Monday →
// Sunday, like Today and Programme) and older days grouped by month.
const MONTH_FORMAT = new Intl.DateTimeFormat("fr-CH", { month: "long" });
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric" });

function monthLabel(key: string, today: string): string {
  const [y, m] = key.split("-").map(Number);
  const label = (key.slice(0, 4) === today.slice(0, 4) ? MONTH_FORMAT : MONTH_YEAR_FORMAT).format(new Date(y!, m! - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Zone({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export function HistoryTimeline({ days, today }: { days: HistoryDay[]; today: string }) {
  const zones = historyZones(days, today);
  return (
    <>
      <Zone id="history-today" title="Aujourd'hui">
        {zones.today ? (
          <HistoryDayCard day={zones.today} today={today} />
        ) : (
          <div className="rounded-xl border border-line bg-card p-5">
            <p className="text-sm text-ink/80">Ta journée n'a pas encore été analysée.</p>
            <Link to="/today" className="ux-press mt-2 inline-flex min-h-11 items-center text-sm text-gold underline-offset-4 hover:underline">
              Faire mon check-in →
            </Link>
          </div>
        )}
      </Zone>

      {zones.week.length > 0 && (
        <Zone id="history-week" title="Cette semaine">
          {zones.week.map((day) => (
            <HistoryDayCard key={day.date} day={day} today={today} />
          ))}
        </Zone>
      )}

      {zones.older.length > 0 && (
        <Zone id="history-older" title="Plus ancien">
          {zones.older.map((month) => (
            <div key={month.key} className="rounded-xl border border-line bg-card px-4 pt-3">
              <h3 className="font-display text-lg font-extrabold uppercase text-ink/90">{monthLabel(month.key, today)}</h3>
              <ul className="flex flex-col">
                {month.days.map((day) => (
                  <HistoryDayRow key={day.date} day={day} today={today} />
                ))}
              </ul>
            </div>
          ))}
        </Zone>
      )}
    </>
  );
}
