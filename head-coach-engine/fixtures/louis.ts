import type { DailyCheckin } from "../src/types/checkin.js";
import type { RawContext } from "../src/types/rawContext.js";
import type { UpcomingRace } from "../src/types/context.js";

/**
 * Fixtures Louis — basées sur docs/02_ATHLETE_PROFILE.md §11 (calendrier
 * compétitif réel 2026) et §4/§6 (baselines réelles). Aucune donnée
 * inventée. Voir docs/06_ARCHITECTURE.md §Fixtures.
 */
export const RACE_CALENDAR: Record<"LA_BERRA" | "VERBIER" | "ST_LUC" | "BELLWALD", UpcomingRace> = {
  LA_BERRA: {
    event_name: "La Berra — Hot Trail Series",
    event_start: "2026-08-15",
    event_end: "2026-08-16",
    priority: "A_PLUS",
    race_format: "HOT_TRAIL_2DAY",
  },
  VERBIER: {
    event_name: "Verbier — iXS European Cup",
    event_start: "2026-09-11",
    event_end: "2026-09-13",
    priority: "A_PLUS",
    race_format: "IXS_3DAY",
  },
  ST_LUC: {
    event_name: "St-Luc — Hot Trail Series",
    event_start: "2026-09-26",
    event_end: "2026-09-27",
    priority: "A",
    race_format: "HOT_TRAIL_2DAY",
  },
  BELLWALD: {
    event_name: "Bellwald — iXS DHC",
    event_start: "2026-10-02",
    event_end: "2026-10-04",
    priority: "A",
    race_format: "IXS_3DAY",
  },
};

/** Checkin "bon jour" — toutes dimensions attendues GREEN. */
export function baseCheckin(overrides: Partial<DailyCheckin> = {}): DailyCheckin {
  return {
    date: "2026-08-24",
    sleep_hours: 8,
    sleep_quality: 8,
    sleep_wake_ups: 0,
    energy: 8,
    work_stress: 3,
    motivation: 8,
    leg_fatigue: 2,
    grip_fatigue: 2,
    pain: false,
    pain_intensity: 0,
    pain_new: false,
    pain_traumatic: false,
    pain_function_loss: false,
    pain_getting_worse: false,
    suspected_concussion: false,
    fever_or_illness: false,
    ...overrides,
  };
}

/**
 * Contexte "jour neutre" — hors fenêtre de toute course (2026-08-24 est à
 * plus de 7 jours de Verbier et à plus de 2 jours après la fin de La Berra),
 * mode RACE_CLUSTER (bloc réel en cours au 13.08.2026 — docs/02_ATHLETE_PROFILE.md §11.3).
 */
type RawContextOverrides = Omit<Partial<RawContext>, "checkin"> & { checkin?: Partial<DailyCheckin> };

export function baseRawContext(overrides: RawContextOverrides = {}): RawContext {
  const { checkin: checkinOverrides, ...rest } = overrides;
  return {
    today: "2026-08-24",
    checkin: baseCheckin(checkinOverrides),
    planned_session: null,
    active_mode: "RACE_CLUSTER",
    upcoming_races: Object.values(RACE_CALENDAR),
    recent_sessions: [],
    active_experiments: [],
    active_health_flags: [],
    n_total_checkins: 0,
    n_total_completed_sessions: 0,
    ...rest,
  };
}
