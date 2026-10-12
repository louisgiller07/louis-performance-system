-- P0-SAFE — read-only aggregated inventory of open health signals (no personal data in the output).
-- Run: npx supabase db query --linked -f docs/review/P0_SAFE_FLAGS_INVENTORY.sql
with open_flags as (
  select f.id, f.athlete_id, f.flag_type, f.status, f.flag_date, f.created_at
  from public.health_flags f
  where f.status in ('active', 'monitoring')
), evidence as (
  select o.id,
         count(d.id) as decisions,
         bool_or(exists (select 1 from jsonb_array_elements(coalesce(d.daily_plan->'triggered_rules', '[]'::jsonb)) r where r->>'layer' = 'A' and r->>'rule_id' in ('A2', 'A4'))) as grave,
         count(distinct split_part(d.daily_plan->'health_flag_to_create'->>'reason', ' — ', 2)) as zones
  from open_flags o
  left join public.decisions d
    on d.athlete_id = o.athlete_id and d.created_at >= o.created_at
   and d.daily_plan->'health_flag_to_create'->>'type' = o.flag_type::text
  group by o.id
)
select o.flag_type::text as flag_type,
       o.status::text as status,
       count(*) as open_signals,
       count(distinct o.athlete_id) as athletes,
       min(o.flag_date) as oldest,
       max(o.flag_date) as newest,
       count(*) filter (where e.decisions = 0) as without_decision_evidence,
       count(*) filter (where e.grave) as grave_evidence,
       count(*) filter (where e.zones > 1) as multi_zone
from open_flags o join evidence e on e.id = o.id
group by 1, 2
order by 1, 2;
