import type { DailyCheckin } from "./checkin.js";
import type { TrainingIntervention, TrainingInterventionKind } from "./trainingIntervention.js";
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

/**
 * V0.3_007B — miroir de `public.completion_status` (DB enum). `done`/
 * `partial`/`replaced` représentent une charge d'entraînement réellement
 * survenue (au moins en partie) ; `skipped` signifie qu'aucune activité n'a
 * eu lieu et ne doit jamais compter comme charge — voir recentLoad.ts.
 */
export type CompletionStatus = "done" | "partial" | "skipped" | "replaced";

/** Résumé d'une séance complétée, utilisé pour calculer recent_load (7 derniers jours). */
export interface CompletedSessionSummary {
  date: string; // ISO date
  intervention: TrainingIntervention;
  completion_status: CompletionStatus;
}

/**
 * V0.3_008A — contexte factuel de récupération J-1, jamais une dimension
 * notée ni un signal d'arbitrage. Présent uniquement quand la session
 * complétée de la veille EXACTE (jamais "la plus récente") porte
 * `change_reason = "fatigue_control"` et `completion_status` ∈
 * `{partial, replaced, skipped}` — `done` ne peut structurellement pas
 * porter de `change_reason` (contrat V0.3_007C). Toute autre raison
 * (`pain`, `weather_terrain`, etc.) reste inerte en V0.3_008A : ce champ
 * est alors absent (`undefined`), jamais `null` fabriqué. `post_leg_fatigue`/
 * `post_grip_fatigue` sont les valeurs brutes déclarées par l'athlète,
 * jamais agrégées/moyennées/converties en charge — voir recentLoad.ts pour
 * la charge, un concept strictement séparé. Ce type est aussi utilisé tel
 * quel comme instantané persisté dans `DailyPlan.recent_recovery_context`
 * (voir dailyPlan.ts) — les deux usages partagent la même forme par
 * construction, jamais deux structures qui pourraient diverger.
 */
export interface RecentRecoveryContext {
  session_date: string; // ISO date — toujours today - 1 jour calendaire exact
  completion_status: "partial" | "replaced" | "skipped";
  change_reason: "fatigue_control";
  post_leg_fatigue: number | null;
  post_grip_fatigue: number | null;
}

/**
 * V0.3_008B — Technical Continuity V1. Le fait technique valide le plus
 * récent dans une fenêtre strictement inter-jours `D-14 <= session_date <
 * D` (jour même D et futur exclus — voir docs/11_DECISION_LOG.md
 * V0.3_008B, PROVISIONAL PRODUCT-FRESHNESS CONSTANT, non calibré).
 *
 * Lien exact uniquement : `source_decision_id` trace
 * `completed_sessions.decision_id` → `decisions.id`, jamais une inférence
 * par date/dernière décision du jour/similarité. `kind` est le kind
 * RÉELLEMENT PERFORMÉ (`completed_sessions.intervention.kind`), jamais
 * celui de la prescription. `execution_task` vient de la décision liée
 * (`decisions.daily_plan.dh_or_technical.execution_task`), jamais recalculé.
 *
 * `age_days` est calculé à chaque construction de `RawContext` (today −
 * session_date) — une pure valeur d'exécution, jamais persistée (voir
 * `DailyPlan.dh_or_technical.prior_task_reference` dans dailyPlan.ts, qui
 * omet délibérément ce champ : un compteur de jours figé deviendrait
 * trompeur relu des semaines plus tard).
 */
export interface RecentTechnicalContext {
  source_decision_id: string;
  session_date: string; // ISO date, D-14 <= session_date < today
  kind: TrainingInterventionKind;
  execution_task: string;
  technical_outcome: "yes" | "partial" | "no";
  age_days: number;
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
  /** V0.3_008A. Absent when no eligible J-1 fatigue_control session exists — see RecentRecoveryContext's own doc. */
  recent_recovery_context?: RecentRecoveryContext;
  /** V0.3_008B. Absent when no valid candidate exists in the D-14..D-1 window — see RecentTechnicalContext's own doc. */
  recent_technical_context?: RecentTechnicalContext;
  active_experiments: ActiveExperiment[];
  active_health_flags: HealthFlag[];
  availability?: WeeklyAvailability;
  life_constraints?: LifeConstraints;
  /** Personal coaching content (V0.3_004A) — absent means not yet configured for this athlete, never a fabricated default. */
  coaching_profile?: CoachingProfile;
  n_total_checkins: number;
  n_total_completed_sessions: number;
}
