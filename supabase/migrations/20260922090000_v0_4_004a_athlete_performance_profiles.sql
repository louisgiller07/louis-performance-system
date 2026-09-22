-- V0.4_004A — athlete_performance_profiles: Performance Setup (V0.4_018A),
-- the Planning Engine input fields with NO existing source of truth.
--
-- Audit préalable (V0.4_101, voir docs/11_DECISION_LOG.md) a trouvé trois
-- champs de PlanInputSnapshot déjà couverts ailleurs — délibérément PAS
-- dupliqués ici :
--   - discipline            -> athletes.discipline
--   - competitionLevel      -> athlete_onboarding_profiles.competition_level
--   - races                 -> race_calendar (déjà exactement equivalent :
--                              event_name/start_date/end_date/priority, et
--                              race_priority = A_PLUS/A/B/C = PlanInputRace.priority)
--
-- seasonObjective et technicalPriorities sont des concepts neufs, validés
-- comme indépendants de primary_goal / technique_primary_focus (V0.4_101
-- validation architecte 2026-09-22) — pas une fusion avec ces champs
-- existants.
--
-- 1 ligne par athlète maximum, même patron que athlete_coaching_profiles
-- (v0_3_004a) / athlete_onboarding_profiles (v0_3_008a) : configuration
-- courante mutable, pas un historique daté. Absence de ligne = "Performance
-- Setup jamais configuré", jamais une erreur ni une valeur fabriquée.
--
-- Aucun consommateur runtime aujourd'hui (le pipeline de génération n'existe
-- pas encore, V0.4_022A) — précédent déjà assumé par athlete_onboarding_
-- profiles ("collecte en avance de la personnalisation"), pas une entorse au
-- principe plus strict d'athlete_coaching_profiles.
--
-- strength_experience_tier reste `text` + CHECK non-vide, jamais un enum
-- Postgres — même choix délibéré que competition_level/primary_goal
-- (athlete_onboarding_profiles) : rester libre de faire évoluer le libellé
-- sans migration. La validation stricte de la valeur réelle (3 valeurs
-- fermées : beginner/intermediate/advanced) reste le rôle de
-- planning-engine/src/validation côté TypeScript au moment de la
-- consommation, jamais dupliquée ici.
--
-- technical_priorities est un objet JSONB unique {strengths, weaknesses,
-- priorityAreas} (validé V0.4_101), pas trois colonnes tableau séparées —
-- même style que decision_final_prescriptions.structure.

create table public.athlete_performance_profiles (
  athlete_id uuid primary key references public.athletes(id) on delete cascade,

  equipment jsonb not null default '[]'::jsonb,
  terrain_access jsonb not null default '[]'::jsonb,
  strength_experience_tier text,
  declared_limitations jsonb not null default '[]'::jsonb,
  season_objective text,
  technical_priorities jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint athlete_performance_profiles_strength_tier_not_blank
    check (strength_experience_tier is null or length(trim(strength_experience_tier)) > 0),
  constraint athlete_performance_profiles_season_objective_not_blank
    check (season_objective is null or length(trim(season_objective)) > 0),
  constraint athlete_performance_profiles_equipment_is_array
    check (jsonb_typeof(equipment) = 'array'),
  constraint athlete_performance_profiles_terrain_access_is_array
    check (jsonb_typeof(terrain_access) = 'array'),
  constraint athlete_performance_profiles_declared_limitations_is_array
    check (jsonb_typeof(declared_limitations) = 'array'),
  constraint athlete_performance_profiles_technical_priorities_is_object
    check (jsonb_typeof(technical_priorities) = 'object')
);

create trigger trg_athlete_performance_profiles_updated_at
  before update on public.athlete_performance_profiles
  for each row execute function public.set_updated_at();

alter table public.athlete_performance_profiles enable row level security;

-- Mutable athlete-owned configuration (FOR ALL, USING + WITH CHECK) — same
-- pattern as athlete_coaching_profiles_own_data/athlete_onboarding_profiles_
-- own_data. The athlete edits this directly under RLS; no RPC (confirmed by
-- V0.4_101's own "aucun RPC métier" constraint, which this precedent already
-- justifies independently).
create policy "athlete_performance_profiles_own_data"
  on public.athlete_performance_profiles
  for all
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  )
  with check (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

revoke all privileges on public.athlete_performance_profiles from anon;
revoke all privileges on public.athlete_performance_profiles from authenticated;
revoke all privileges on public.athlete_performance_profiles from service_role;

grant select, insert, update, delete on public.athlete_performance_profiles to authenticated;
-- service_role: SELECT (futur runtime de génération) + INSERT/UPDATE
-- (peuplement admin/fixtures avant toute UI Performance Setup) — jamais
-- DELETE, même raisonnement qu'athlete_coaching_profiles : la suppression
-- passe exclusivement par le cascade sur athletes.
grant select, insert, update on public.athlete_performance_profiles to service_role;
-- anon ne reçoit aucun privilège, pas même SELECT.
