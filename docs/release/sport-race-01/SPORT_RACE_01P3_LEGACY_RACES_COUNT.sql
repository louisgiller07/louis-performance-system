-- SPORT-RACE-01P.3 / 01P.4 — inventory of the races whose pre-event protocol changes with the competition contract.
-- STRICTLY READ ONLY: three independent SELECT statements (no DDL, no DML, no function with a side effect, no temp
-- table). Run them ONE AT A TIME in the Supabase SQL editor (copy from « select » to the « ; » of one query).
-- No athlete identifier, no event name, no free text is returned: categories, dates, counts and an arbitrary rider
-- number (Q3) only.
--
-- Rule after publication (docs/05 §race_calendar): a race keeps a T-X protocol only for
-- (HOT_TRAIL_2DAY, series 'HOT_TRAIL_SERIES') or (IXS_3DAY, series 'IXS'). Any other HOT_TRAIL_2DAY / IXS_3DAY row
-- (series NULL, free text or another code) loses it — « perd_protocole ». All other formats never had one.
-- Coaching-relevant statuses: everything but cancelled / skipped (same rule as the engine).

-- ---------------------------------------------------------------------------------------------------------------
-- Q1 — every race by protocol change, timing and status: how many races, how many riders.
-- ---------------------------------------------------------------------------------------------------------------
select
  case
    when (race_format::text = 'HOT_TRAIL_2DAY' and series = 'HOT_TRAIL_SERIES') or (race_format::text = 'IXS_3DAY' and series = 'IXS') then 'garde_protocole'
    when race_format::text in ('HOT_TRAIL_2DAY', 'IXS_3DAY') then 'perd_protocole'
    else 'sans_protocole_avant_et_apres'
  end as changement,
  coalesce(race_format::text, 'NULL') as race_format,
  case
    when series is null then 'serie_null'
    when series in ('HOT_TRAIL_SERIES', 'IXS', 'SWISS_OTHER', 'UCI_WORLD_CUP', 'UCI_WORLD_CHAMPS', 'FR_COUPE_DE_FRANCE_DH',
                    'FR_CHAMPIONNAT_DE_FRANCE_DH', 'FR_REGIONAL_DH', 'FR_OTHER_DH', 'OTHER') then 'code:' || series
    else 'texte_libre'
  end as serie,
  case
    when end_date < current_date then 'passee'
    when start_date <= current_date then 'en_cours'
    when start_date - current_date <= 7 then 'a_venir_7_jours'
    else 'a_venir_plus_tard'
  end as moment,
  (status::text not in ('cancelled', 'skipped')) as statut_pris_en_compte,
  count(*) as courses,
  count(distinct athlete_id) as riders
from public.race_calendar
group by 1, 2, 3, 4, 5
order by 1, 2, 3, 4, 5;

-- ---------------------------------------------------------------------------------------------------------------
-- Q2 — the races that lose the protocol, still ahead (or in progress) and coaching-relevant: riders, planning model
-- of the next generation (no row = v1) and the plan sessions already projected in their T-7..T-1 window, by source.
-- ---------------------------------------------------------------------------------------------------------------
with affected as (
  select r.id, r.athlete_id, r.start_date
  from public.race_calendar r
  -- « is distinct from »: a NULL series must count as « not the explicit code » (a plain « = » would drop it).
  where ((r.race_format::text = 'HOT_TRAIL_2DAY' and r.series is distinct from 'HOT_TRAIL_SERIES')
      or (r.race_format::text = 'IXS_3DAY' and r.series is distinct from 'IXS'))
    and r.end_date >= current_date
    and r.status::text not in ('cancelled', 'skipped')
),
window_sessions as (
  select
    a.id as race_id,
    count(*) filter (where v.input_snapshot_schema_version = 'v1') as seances_plan_v1,
    count(*) filter (where v.input_snapshot_schema_version = 'v2') as seances_plan_v2,
    count(*) filter (where v.id is null) as seances_hors_plan
  from affected a
  join public.planned_sessions p on p.athlete_id = a.athlete_id and p.planned_date between a.start_date - 7 and a.start_date - 1
  left join public.training_plan_versions v on v.id = p.source_plan_version_id
  group by a.id
)
select
  count(*) as courses_perdant_le_protocole,
  count(distinct a.athlete_id) as riders,
  count(distinct a.athlete_id) filter (where m.planning_model = 'v2') as riders_affectes_v2,
  count(*) filter (where a.start_date - current_date between 1 and 7) as courses_dans_7_jours,
  count(*) filter (where coalesce(w.seances_plan_v1, 0) > 0) as courses_avec_seances_plan_v1_a_t7_t1,
  count(*) filter (where coalesce(w.seances_plan_v2, 0) > 0) as courses_avec_seances_plan_v2_a_t7_t1,
  count(*) filter (where coalesce(w.seances_hors_plan, 0) > 0) as courses_avec_seances_hors_plan_a_t7_t1,
  count(*) filter (where w.race_id is null) as courses_sans_seance_a_t7_t1
from affected a
left join public.training_plan_model_assignments m on m.athlete_id = a.athlete_id
left join window_sessions w on w.race_id = a.id;

-- ---------------------------------------------------------------------------------------------------------------
-- Q3 — the same races, one line each, de-identified: which events change protocol after publication.
-- `rider` is an arbitrary number valid inside this result only (it links the races of one rider, nothing else).
-- ---------------------------------------------------------------------------------------------------------------
with affected as (
  select r.id, r.athlete_id, r.start_date, r.end_date, r.race_format::text as race_format, r.series, r.priority::text as priority, r.status::text as status
  from public.race_calendar r
  -- « is distinct from »: a NULL series must count as « not the explicit code » (a plain « = » would drop it).
  where ((r.race_format::text = 'HOT_TRAIL_2DAY' and r.series is distinct from 'HOT_TRAIL_SERIES')
      or (r.race_format::text = 'IXS_3DAY' and r.series is distinct from 'IXS'))
    and r.end_date >= current_date
    and r.status::text not in ('cancelled', 'skipped')
)
select
  dense_rank() over (order by a.athlete_id) as rider,
  a.start_date,
  a.end_date,
  a.end_date - a.start_date + 1 as jours,
  a.race_format,
  case
    when a.series is null then 'serie_null'
    when a.series in ('SWISS_OTHER', 'UCI_WORLD_CUP', 'UCI_WORLD_CHAMPS', 'FR_COUPE_DE_FRANCE_DH', 'FR_CHAMPIONNAT_DE_FRANCE_DH',
                      'FR_REGIONAL_DH', 'FR_OTHER_DH', 'OTHER', 'HOT_TRAIL_SERIES', 'IXS') then 'autre_code:' || a.series
    else 'texte_libre'
  end as serie,
  a.priority,
  a.status,
  a.start_date - current_date as jours_avant_debut,
  coalesce(m.planning_model, 'v1') as modele_prochaine_generation,
  (select count(*) from public.planned_sessions p left join public.training_plan_versions v on v.id = p.source_plan_version_id
    where p.athlete_id = a.athlete_id and p.planned_date between a.start_date - 7 and a.start_date - 1 and v.input_snapshot_schema_version = 'v1') as seances_v1_t7_t1,
  (select count(*) from public.planned_sessions p left join public.training_plan_versions v on v.id = p.source_plan_version_id
    where p.athlete_id = a.athlete_id and p.planned_date between a.start_date - 7 and a.start_date - 1 and v.input_snapshot_schema_version = 'v2') as seances_v2_t7_t1,
  (select count(*) from public.planned_sessions p left join public.training_plan_versions v on v.id = p.source_plan_version_id
    where p.athlete_id = a.athlete_id and p.planned_date between a.start_date - 7 and a.start_date - 1 and v.id is null) as seances_hors_plan_t7_t1
from affected a
left join public.training_plan_model_assignments m on m.athlete_id = a.athlete_id
order by a.start_date, rider;
