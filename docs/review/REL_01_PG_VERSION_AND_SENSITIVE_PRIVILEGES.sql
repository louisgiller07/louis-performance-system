-- REL-01 — production PostgreSQL version and sensitive privileges of the API roles (READ ONLY: one SELECT; catalogue
-- metadata only: version, role, privilege, table names; no row of any table is read; no personal or health data).
-- Version-safe: uses aclexplode on the ACLs (works on PostgreSQL 15, 16 and 17; MAINTAIN rows simply cannot appear
-- before 17), never has_table_privilege(..., 'MAINTAIN') which fails before 17.
-- Covers the direct grants of anon, authenticated and PUBLIC (no API role is granted to them through membership:
-- they are NOLOGIN; authenticator is a member without inheritance), the default privileges of schema public and the
-- table owners.
-- Expected TODAY (production 92937a9, before REL-01), from the local reproduction:
--   TRUNCATE, TRIGGER, REFERENCES: anon 9 / authenticated 9 tables; MAINTAIN (PostgreSQL 17 only): anon 9 /
--   authenticated 12; PUBLIC: none; owners: postgres only.
-- Expected AFTER REL-01 (P0-SEC-TRUNCATE + P0-SEC-TRIGGER): TRUNCATE 0 / 0, TRIGGER 0 / 0; REFERENCES and MAINTAIN
--   unchanged (MAINTAIN: separate proposal P0-SEC-MAINTAIN).
-- Run: Supabase Dashboard > SQL Editor (production project uvolpldwwyvadlamulvr) > paste > Run. Louis only.
with grants as (
  select c.relname, a.grantee, a.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
), api(grantee, role) as (
  select 0::oid, 'PUBLIC'
  union all select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')
), privs(privilege_type) as (
  values ('TRUNCATE'), ('TRIGGER'), ('MAINTAIN'), ('REFERENCES')
)
select 0 as part, 'server' as role, 'version' as privilege, null::bigint as tables,
       current_setting('server_version') || ' (num ' || current_setting('server_version_num') || ')' as detail
union all
select 1, a.role, p.privilege_type, count(g.relname), coalesce(string_agg(g.relname, ', ' order by g.relname), '')
from api a cross join privs p
left join grants g on g.grantee = a.grantee and g.privilege_type = p.privilege_type
group by a.role, p.privilege_type
union all
select 2, x.grantee::regrole::text, 'default privileges (tables created by ' || d.defaclrole::regrole::text || ')', null,
       string_agg(x.privilege_type, ', ' order by x.privilege_type)
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) x
where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
  and x.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
group by x.grantee, d.defaclrole
union all
select 3, pg_get_userbyid(c.relowner), 'owner of public tables', count(*), ''
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
group by c.relowner
order by 1, 2, 3;
