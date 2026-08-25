-- pattern_evidence_* append-only security regression check — strictly
-- read-only (this file contains ONLY SELECT statements. No INSERT / UPDATE /
-- DELETE / CREATE / ALTER / DROP / TRUNCATE / GRANT / REVOKE / CALL). Safe
-- to run against local or the linked remote project at any time.
--
-- Purpose: catch a future regression where authenticated (or anon) gains
-- any direct write privilege on pattern_evidence_identities/_revisions/
-- _source_refs, where an expected SELECT-only policy disappears, where
-- persist_pattern_evidence's security posture drifts, where service_role
-- gains UPDATE/DELETE/TRUNCATE it should never need, where an append-only
-- trigger or the revision-predecessor trigger goes missing, or where a
-- view loses its security_invoker setting. Every section is written so an
-- EMPTY result means "healthy" — a non-empty row is a real regression:
-- treat it like a failing test, never edit this file to make it pass.
--
-- Follows the exact style of decision_outcomes_append_only_security_check.sql
-- (M5_001B) and completed_sessions_upsert_only_security_check.sql.

-- ===========================================================================
-- A. RLS must be enabled on all three tables.
-- ===========================================================================
select relname, relrowsecurity, 'RLS must be enabled' as problem
from pg_class
where oid in (
  'public.pattern_evidence_identities'::regclass,
  'public.pattern_evidence_revisions'::regclass,
  'public.pattern_evidence_source_refs'::regclass
)
and relrowsecurity = false;

-- ===========================================================================
-- B. Exactly the expected SELECT-only policy exists on each table, targeting
--    exactly the authenticated role — never PUBLIC, never an extra role.
-- ===========================================================================
select 'pattern_evidence_identities_own_select policy (FOR SELECT, role=authenticated) is missing or misconfigured' as problem
where not exists (
  select 1 from pg_policy pol
  where pol.polrelid = 'public.pattern_evidence_identities'::regclass
    and pol.polname = 'pattern_evidence_identities_own_select'
    and pol.polcmd = 'r'
    and pol.polroles = array[('authenticated'::regrole)::oid]
);

select 'pattern_evidence_revisions_own_select policy (FOR SELECT, role=authenticated) is missing or misconfigured' as problem
where not exists (
  select 1 from pg_policy pol
  where pol.polrelid = 'public.pattern_evidence_revisions'::regclass
    and pol.polname = 'pattern_evidence_revisions_own_select'
    and pol.polcmd = 'r'
    and pol.polroles = array[('authenticated'::regrole)::oid]
);

select 'pattern_evidence_source_refs_own_select policy (FOR SELECT, role=authenticated) is missing or misconfigured' as problem
where not exists (
  select 1 from pg_policy pol
  where pol.polrelid = 'public.pattern_evidence_source_refs'::regclass
    and pol.polname = 'pattern_evidence_source_refs_own_select'
    and pol.polcmd = 'r'
    and pol.polroles = array[('authenticated'::regrole)::oid]
);

-- ===========================================================================
-- C. No policy other than the expected one may exist on any of the three tables.
-- ===========================================================================
select pol.polname, pol.polcmd, 'unexpected policy on pattern_evidence_identities' as problem
from pg_policy pol
where pol.polrelid = 'public.pattern_evidence_identities'::regclass
  and pol.polname <> 'pattern_evidence_identities_own_select';

select pol.polname, pol.polcmd, 'unexpected policy on pattern_evidence_revisions' as problem
from pg_policy pol
where pol.polrelid = 'public.pattern_evidence_revisions'::regclass
  and pol.polname <> 'pattern_evidence_revisions_own_select';

select pol.polname, pol.polcmd, 'unexpected policy on pattern_evidence_source_refs' as problem
from pg_policy pol
where pol.polrelid = 'public.pattern_evidence_source_refs'::regclass
  and pol.polname <> 'pattern_evidence_source_refs_own_select';

-- ===========================================================================
-- D. authenticated must have SELECT, and no write privilege at all, on any
--    of the three tables.
-- ===========================================================================
select table_name, 'authenticated is missing SELECT' as problem
from (values ('pattern_evidence_identities'), ('pattern_evidence_revisions'), ('pattern_evidence_source_refs')) as t(table_name)
where not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = t.table_name
    and grantee = 'authenticated' and privilege_type = 'SELECT'
);

select table_name, grantee, privilege_type, 'unexpected write privilege for authenticated' as problem
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('pattern_evidence_identities', 'pattern_evidence_revisions', 'pattern_evidence_source_refs')
  and grantee = 'authenticated'
  and privilege_type <> 'SELECT';

-- ===========================================================================
-- E. anon must hold zero privileges at all on any of the three tables or the
--    three views.
-- ===========================================================================
select table_name, grantee, privilege_type, 'anon must have zero privileges' as problem
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'pattern_evidence_identities', 'pattern_evidence_revisions', 'pattern_evidence_source_refs',
    'pattern_evidence_current', 'pattern_evidence_history', 'pattern_evidence_current_with_provenance'
  )
  and grantee = 'anon';

-- ===========================================================================
-- F. service_role must have exactly SELECT and INSERT — never UPDATE,
--    DELETE, or TRUNCATE — on any of the three tables (least privilege,
--    M5_006A hardening requirement — grants alone, checked here, are one of
--    two independent layers; see section on triggers below for the other).
-- ===========================================================================
select t.table_name, needed.priv, 'service_role is missing ' || needed.priv as problem
from (values ('pattern_evidence_identities'), ('pattern_evidence_revisions'), ('pattern_evidence_source_refs')) as t(table_name)
cross join unnest(array['SELECT', 'INSERT']) as needed(priv)
where not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = t.table_name
    and grantee = 'service_role' and privilege_type = needed.priv
);

select table_name, grantee, privilege_type, 'service_role must not have UPDATE/DELETE/TRUNCATE' as problem
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('pattern_evidence_identities', 'pattern_evidence_revisions', 'pattern_evidence_source_refs')
  and grantee = 'service_role'
  and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE');

-- ===========================================================================
-- G. Append-only triggers (BEFORE UPDATE and BEFORE DELETE, calling
--    reject_append_only_mutation) must exist on all three tables — this is
--    the second, independent layer beyond the grants above; it must hold
--    even if a future GRANT regression reintroduced UPDATE/DELETE.
-- ===========================================================================
select t.table_name, t.op, 'append-only trigger missing for ' || t.op as problem
from (
  values
    ('pattern_evidence_identities', 'UPDATE'), ('pattern_evidence_identities', 'DELETE'),
    ('pattern_evidence_revisions', 'UPDATE'), ('pattern_evidence_revisions', 'DELETE'),
    ('pattern_evidence_source_refs', 'UPDATE'), ('pattern_evidence_source_refs', 'DELETE')
) as t(table_name, op)
where not exists (
  select 1
  from pg_trigger trg
  join pg_proc p on p.oid = trg.tgfoid
  where trg.tgrelid = ('public.' || t.table_name)::regclass
    and p.proname = 'reject_append_only_mutation'
    and not trg.tgisinternal
    and (
      (t.op = 'UPDATE' and (trg.tgtype & (1 << 4)) <> 0 and (trg.tgtype & (1 << 1)) <> 0)
      or (t.op = 'DELETE' and (trg.tgtype & (1 << 3)) <> 0 and (trg.tgtype & (1 << 1)) <> 0)
    )
);

-- ===========================================================================
-- H. The revision-predecessor validation trigger must exist on
--    pattern_evidence_revisions (BEFORE INSERT, check_pattern_evidence_revision_predecessor).
-- ===========================================================================
select 'revision predecessor-chain validation trigger is missing' as problem
where not exists (
  select 1
  from pg_trigger trg
  join pg_proc p on p.oid = trg.tgfoid
  where trg.tgrelid = 'public.pattern_evidence_revisions'::regclass
    and p.proname = 'check_pattern_evidence_revision_predecessor'
    and not trg.tgisinternal
);

-- ===========================================================================
-- I. persist_pattern_evidence must exist with this exact signature, be
--    SECURITY INVOKER, and be executable by service_role only.
-- ===========================================================================
select 'public.persist_pattern_evidence(...) does not exist with the exact expected signature' as problem
where to_regprocedure(
  'public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'
) is null;

select p.prosecdef as security_definer, 'persist_pattern_evidence must be SECURITY INVOKER' as problem
from pg_proc p
where p.oid = to_regprocedure(
  'public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'
)
and p.prosecdef = true;

select 'anon must not be able to execute persist_pattern_evidence' as problem
where has_function_privilege(
  'anon',
  to_regprocedure('public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'),
  'EXECUTE'
);

select 'authenticated must not be able to execute persist_pattern_evidence' as problem
where has_function_privilege(
  'authenticated',
  to_regprocedure('public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'),
  'EXECUTE'
);

select 'service_role must be able to execute persist_pattern_evidence' as problem
where not has_function_privilege(
  'service_role',
  to_regprocedure('public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'),
  'EXECUTE'
);

-- ===========================================================================
-- J. All three views must exist and carry security_invoker = true.
-- ===========================================================================
select v.viewname, 'view is missing' as problem
from (values ('pattern_evidence_current'), ('pattern_evidence_history'), ('pattern_evidence_current_with_provenance')) as v(viewname)
where not exists (
  select 1 from pg_views where schemaname = 'public' and viewname = v.viewname
);

select c.relname, 'view must have security_invoker = true' as problem
from pg_class c
where c.relkind = 'v'
  and c.relname in ('pattern_evidence_current', 'pattern_evidence_history', 'pattern_evidence_current_with_provenance')
  and c.relnamespace = 'public'::regnamespace
  and coalesce((
    select option_value::boolean
    from pg_options_to_table(c.reloptions) o
    where o.option_name = 'security_invoker'
  ), false) = false;

-- ===========================================================================
-- K. Views: authenticated/service_role must have SELECT, anon must not
--    (anon already covered by section E above; this repeats the positive
--    check for authenticated/service_role specifically on the views).
-- ===========================================================================
select v.viewname, needed.grantee, 'missing SELECT on view' as problem
from (values ('pattern_evidence_current'), ('pattern_evidence_history'), ('pattern_evidence_current_with_provenance')) as v(viewname)
cross join (values ('authenticated'), ('service_role')) as needed(grantee)
where not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = v.viewname
    and grantee = needed.grantee and privilege_type = 'SELECT'
);

-- ===========================================================================
-- L. Informational — expected healthy state, for a human to eyeball
--    alongside A-K returning empty.
-- ===========================================================================
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'pattern_evidence_identities', 'pattern_evidence_revisions', 'pattern_evidence_source_refs',
    'pattern_evidence_current', 'pattern_evidence_history', 'pattern_evidence_current_with_provenance'
  )
  and grantee in ('authenticated', 'service_role', 'anon')
order by table_name, grantee, privilege_type;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'persist_pattern_evidence';
-- Healthy row: security_definer=f, anon_can_execute=f,
-- authenticated_can_execute=f, service_role_can_execute=t.

-- ===========================================================================
-- M5_006B — pattern_evidence_lifecycle_transitions + its two RPCs + its two
-- views. Same discipline as A-L above, extended for the lifecycle layer.
-- ===========================================================================

-- M. RLS must be enabled on the lifecycle table.
select relname, relrowsecurity, 'RLS must be enabled' as problem
from pg_class
where oid = 'public.pattern_evidence_lifecycle_transitions'::regclass
and relrowsecurity = false;

-- N. Exactly the expected SELECT-only policy, authenticated only.
select 'pattern_evidence_lifecycle_transitions_own_select policy (FOR SELECT, role=authenticated) is missing or misconfigured' as problem
where not exists (
  select 1 from pg_policy pol
  where pol.polrelid = 'public.pattern_evidence_lifecycle_transitions'::regclass
    and pol.polname = 'pattern_evidence_lifecycle_transitions_own_select'
    and pol.polcmd = 'r'
    and pol.polroles = array[('authenticated'::regrole)::oid]
);

select pol.polname, pol.polcmd, 'unexpected policy on pattern_evidence_lifecycle_transitions' as problem
from pg_policy pol
where pol.polrelid = 'public.pattern_evidence_lifecycle_transitions'::regclass
  and pol.polname <> 'pattern_evidence_lifecycle_transitions_own_select';

-- O. authenticated must have SELECT, and no write privilege, on the lifecycle table.
select 'authenticated is missing SELECT on pattern_evidence_lifecycle_transitions' as problem
where not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'pattern_evidence_lifecycle_transitions'
    and grantee = 'authenticated' and privilege_type = 'SELECT'
);

select table_name, grantee, privilege_type, 'unexpected write privilege for authenticated' as problem
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'pattern_evidence_lifecycle_transitions'
  and grantee = 'authenticated'
  and privilege_type <> 'SELECT';

-- P. anon must hold zero privileges on the lifecycle table or its two views.
select table_name, grantee, privilege_type, 'anon must have zero privileges' as problem
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'pattern_evidence_lifecycle_transitions', 'pattern_evidence_current_state', 'pattern_evidence_current_effective'
  )
  and grantee = 'anon';

-- Q. service_role must have exactly SELECT and INSERT — never UPDATE/DELETE/TRUNCATE.
select needed.priv, 'service_role is missing ' || needed.priv as problem
from unnest(array['SELECT', 'INSERT']) as needed(priv)
where not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'pattern_evidence_lifecycle_transitions'
    and grantee = 'service_role' and privilege_type = needed.priv
);

select table_name, grantee, privilege_type, 'service_role must not have UPDATE/DELETE/TRUNCATE' as problem
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'pattern_evidence_lifecycle_transitions'
  and grantee = 'service_role'
  and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE');

-- R. Append-only triggers (BEFORE UPDATE/DELETE, reject_append_only_mutation) on the lifecycle table.
select t.op, 'append-only trigger missing for ' || t.op as problem
from (values ('UPDATE'), ('DELETE')) as t(op)
where not exists (
  select 1
  from pg_trigger trg
  join pg_proc p on p.oid = trg.tgfoid
  where trg.tgrelid = 'public.pattern_evidence_lifecycle_transitions'::regclass
    and p.proname = 'reject_append_only_mutation'
    and not trg.tgisinternal
    and (
      (t.op = 'UPDATE' and (trg.tgtype & (1 << 4)) <> 0 and (trg.tgtype & (1 << 1)) <> 0)
      or (t.op = 'DELETE' and (trg.tgtype & (1 << 3)) <> 0 and (trg.tgtype & (1 << 1)) <> 0)
    )
);

-- S. The lifecycle predecessor-chain validation trigger must exist.
select 'lifecycle predecessor-chain validation trigger is missing' as problem
where not exists (
  select 1
  from pg_trigger trg
  join pg_proc p on p.oid = trg.tgfoid
  where trg.tgrelid = 'public.pattern_evidence_lifecycle_transitions'::regclass
    and p.proname = 'check_pattern_evidence_lifecycle_predecessor'
    and not trg.tgisinternal
);

-- T. Both lifecycle RPCs must exist with their exact signatures, be
--    SECURITY INVOKER, and be executable by service_role only.
select 'public.transition_pattern_evidence_lifecycle(...) does not exist with the exact expected signature' as problem
where to_regprocedure(
  'public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb)'
) is null;

select p.prosecdef as security_definer, 'transition_pattern_evidence_lifecycle must be SECURITY INVOKER' as problem
from pg_proc p
where p.oid = to_regprocedure('public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb)')
and p.prosecdef = true;

select 'anon must not be able to execute transition_pattern_evidence_lifecycle' as problem
where has_function_privilege('anon', to_regprocedure('public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb)'), 'EXECUTE');

select 'authenticated must not be able to execute transition_pattern_evidence_lifecycle' as problem
where has_function_privilege('authenticated', to_regprocedure('public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb)'), 'EXECUTE');

select 'service_role must be able to execute transition_pattern_evidence_lifecycle' as problem
where not has_function_privilege('service_role', to_regprocedure('public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb)'), 'EXECUTE');

select 'public.persist_active_pattern_evidence(...) does not exist with the exact expected signature' as problem
where to_regprocedure(
  'public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'
) is null;

select p.prosecdef as security_definer, 'persist_active_pattern_evidence must be SECURITY INVOKER' as problem
from pg_proc p
where p.oid = to_regprocedure('public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)')
and p.prosecdef = true;

select 'anon must not be able to execute persist_active_pattern_evidence' as problem
where has_function_privilege('anon', to_regprocedure('public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'), 'EXECUTE');

select 'authenticated must not be able to execute persist_active_pattern_evidence' as problem
where has_function_privilege('authenticated', to_regprocedure('public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'), 'EXECUTE');

select 'service_role must be able to execute persist_active_pattern_evidence' as problem
where not has_function_privilege('service_role', to_regprocedure('public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb)'), 'EXECUTE');

-- U. Both new views must exist and carry security_invoker = true.
select v.viewname, 'view is missing' as problem
from (values ('pattern_evidence_current_state'), ('pattern_evidence_current_effective')) as v(viewname)
where not exists (
  select 1 from pg_views where schemaname = 'public' and viewname = v.viewname
);

select c.relname, 'view must have security_invoker = true' as problem
from pg_class c
where c.relkind = 'v'
  and c.relname in ('pattern_evidence_current_state', 'pattern_evidence_current_effective')
  and c.relnamespace = 'public'::regnamespace
  and coalesce((
    select option_value::boolean
    from pg_options_to_table(c.reloptions) o
    where o.option_name = 'security_invoker'
  ), false) = false;

-- V. Views: authenticated/service_role must have SELECT, anon must not
--    (anon already covered by section P above).
select v.viewname, needed.grantee, 'missing SELECT on view' as problem
from (values ('pattern_evidence_current_state'), ('pattern_evidence_current_effective')) as v(viewname)
cross join (values ('authenticated'), ('service_role')) as needed(grantee)
where not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = v.viewname
    and grantee = needed.grantee and privilege_type = 'SELECT'
);

-- W. Informational — expected healthy state for the lifecycle layer.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'pattern_evidence_lifecycle_transitions', 'pattern_evidence_current_state', 'pattern_evidence_current_effective'
  )
  and grantee in ('authenticated', 'service_role', 'anon')
order by table_name, grantee, privilege_type;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('transition_pattern_evidence_lifecycle', 'persist_active_pattern_evidence')
order by p.proname;
-- Healthy rows: security_definer=f, anon_can_execute=f,
-- authenticated_can_execute=f, service_role_can_execute=t, for both.
