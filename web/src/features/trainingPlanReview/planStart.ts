import { addDays } from "../../lib/date";

// BUG-V2-3 — a new plan starts the day after its generation (server rule,
// head-coach-engine productCalendar.ts): the rider must read when, and never
// believe a session is expected today when the plan starts later.

const START_DAY_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long" });

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return START_DAY_FORMAT.format(new Date(y!, m! - 1, d!));
}

/** "aujourd'hui" / "demain, mardi 7 octobre" / "le jeudi 9 octobre" (relative to the rider's today). */
export function planStartPhrase(startDate: string, today: string): string {
  if (startDate === today) return "aujourd'hui";
  if (startDate === addDays(today, 1)) return `demain, ${dayLabel(startDate)}`;
  return `le ${dayLabel(startDate)}`;
}

/** "Ton programme commence demain, mardi 7 octobre." */
export function planStartLine(startDate: string, today: string): string {
  return `Ton programme commence ${planStartPhrase(startDate, today)}.`;
}

/** True when the plan has not started yet: nothing of it is expected today. */
export function planStartsLater(startDate: string, today: string): boolean {
  return startDate > today;
}
