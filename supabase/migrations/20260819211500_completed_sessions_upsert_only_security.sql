-- M5_001A — completed_sessions: retrait des privilèges d'écriture directs
--
-- Empirical local proof (audit M5_001, jamais exécuté remote) : la policy
-- baseline completed_sessions_own_data (CREATE POLICY ... USING (...)
-- WITH CHECK (...), sans clause FOR) est traitée par PostgreSQL comme
-- FOR ALL — exactement le même schéma que decisions_own_data avant son
-- correctif (20260819200000_decisions_append_only_security.sql). Combinée
-- au GRANT ALL ... TO anon/authenticated du baseline, un utilisateur
-- authenticated pouvait INSERT/UPDATE/DELETE directement ses propres
-- lignes completed_sessions, contournant tout futur contrôle applicatif.
--
-- Contrairement à decisions (append-only), completed_sessions reste
-- UPSERT-shaped par design (UNIQUE (athlete_id, session_date), non modifiée
-- ici) : le chemin d'écriture légitime est désormais exclusivement
-- persist_completed_session (migration précédente
-- 20260819210000_persist_completed_session_rpc.sql), exécutable uniquement
-- par service_role.
--
-- Cible, en deux temps comme pour le correctif decisions :
--   1. Remplacer la policy FOR ALL par une policy SELECT-only pour
--      authenticated, avec l'expression d'ownership réelle du baseline,
--      réutilisée verbatim (non simplifiée, non réinventée).
--   2. Révoquer les privilèges d'écriture directs pour authenticated,
--      révoquer tout privilège pour anon. service_role n'est PAS touché —
--      son GRANT ALL existant reste intact et suffit largement à
--      persist_completed_session (qui n'exécute que SELECT sur decisions,
--      INSERT et UPDATE sur completed_sessions).

drop policy if exists "completed_sessions_own_data" on "public"."completed_sessions";

create policy "completed_sessions_own_select"
  on "public"."completed_sessions"
  for select
  to authenticated
  using (
    ("athlete_id" in ( select "athletes"."id"
       from "public"."athletes"
      where ("athletes"."user_id" = "auth"."uid"())))
  );

-- Least privilege: authenticated keeps only what direct reads need. All
-- writes go exclusively through persist_completed_session (service_role).
revoke insert, update, delete, truncate, references, trigger
  on "public"."completed_sessions"
  from "authenticated";

grant select on "public"."completed_sessions" to "authenticated";

-- anon has no legitimate access to completed_sessions at all.
revoke all privileges on "public"."completed_sessions" from "anon";
