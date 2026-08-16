-- M2_005 — health_flags: idempotence des flags ouverts
--
-- Voir docs/05_DATA_MODEL.md §health_flags et docs/11_DECISION_LOG.md
-- (2026-08-13 — M2 : persistance atomique via RPC PostgreSQL + idempotence
--  health_flags garantie par contrainte DB).
--
-- Un athlète ne peut avoir qu'un seul health flag ouvert (status IN
-- ('active','monitoring')) par flag_type. Les flags resolved ne sont pas
-- concernés par cet index : après résolution, un nouveau flag du même type
-- peut être créé. Idempotence garantie côté PostgreSQL, pas seulement par
-- un pattern SELECT-then-INSERT applicatif.
--
-- Additif, non destructif :
--   - Un seul index unique partiel ajouté.
--   - Aucune colonne modifiée, aucun backfill, aucun trigger, aucune
--     fonction, aucun RPC.
--   - Les index existants (health_flags_pkey, idx_health_flags_active,
--     idx_health_flags_date) restent strictement inchangés.

create unique index health_flags_open_unique
on public.health_flags (athlete_id, flag_type)
where status in ('active', 'monitoring');
