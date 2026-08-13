import type { EventContext, RacePhase, UpcomingRace } from "../types/context.js";
import { daysBetween } from "./dateUtils.js";
import { PROVISIONAL_THRESHOLDS } from "./provisionalThresholds.js";

type Candidate = {
  race: UpcomingRace;
  kind: "in_progress" | "pre_event" | "post_event";
  daysToStart: number; // event_start - today
  daysToEnd: number; // event_end - today
  daysSinceEnd: number; // today - event_end
};

function classify(today: string, race: UpcomingRace): Candidate | null {
  const t = PROVISIONAL_THRESHOLDS.event;
  const daysToStart = daysBetween(today, race.event_start);
  const daysToEnd = daysBetween(today, race.event_end);
  const daysSinceEnd = -daysToEnd;

  if (daysToStart <= 0 && daysToEnd >= 0) {
    return { race, kind: "in_progress", daysToStart, daysToEnd, daysSinceEnd };
  }
  if (daysToStart > 0 && daysToStart <= t.preEventWindowDays) {
    return { race, kind: "pre_event", daysToStart, daysToEnd, daysSinceEnd };
  }
  if (daysToEnd < 0 && daysSinceEnd <= t.postEventWindowDays) {
    return { race, kind: "post_event", daysToStart, daysToEnd, daysSinceEnd };
  }
  return null;
}

const KIND_PRIORITY: Record<Candidate["kind"], number> = {
  in_progress: 0,
  pre_event: 1,
  post_event: 2,
};

/**
 * Sélectionne la course la plus pertinente à `today` parmi `races`, selon la
 * fenêtre de pertinence canonique (docs/04_DAILY_DECISION_ENGINE.md §3) :
 * pré-event (days_to_event <= 7), en cours, ou post-event utile
 * (days_since_event_end <= 2). Retourne `null` si aucune course pertinente.
 */
export function computeEventContext(today: string, races: UpcomingRace[]): EventContext | null {
  const candidates = races
    .map((r) => classify(today, r))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => {
      const p = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
      if (p !== 0) return p;
      if (a.kind === "post_event") return a.daysSinceEnd - b.daysSinceEnd;
      return a.daysToStart - b.daysToStart;
    });

  const best = candidates[0];
  if (!best) return null;

  const days_from_event = daysBetween(best.race.event_start, today);

  let phase: RacePhase;
  let event_day: number | null;
  if (best.kind === "in_progress") {
    phase = best.race.race_phase ?? "RACE_DAY_GENERIC";
    event_day = days_from_event;
  } else if (best.kind === "pre_event") {
    phase = "PRE_EVENT";
    event_day = null;
  } else {
    phase = "POST_EVENT";
    event_day = null;
  }

  return {
    race: best.race,
    days_to_event: best.daysToStart,
    days_from_event,
    event_day,
    in_progress: best.kind === "in_progress",
    phase,
  };
}

/**
 * Détecte une incohérence STRUCTURELLE réelle des données de calendrier :
 * deux courses marquées "en cours" le même jour (impossible pour un seul
 * athlète). Ce n'est PAS une contradiction entre dimensions valides — voir
 * docs/11_DECISION_LOG.md 2026-08-13 (round 2). Utilisé par buildDailyPlan() comme
 * unique source de confidence LOW en M1 (donnée structurellement invalide,
 * contexte non résolvable de façon déterministe et fiable).
 */
export function hasOverlappingInProgressRaces(today: string, races: UpcomingRace[]): boolean {
  const inProgressCount = races
    .map((r) => classify(today, r))
    .filter((c): c is Candidate => c !== null && c.kind === "in_progress").length;
  return inProgressCount > 1;
}
