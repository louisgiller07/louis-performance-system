-- M2 remote preflight — strictly read-only.
--
-- Purpose: verify, before any remote migration is pushed, that (A) the
-- baseline tables M2 depends on exist on the remote project, (B) none of
-- the M2 objects (columns/enum/index/function) already exist there, (C)
-- there are no duplicate open health_flags that would violate the M2_005
-- partial unique index once applied, (D) the legacy `decisions.confidence`
-- column is still the original numeric column, and (E) what migration
-- versions are currently recorded remotely.
--
-- This file contains ONLY SELECT statements. No INSERT / UPDATE / DELETE /
-- CREATE / ALTER / DROP / TRUNCATE / GRANT / REVOKE / CALL. It is meant to
-- be run read-only (e.g. via a read-only MCP connection or a read-only
-- role) against the linked remote project, and to be versioned for audit
-- — never edited to make a check "pass" artificially.

-- ===========================================================================
-- A. Baseline tables M2 depends on — must exist
-- ===========================================================================
select
  t.table_name,
  (t.table_name is not null) as exists
from (
  values
    ('daily_checkins'),
    ('decisions'),
    ('planned_sessions'),
    ('completed_sessions'),
    ('health_flags'),
    ('race_calendar'),
    ('training_blocks')
) as expected(table_name)
left join information_schema.tables t
  on t.table_schema = 'public'
  and t.table_name = expected.table_name
  and t.table_type = 'BASE TABLE'
order by expected.table_name;

-- ===========================================================================
-- B. M2 objects — must NOT exist yet on remote
-- ===========================================================================

-- B.1 — daily_checkins pain criteria columns (M2_001)
select
  column_name,
  true as unexpectedly_present
from information_schema.columns
where table_schema = 'public'
  and table_name = 'daily_checkins'
  and column_name in ('pain_traumatic', 'pain_function_loss', 'pain_getting_worse');

-- B.2 — decisions M2 columns (M2_002)
select
  column_name,
  true as unexpectedly_present
from information_schema.columns
where table_schema = 'public'
  and table_name = 'decisions'
  and column_name in ('daily_plan', 'active_mode', 'confidence_level');

-- B.3 — planned_sessions M2 columns (M2_003)
select
  column_name,
  true as unexpectedly_present
from information_schema.columns
where table_schema = 'public'
  and table_name = 'planned_sessions'
  and column_name in ('intervention', 'planned_intent');

-- B.4 — completed_sessions M2 column (M2_004)
select
  column_name,
  true as unexpectedly_present
from information_schema.columns
where table_schema = 'public'
  and table_name = 'completed_sessions'
  and column_name = 'intervention';

-- B.5 — confidence_level enum (M2_002)
select
  t.typname,
  true as unexpectedly_present
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'confidence_level';

-- B.6 — health_flags_open_unique index (M2_005)
select
  indexname,
  true as unexpectedly_present
from pg_indexes
where schemaname = 'public'
  and indexname = 'health_flags_open_unique';

-- B.7 — persist_daily_run(uuid, jsonb, jsonb) function (M2_006)
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  true as unexpectedly_present
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'persist_daily_run';

-- ===========================================================================
-- C. Duplicate open health_flags — must be 0 rows
-- (would violate the M2_005 partial unique index once applied)
-- ===========================================================================
select
  athlete_id,
  flag_type,
  count(*) as open_count
from public.health_flags
where status in ('active', 'monitoring')
group by athlete_id, flag_type
having count(*) > 1;

-- ===========================================================================
-- D. Legacy decisions.confidence — must still exist, still numeric
-- ===========================================================================
select
  column_name,
  data_type,
  numeric_precision,
  numeric_scale,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'decisions'
  and column_name = 'confidence';

-- ===========================================================================
-- E. Migration history currently recorded remotely
-- ===========================================================================
select
  version,
  name,
  statements
from supabase_migrations.schema_migrations
order by version;
