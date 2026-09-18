/**
 * V0.3_008C — Connect Athlete Onboarding to Coaching Context. Read-only
 * bridge between the web onboarding feature (`web/src/features/
 * athleteOnboarding/`, tables `athletes.discipline` + `public.
 * athlete_onboarding_profiles`) and the coaching layer.
 *
 * This is intentionally NOT wired into `RawContext`/`buildDailyPlan.ts`.
 * `src/{types,engine,rules,domains,mapping}` are frozen (M1 APPROVED
 * 2026-08-13, docs/06_ARCHITECTURE.md) — making any of this data actually
 * influence a decision means adding a field to `RawContext` and reading it
 * in `buildDailyPlan.ts`, which is a real engine-contract change requiring
 * its own separate, explicit architect decision (docs/11_DECISION_LOG.md,
 * V0.3_008C entry). This resolver only makes the data *available*, in a
 * normalized, tested shape, so that future decision doesn't have to start
 * from raw table reads. No field here is consumed by any coaching rule
 * today, and this file changes nothing under `src/{types,engine,rules,
 * domains,mapping}`.
 *
 * `discipline`/`competition_level`/`primary_goal`/`weekly_training_hours`
 * stay plain, un-enum'd strings — same deliberate choice already made for
 * `athlete_coaching_profiles` (V0.3_004A): the closed option lists live in
 * the frontend (web/src/features/athleteOnboarding/onboardingOptions.ts)
 * and can evolve their wording without a migration or an engine change.
 * Values are passed through exactly as the athlete declared them (e.g.
 * "Downhill", "World Cup") — no casing/vocabulary transform is invented
 * here, since only the actual future engine consumer can define the
 * vocabulary it needs; inventing one now, with nothing to validate it
 * against, would itself be a form of fake personalization.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

/** Discipline values an athlete can actually choose during onboarding (web/src/features/athleteOnboarding/onboardingOptions.ts). Deliberately duplicated here rather than imported across the web/head-coach-engine package boundary — same precedent as supabase/functions/completed-session's own duplicated vocabulary copy. */
const ONBOARDING_DISCIPLINE_OPTIONS = ["Downhill", "Enduro", "Freeride", "Other"] as const;

interface AthleteRawRow {
  discipline: string | null;
}

interface OnboardingProfileRawRow {
  competition_level: string | null;
  primary_goal: string | null;
  weekly_training_hours: string | null;
  preferred_riding_days: string[] | null;
}

/**
 * Normalized athlete coaching context. Every field but `athlete_id` is
 * optional: absence always means "the athlete has not declared this yet",
 * never a fabricated/generic value. No field is currently read by
 * buildDailyPlan.ts or any domain — see this file's own top-of-file note.
 */
export interface AthleteCoachingContext {
  athlete_id: string;
  discipline?: string;
  competition_level?: string;
  primary_goal?: string;
  weekly_training_hours?: string;
  preferred_riding_days?: string[];
}

/**
 * `athletes.discipline` is NOT NULL with a legacy mono-athlete DB default
 * ('DH_MTB', see supabase/migrations baseline) — it is never null, so it
 * can't be read as "configured vs not" by nullness. Membership in the
 * closed onboarding option list is the correct signal: the untouched
 * legacy default is never itself one of the real options, so an athlete
 * who never went through onboarding correctly reads as "no discipline
 * declared" rather than surfacing 'DH_MTB' as if it were real input.
 */
function normalizeDiscipline(value: string | null): string | undefined {
  return value !== null && (ONBOARDING_DISCIPLINE_OPTIONS as readonly string[]).includes(value) ? value : undefined;
}

/**
 * Reads `athletes.discipline` and the `athlete_onboarding_profiles` row (if
 * any) for `athleteId` and returns one normalized, optional-fields context
 * object. Never throws for missing/partial onboarding data — a brand new
 * athlete with zero onboarding rows, or an athlete mid-onboarding with only
 * some fields answered, both resolve cleanly (fewer fields present), never
 * an error and never a fabricated default for the rest.
 */
export async function getAthleteCoachingContext(client: SupabaseClient, athleteId: string): Promise<AthleteCoachingContext> {
  const [athleteResult, profileResult] = await Promise.all([
    client.from("athletes").select("discipline").eq("id", athleteId).maybeSingle(),
    client
      .from("athlete_onboarding_profiles")
      .select("competition_level, primary_goal, weekly_training_hours, preferred_riding_days")
      .eq("athlete_id", athleteId)
      .maybeSingle(),
  ]);

  assertNoSupabaseError(athleteResult.error, "athletes");
  assertNoSupabaseError(profileResult.error, "athlete_onboarding_profiles");

  const athleteRow = athleteResult.data as AthleteRawRow | null;
  const profileRow = profileResult.data as OnboardingProfileRawRow | null;

  const discipline = normalizeDiscipline(athleteRow?.discipline ?? null);
  const ridingDays = profileRow?.preferred_riding_days;

  return {
    athlete_id: athleteId,
    ...(discipline !== undefined ? { discipline } : {}),
    ...(profileRow?.competition_level ? { competition_level: profileRow.competition_level } : {}),
    ...(profileRow?.primary_goal ? { primary_goal: profileRow.primary_goal } : {}),
    ...(profileRow?.weekly_training_hours ? { weekly_training_hours: profileRow.weekly_training_hours } : {}),
    ...(ridingDays && ridingDays.length > 0 ? { preferred_riding_days: ridingDays } : {}),
  };
}
