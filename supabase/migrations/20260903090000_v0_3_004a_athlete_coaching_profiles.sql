-- V0.3_004A — athlete_coaching_profiles: personal coaching content, scoped
-- per athlete, currently consumed by the Technique and Mental domains.
-- Voir head-coach-engine/src/domains/{technique,mental}.ts et
-- head-coach-engine/src/supabase/buildRawContext.ts pour les consommateurs
-- réels. (La clôture canonique docs/00/06/10/11/12 de ce jalon est
-- délibérément différée à une passe de documentation dédiée, non encore
-- écrite au moment de cette migration — ne pas y référencer par avance.)
--
-- Avant ce jalon, ces deux valeurs vivaient dans un singleton de code
-- mono-athlète (head-coach-engine/src/config/athleteCoachingProfile.ts,
-- retiré par ce jalon) qui se serait appliqué tel quel à n'importe quel
-- second athlète.
--
-- V1 volontairement minimal : uniquement les deux valeurs textuelles
-- réellement consommées par le moteur aujourd'hui (technique.primaryFocus,
-- mental.preRaceCue). Pas de dump de profil général (pas d'id de focus/cue,
-- pas de taille/poids/discipline/objectifs/équipement/disponibilité/notes)
-- — aucun champ sans consommateur runtime actuel.
--
-- 1 ligne par athlète maximum : athlete_id est directement la PRIMARY KEY
-- (pas un id de substitution + contrainte unique séparée), car c'est une
-- configuration courante mutable, pas un historique daté (contrairement à
-- weekly_availability qui a une ligne par semaine). Absence de ligne =
-- absence de personnalisation, jamais une erreur ni une valeur générique
-- fabriquée — voir buildRawContext.ts / technique.ts / mental.ts, qui
-- traitent toutes deux colonnes comme individuellement optionnelles.

create table public.athlete_coaching_profiles (
  athlete_id uuid primary key references public.athletes(id) on delete cascade,
  technique_primary_focus text,
  mental_pre_race_cue text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- NULL stays NULL (absent = "not yet configured"), but a present value
  -- must be real content — same not-blank convention already established
  -- by decision_outcomes_calculator_id_not_blank
  -- (20260819220000_decision_outcomes_table.sql). Postgres CHECK treats a
  -- NULL operand as satisfied, so this only ever rejects an empty/
  -- whitespace-only string, never a NULL.
  constraint athlete_coaching_profiles_technique_focus_not_blank
    check (technique_primary_focus is null or length(trim(technique_primary_focus)) > 0),
  constraint athlete_coaching_profiles_mental_cue_not_blank
    check (mental_pre_race_cue is null or length(trim(mental_pre_race_cue)) > 0)
);

create trigger trg_athlete_coaching_profiles_updated_at
  before update on public.athlete_coaching_profiles
  for each row execute function public.set_updated_at();

alter table public.athlete_coaching_profiles enable row level security;

-- Mutable athlete-owned configuration (FOR ALL, USING + WITH CHECK) — same
-- pattern as weekly_availability_own_data/training_blocks_own_data, NOT the
-- append-only SELECT-only pattern used by decisions/decision_outcomes/M5.
-- The athlete edits this directly under RLS; no RPC. service_role also gets
-- write access below (see grant block) for pre-UI admin population, never
-- as a bypass of this RLS policy for authenticated traffic.
create policy "athlete_coaching_profiles_own_data"
  on public.athlete_coaching_profiles
  for all
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  )
  with check (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

-- Same ALTER DEFAULT PRIVILEGES over-broad-grant reality as every other
-- post-baseline migration in this project (see decision_outcomes_table.sql)
-- — revoke explicitly before granting the exact minimum.
revoke all privileges on public.athlete_coaching_profiles from anon;
revoke all privileges on public.athlete_coaching_profiles from authenticated;
revoke all privileges on public.athlete_coaching_profiles from service_role;

grant select, insert, update, delete on public.athlete_coaching_profiles to authenticated;
-- service_role: SELECT (buildRawContext.ts reads this table via the
-- privileged admin client during every daily-run) + INSERT/UPDATE (the
-- realistic near-term need: populating/editing an athlete's profile
-- server-side — e.g. Louis's own real row during rollout — before any
-- profile-edit UI exists; test fixtures also rely on the same admin-client
-- upsert for setup convenience, matching every other athlete-owned table).
-- Deliberately NOT DELETE: no code path directly deletes a single profile
-- row while keeping its athlete — removing a profile happens exclusively
-- via `athlete_id ... on delete cascade` when the athlete itself is
-- deleted, which does not require a DELETE grant on this table (the
-- cascade is enforced by the FK constraint itself, not a DML statement
-- subject to this table's own grants). Least privilege over blind
-- precedent-matching with weekly_availability/training_blocks, which have
-- no equivalent reason to withhold DELETE.
grant select, insert, update on public.athlete_coaching_profiles to service_role;
-- anon receives no grant at all — not even SELECT.
