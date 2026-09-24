// V0.3_008A — Athlete Onboarding V1 (Niveau 1). Same discipline as
// athleteBootstrapRepo.ts: the authenticated user's own Supabase client
// only, RLS (athlete_onboarding_profiles_own_data /
// athletes_own_data) is the sole authority on which athlete_id a write can
// target — never a service/secret key, never an Edge Function.
import { supabase } from "../../lib/supabase";
import {
  DISCIPLINE_OPTIONS,
  COMPETITION_LEVEL_OPTIONS,
  PRIMARY_GOAL_OPTIONS,
  WEEKLY_TRAINING_HOURS_OPTIONS,
  RIDING_DAY_OPTIONS,
  type Discipline,
  type CompetitionLevel,
  type PrimaryGoal,
  type WeeklyTrainingHours,
  type RidingDay,
} from "./onboardingOptions";

export class AthleteOnboardingError extends Error {
  constructor() {
    super("Impossible d'enregistrer ta réponse. Réessaie dans un instant.");
    this.name = "AthleteOnboardingError";
  }
}

export interface OnboardingAnswers {
  discipline: Discipline | null;
  competitionLevel: CompetitionLevel | null;
  primaryGoal: PrimaryGoal | null;
  weeklyTrainingHours: WeeklyTrainingHours | null;
  preferredRidingDays: RidingDay[];
}

/**
 * `athletes.discipline` predates this feature (NOT NULL, DB default
 * 'DH_MTB' — legacy mono-athlete value, see migration baseline) — it is
 * never null, so "has the athlete answered the discipline step" can't be a
 * null check. Membership in the current closed option list is the correct
 * signal: the untouched legacy default is never itself one of the four
 * options, so it correctly reads as "not yet answered" until the athlete
 * actually picks one. The same "membership, not just non-null" reasoning
 * applies to the other three fields below too — a previously-saved value
 * could in principle no longer match a since-renamed option label.
 */
function asOption<T extends string>(options: readonly T[], value: string | null | undefined): T | null {
  return (options as readonly string[]).includes(value ?? "") ? (value as T) : null;
}

/**
 * Reads back whatever has already been saved — used on mount to resume the
 * wizard at the first unanswered step after a refresh, never to validate
 * against the current option lists (an option's label could change later
 * without migrating already-saved rows; that's out of scope here).
 *
 * No `athleteId` parameter and no `.eq(...)` filter, on either query — same
 * RLS-only-scoping idiom as AuthContext.ts's resolveAthlete(): RLS already
 * restricts each table to at most the caller's own single row (`athletes`)
 * or single onboarding row (`athlete_onboarding_profiles`, PK'd on
 * athlete_id), so indexing `data?.[0]` is exactly as scoped as an explicit
 * filter would be.
 */
export async function loadOnboardingAnswers(): Promise<OnboardingAnswers> {
  const [athleteResult, profileResult] = await Promise.all([
    supabase.from("athletes").select("discipline"),
    supabase
      .from("athlete_onboarding_profiles")
      .select("competition_level, primary_goal, weekly_training_hours, preferred_riding_days"),
  ]);

  if (athleteResult.error) {
    console.error("athleteOnboardingRepo.loadOnboardingAnswers: athletes read failed", athleteResult.error.code);
    throw new AthleteOnboardingError();
  }
  if (profileResult.error) {
    console.error("athleteOnboardingRepo.loadOnboardingAnswers: profile read failed", profileResult.error.code);
    throw new AthleteOnboardingError();
  }

  const profile = profileResult.data?.[0];
  const ridingDays = profile?.preferred_riding_days;
  return {
    discipline: asOption(DISCIPLINE_OPTIONS, athleteResult.data?.[0]?.discipline),
    competitionLevel: asOption(COMPETITION_LEVEL_OPTIONS, profile?.competition_level),
    primaryGoal: asOption(PRIMARY_GOAL_OPTIONS, profile?.primary_goal),
    weeklyTrainingHours: asOption(WEEKLY_TRAINING_HOURS_OPTIONS, profile?.weekly_training_hours),
    preferredRidingDays: Array.isArray(ridingDays)
      ? ridingDays.filter((day): day is RidingDay => (RIDING_DAY_OPTIONS as readonly string[]).includes(day))
      : [],
  };
}

export async function saveDiscipline(athleteId: string, discipline: Discipline): Promise<void> {
  const { error } = await supabase.from("athletes").update({ discipline }).eq("id", athleteId);
  if (error) {
    console.error("athleteOnboardingRepo.saveDiscipline failed", error.code);
    throw new AthleteOnboardingError();
  }
}

async function upsertOnboardingProfile(athleteId: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("athlete_onboarding_profiles")
    .upsert({ athlete_id: athleteId, ...fields }, { onConflict: "athlete_id" });
  if (error) {
    console.error("athleteOnboardingRepo.upsertOnboardingProfile failed", error.code);
    throw new AthleteOnboardingError();
  }
}

export async function saveCompetitionLevel(athleteId: string, competitionLevel: CompetitionLevel): Promise<void> {
  await upsertOnboardingProfile(athleteId, { competition_level: competitionLevel });
}

export async function savePrimaryGoal(athleteId: string, primaryGoal: PrimaryGoal): Promise<void> {
  await upsertOnboardingProfile(athleteId, { primary_goal: primaryGoal });
}

export async function saveWeeklyTrainingHours(athleteId: string, weeklyTrainingHours: WeeklyTrainingHours): Promise<void> {
  await upsertOnboardingProfile(athleteId, { weekly_training_hours: weeklyTrainingHours });
}

export interface CompletionAnswers {
  competitionLevel: CompetitionLevel;
  primaryGoal: PrimaryGoal;
  weeklyTrainingHours: WeeklyTrainingHours;
  preferredRidingDays: RidingDay[];
  /** The privacy notice version the athlete explicitly accepted (checkbox). */
  privacyNoticeVersion: string;
}

/**
 * The final step. Re-sends all four Niveau 1 answers together, not just
 * `preferred_riding_days` — the DB's CHECK constraint
 * (athlete_onboarding_profiles_completed_requires_answers) requires all four
 * to be non-null/non-empty in the SAME row state that sets
 * `onboarding_completed_at`, and silently rejects the write (23514) if any
 * one of them is missing. Steps 2-4's own per-step upserts normally already
 * persisted competition_level/primary_goal/weekly_training_hours by the time
 * this runs, but re-sending them here makes the completion write
 * self-sufficient rather than depending on that having actually landed —
 * this is the fix for the reported bug where riding days/completion never
 * persisted (a silent check-constraint rejection, not a client-state bug).
 */
export async function completeOnboarding(athleteId: string, answers: CompletionAnswers): Promise<void> {
  await upsertOnboardingProfile(athleteId, {
    competition_level: answers.competitionLevel,
    primary_goal: answers.primaryGoal,
    weekly_training_hours: answers.weeklyTrainingHours,
    preferred_riding_days: answers.preferredRidingDays,
    onboarding_completed_at: new Date().toISOString(),
    // Explicit health-data consent (checkbox) — required by the DB for completion;
    // health_data_consent_at is set server-side by a trigger.
    privacy_notice_version: answers.privacyNoticeVersion,
  });
}
