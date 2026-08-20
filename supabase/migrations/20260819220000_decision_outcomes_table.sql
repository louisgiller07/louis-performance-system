-- M5_001B — decision_outcomes: append-only foundation for measuring what
-- actually happened after a coaching decision.
--
-- Voir docs/11_DECISION_LOG.md (2026-08-19 — M5_001B) pour le contexte
-- complet. Ceci n'implémente AUCUN calculateur — uniquement le schéma
-- append-only capable de stocker de futurs résultats déterministes, plus
-- sa RPC de persistance (migration suivante).
--
-- ===========================================================================
-- Pourquoi une nouvelle table plutôt que decisions.reviewed_after_days /
-- decisions.outcome_note (colonnes legacy déjà existantes) ?
-- ===========================================================================
-- decisions est désormais réellement append-only (M4_006) : authenticated
-- n'a que SELECT, et le seul chemin d'écriture (persist_daily_run) ne fait
-- jamais d'UPDATE. Réutiliser reviewed_after_days/outcome_note exigerait un
-- UPDATE sur une ligne decisions existante, ce qui contredit directement cet
-- invariant. Ces deux colonnes legacy restent donc explicitement NON
-- UTILISÉES par ce design — jamais lues, jamais écrites ici. Une décision
-- peut aussi avoir plusieurs observations dans le temps (J+1, J+3, J+7),
-- ce qu'une paire de colonnes scalaires sur la ligne decisions ne peut pas
-- représenter sans écrasement.
--
-- ===========================================================================
-- Pourquoi un input_snapshot immuable ?
-- ===========================================================================
-- daily_checkins (et completed_sessions) sont éditables — un athlète peut
-- corriger son check-in de la veille. Si un futur calculateur J+3 lisait
-- directement les tables live, son résultat deviendrait silencieusement
-- irreproductible/incohérent avec ce qu'il avait réellement vu au moment du
-- calcul. input_snapshot fige donc les faits sources déterministes
-- effectivement consommés par le calculateur au moment du calcul — un objet
-- JSON canonique et volontairement restreint (jamais un dump complet de
-- lignes entières), pas une référence FK vers des lignes encore mutables :
-- une FK ne protégerait de toute façon pas contre une édition ultérieure de
-- la ligne référencée, seul un snapshot le peut. Le contenu exact de ce
-- snapshot (quels champs de quelles tables) est laissé au futur
-- calculateur — cette tranche ne fait qu'imposer que ce soit un objet JSON
-- non vide et présent, jamais optionnel.
--
-- ===========================================================================
-- Colonnes
-- ===========================================================================
--   id                  identité propre (jamais decisions.id — plusieurs
--                       observations peuvent exister pour une même decision).
--   athlete_id          ownership dénormalisée (cohérent avec le reste du
--                       schéma), FK réelle, ON DELETE CASCADE (même
--                       convention que toutes les autres tables athlete_id
--                       de ce schéma).
--   decision_id         FK réelle vers decisions(id), ON DELETE RESTRICT —
--                       pas CASCADE : decision_outcomes EST une preuve
--                       dérivée de la decision qu'elle observe ; on ne veut
--                       jamais qu'une suppression de decisions (qui ne se
--                       produit d'ailleurs jamais dans le code actuel) fasse
--                       disparaître silencieusement les observations qui en
--                       dépendent. Cette FK est la garantie d'intégrité
--                       "decision_id belongs to athlete_id" au niveau
--                       structurel ; la RPC valide en plus que le
--                       decisions.athlete_id trouvé correspond bien à
--                       p_athlete_id (une FK seule ne peut pas exprimer une
--                       contrainte cross-colonne comme celle-ci).
--   horizon              enum decision_outcome_horizon (J_PLUS_1/3/7) —
--                       l'horizon temporel de CETTE observation, pas une
--                       date calendaire : le même decision_id peut avoir
--                       jusqu'à une ligne par horizon par (calculator_id,
--                       calculator_version).
--   calculator_id        identité du calculateur qui a produit cette ligne
--                       (texte libre — aucun calculateur n'existe encore,
--                       donc pas d'enum fermé prématuré).
--   calculator_version   version de ce calculateur. Une nouvelle version
--                       produit de NOUVELLES lignes immuables ; elle ne
--                       modifie jamais une ligne d'une version antérieure
--                       (voir contrainte d'unicité plus bas).
--   input_snapshot        JSON canonique des faits sources déterministes
--                       réellement consommés (voir plus haut).
--   outcome_signals        JSON structuré des résultats déterministes calculés
--                       (ex. futurs : delta d'énergie, delta de fatigue
--                       jambes/grip, delta de motivation, apparition/
--                       persistance de douleur, état maladie, complétion de
--                       séance, RPE...). Aucun résumé en langage naturel,
--                       aucun score de confiance arbitraire — cette tranche
--                       n'implémente d'ailleurs aucun calcul du tout, juste
--                       le contenant.
--   calculated_at         quand ce calcul a réellement tourné (peut différer
--                       de created_at si un futur rejeu differé existe).
--   created_at            standard, jamais de updated_at : cette table n'a
--                       délibérément PAS de colonne updated_at ni de
--                       trigger set_updated_at — une ligne n'est jamais
--                       modifiée après sa création, la ligne l'exprime
--                       elle-même par construction plutôt que par
--                       discipline de code seule.
--
-- ===========================================================================
-- Idempotence — contrainte d'unicité
-- ===========================================================================
-- UNIQUE (athlete_id, decision_id, horizon, calculator_id, calculator_version)
-- Rejouer le même calculateur/version pour la même decision/horizon ne peut
-- donc jamais créer de doublon au niveau DB — la RPC (migration suivante)
-- décide quoi faire si la clé existe déjà (retour idempotent si contenu
-- identique, exception si contenu différent — jamais un UPDATE silencieux).

create type public.decision_outcome_horizon as enum (
  'J_PLUS_1',
  'J_PLUS_3',
  'J_PLUS_7'
);

create table public.decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  decision_id uuid not null references public.decisions(id) on delete restrict,
  horizon public.decision_outcome_horizon not null,
  calculator_id text not null,
  calculator_version text not null,
  input_snapshot jsonb not null,
  outcome_signals jsonb not null,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint decision_outcomes_calculator_id_not_blank check (length(trim(calculator_id)) > 0),
  constraint decision_outcomes_calculator_version_not_blank check (length(trim(calculator_version)) > 0),
  constraint decision_outcomes_input_snapshot_is_object check (jsonb_typeof(input_snapshot) = 'object'),
  constraint decision_outcomes_outcome_signals_is_object check (jsonb_typeof(outcome_signals) = 'object'),
  constraint decision_outcomes_unique_key unique (athlete_id, decision_id, horizon, calculator_id, calculator_version)
);

-- FK columns are not auto-indexed by Postgres; decision_id benefits from
-- its own index independent of the unique constraint's leftmost-prefix
-- (athlete_id, decision_id, ...) coverage.
create index idx_decision_outcomes_decision_id on public.decision_outcomes using btree (decision_id);

alter table public.decision_outcomes enable row level security;

-- SELECT-only, own-athlete — analogous in rigor to decisions_own_select
-- (M4_006) and completed_sessions_own_select (M5_001A). No FOR ALL policy
-- is ever created for this table.
create policy "decision_outcomes_own_select"
  on public.decision_outcomes
  for select
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

-- IMPORTANT — verified empirically, not assumed: this project has
-- ALTER DEFAULT PRIVILEGES configured in the public schema (both the
-- `postgres` and `supabase_admin` roles) that auto-GRANTs ALL table/
-- function privileges to anon/authenticated/service_role on every newly
-- created object — the same mechanism that made the baseline tables
-- broad-by-default. A fresh CREATE TABLE here does NOT start from a blank
-- privilege slate; it starts from exactly the same over-broad grants this
-- project has been correcting table by table (decisions in M4_006,
-- completed_sessions in M5_001A). REVOKE explicitly before GRANTing the
-- exact minimum, rather than assuming nothing needs revoking.
revoke all privileges on public.decision_outcomes from anon;
revoke all privileges on public.decision_outcomes from authenticated;
revoke all privileges on public.decision_outcomes from service_role;

grant select on public.decision_outcomes to authenticated;
grant select, insert on public.decision_outcomes to service_role;
-- service_role deliberately does NOT receive update/delete/truncate here —
-- this table has no legitimate write path other than a fresh INSERT via
-- persist_decision_outcome (next migration), which never updates a row.
-- anon receives no grant at all — not even SELECT.
