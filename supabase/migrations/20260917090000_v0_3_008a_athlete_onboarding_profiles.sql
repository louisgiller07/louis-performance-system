-- V0.3_008A — athlete_onboarding_profiles: Niveau 1 de l'onboarding athlète
-- (collecte uniquement, aucun consommateur moteur pour l'instant — voir
-- ticket "NALYNT — Athlete Onboarding V1"). Table dédiée plutôt qu'une
-- extension de athlete_coaching_profiles, dont la migration V0.3_004A
-- documente explicitement "aucun champ sans consommateur runtime actuel" —
-- ce nouveau précédent (collecte en avance de la personnalisation) est
-- volontairement isolé dans sa propre table pour ne pas contredire ce
-- principe existant. Discipline reste sur athletes.discipline (déjà
-- existant, déjà documenté comme peuplé "à l'onboarding" dans
-- docs/02_ATHLETE_PROFILE.md).
--
-- 1 ligne par athlète maximum : athlete_id est directement la PRIMARY KEY,
-- même choix que athlete_coaching_profiles (configuration courante mutable,
-- pas un historique daté).
--
-- Les valeurs de competition_level/primary_goal/weekly_training_hours sont
-- des listes fermées côté frontend (web/src/features/athleteOnboarding/
-- onboardingOptions.ts) — volontairement pas d'enum Postgres ici, pour
-- rester libre de faire évoluer le libellé sans migration (même choix que
-- athlete_coaching_profiles : un CHECK "non-vide", pas une liste de valeurs
-- figée en base).

create table public.athlete_onboarding_profiles (
  athlete_id uuid primary key references public.athletes(id) on delete cascade,
  competition_level text,
  primary_goal text,
  weekly_training_hours text,
  preferred_riding_days jsonb not null default '[]'::jsonb,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_onboarding_profiles_competition_level_not_blank
    check (competition_level is null or length(trim(competition_level)) > 0),
  constraint athlete_onboarding_profiles_primary_goal_not_blank
    check (primary_goal is null or length(trim(primary_goal)) > 0),
  constraint athlete_onboarding_profiles_weekly_training_hours_not_blank
    check (weekly_training_hours is null or length(trim(weekly_training_hours)) > 0),
  constraint athlete_onboarding_profiles_riding_days_is_array
    check (jsonb_typeof(preferred_riding_days) = 'array'),
  -- Defense-in-depth: never let onboarding_completed_at be set while a
  -- required Niveau 1 answer is missing, regardless of what the client sends.
  constraint athlete_onboarding_profiles_completed_requires_answers
    check (
      onboarding_completed_at is null
      or (competition_level is not null and primary_goal is not null
          and weekly_training_hours is not null and jsonb_array_length(preferred_riding_days) > 0)
    )
);

create trigger trg_athlete_onboarding_profiles_updated_at
  before update on public.athlete_onboarding_profiles
  for each row execute function public.set_updated_at();

alter table public.athlete_onboarding_profiles enable row level security;

-- Mutable athlete-owned configuration (FOR ALL, USING + WITH CHECK) — same
-- pattern as athlete_coaching_profiles_own_data/weekly_availability_own_data.
-- The athlete edits this directly under RLS; no RPC.
create policy "athlete_onboarding_profiles_own_data"
  on public.athlete_onboarding_profiles
  for all
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  )
  with check (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

-- Same ALTER DEFAULT PRIVILEGES over-broad-grant reality as every other
-- post-baseline migration in this project — revoke explicitly before
-- granting the exact minimum.
revoke all privileges on public.athlete_onboarding_profiles from anon;
revoke all privileges on public.athlete_onboarding_profiles from authenticated;
revoke all privileges on public.athlete_onboarding_profiles from service_role;

grant select, insert, update, delete on public.athlete_onboarding_profiles to authenticated;
-- service_role: SELECT/INSERT/UPDATE for admin/test-fixture population,
-- matching athlete_coaching_profiles. Deliberately NOT DELETE — removal
-- happens exclusively via the athlete_id ... on delete cascade.
grant select, insert, update on public.athlete_onboarding_profiles to service_role;
-- anon receives no grant at all — not even SELECT.
