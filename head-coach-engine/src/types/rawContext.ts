import type { DailyCheckin } from "./checkin.js";
import type { TrainingIntervention } from "./trainingIntervention.js";
import type {
  TrainingMode,
  UpcomingRace,
  WeeklyAvailability,
  LifeConstraints,
  TrainingBlockRef,
  CoachingProfile,
} from "./context.js";
import type { ActiveExperiment } from "./experiment.js";
import type { HealthFlag } from "./healthFlag.js";

/** Résumé d'une séance complétée, utilisé pour calculer recent_load (7 derniers jours). */
export interface CompletedSessionSummary {
  date: string; // ISO date
  intervention: TrainingIntervention;
}

/**
 * RawContext — entrée du moteur. Voir docs/04_DAILY_DECISION_ENGINE.md §1.
 *
 * `n_total_checkins` / `n_total_completed_sessions` sont des indicateurs
 * contextuels, PAS utilisés comme seuils de confidence en M1 (confidence
 * qualitative — voir docs/11_DECISION_LOG.md 2026-08-11).
 */
export interface RawContext {
  today: string; // ISO date (YYYY-MM-DD)
  checkin: DailyCheckin;
  planned_session: TrainingIntervention | null;
  planned_intent?: string;
  /**
   * V0.3_005A (NAL-001) — whether the athlete genuinely intends to perform
   * `planned_session` today (as opposed to a loosely-held/flexible plan).
   * Deliberately separate from `TrainingIntervention`: commitment is
   * planning metadata, not intervention semantics. Absent/false when no
   * planned session exists, or for legacy rows predating this field —
   * matches `planned_sessions.is_committed`'s `NOT NULL DEFAULT FALSE`.
   */
  planned_session_committed?: boolean;
  active_mode: TrainingMode;
  current_block?: TrainingBlockRef;
  upcoming_races: UpcomingRace[];
  recent_sessions: CompletedSessionSummary[];
  active_experiments: ActiveExperiment[];
  active_health_flags: HealthFlag[];
  availability?: WeeklyAvailability;
  life_constraints?: LifeConstraints;
  /** Personal coaching content (V0.3_004A) — absent means not yet configured for this athlete, never a fabricated default. */
  coaching_profile?: CoachingProfile;
  n_total_checkins: number;
  n_total_completed_sessions: number;
}
