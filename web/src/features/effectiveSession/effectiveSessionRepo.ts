// A07 — the single loader of the effective-session read model: three reads in
// parallel (decisions, V2 executions, legacy debriefs of the dates), RLS-scoped,
// never a write. The planned sessions come from the caller (Today: planned_sessions;
// Programme: the plan's generated sessions) — never re-read here.
import { useEffect, useState } from "react";
import { loadCompletedSessionsForDates, loadDecisionsForDates, loadExecutionsForDates } from "../history/historyRepo";
import { effectiveDays, type EffectiveDay, type EffectiveSources, type PlannedDaySession } from "./effectiveDay";

export async function loadEffectiveSources(athleteId: string, dates: readonly string[], planned: readonly PlannedDaySession[]): Promise<EffectiveSources> {
  const [decisions, executions, legacy] = await Promise.all([
    loadDecisionsForDates(athleteId, dates),
    loadExecutionsForDates(athleteId, dates),
    loadCompletedSessionsForDates(athleteId, [...dates]),
  ]);
  return { decisions, executions, legacy, planned };
}

export async function loadEffectiveDays(athleteId: string, dates: readonly string[], planned: readonly PlannedDaySession[]): Promise<EffectiveDay[]> {
  return effectiveDays(dates, await loadEffectiveSources(athleteId, dates, planned));
}

/** `null` while loading (or on a read error: the caller keeps its own fallback). `refreshKey` reloads. */
export function useEffectiveDays(athleteId: string | null | undefined, dates: readonly string[], planned: readonly PlannedDaySession[], refreshKey = 0): EffectiveDay[] | null {
  const [days, setDays] = useState<EffectiveDay[] | null>(null);
  const key = `${dates.join(",")}|${planned.map((p) => `${p.date}:${p.session.kind}:${p.session.duration_min ?? ""}`).join(",")}`;
  useEffect(() => {
    if (!athleteId || dates.length === 0) return;
    let active = true;
    loadEffectiveDays(athleteId, dates, planned).then(
      (loaded) => active && setDays(loaded),
      () => active && setDays(null)
    );
    return () => {
      active = false;
    };
    // `key` captures dates and planned sessions by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, key, refreshKey]);
  return days;
}
