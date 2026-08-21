import type { CompletedSessionSource, DailyCheckinSource, DecisionSource, HealthFlagSource } from "../types/sources.js";
import type { AthleteDay, CompletedSessionOnDay } from "./types.js";
import { resolveLink } from "./linking.js";
import { sortedBy } from "./ordering.js";
import { isFlagActiveOnDay } from "./healthContext.js";

/** Assembles one AthleteDay from the pre-partitioned source pools for a single calendar `date`. */
export function assembleDay(
  date: string,
  checkinsByDate: ReadonlyMap<string, readonly DailyCheckinSource[]>,
  decisionsByDate: ReadonlyMap<string, readonly DecisionSource[]>,
  completedSessionsByDate: ReadonlyMap<string, readonly CompletedSessionSource[]>,
  decisionsById: ReadonlyMap<string, DecisionSource>,
  healthFlags: readonly HealthFlagSource[]
): AthleteDay {
  const checkins = sortedBy(checkinsByDate.get(date) ?? [], (c) => c.submittedAt, (c) => c.id);
  const decisions = sortedBy(decisionsByDate.get(date) ?? [], (d) => d.computedAt, (d) => d.id);

  const completedSessions: CompletedSessionOnDay[] = sortedBy(
    completedSessionsByDate.get(date) ?? [],
    (s) => s.id
  ).map((completedSession) => ({
    completedSession,
    linkedDecision: resolveLink(completedSession.decisionId, decisionsById),
  }));

  const healthEventsCreated = sortedBy(
    healthFlags.filter((f) => f.flagDate === date),
    (f) => f.id
  );
  const healthEventsResolved = sortedBy(
    healthFlags.filter((f) => f.resolvedAt === date),
    (f) => f.id
  );
  const activeHealthContext = sortedBy(
    healthFlags.filter((f) => isFlagActiveOnDay(f, date)),
    (f) => f.flagDate,
    (f) => f.id
  );

  return { date, checkins, decisions, completedSessions, healthEventsCreated, healthEventsResolved, activeHealthContext };
}
