-- SPORT-RACE-01P.3 — read-only, aggregate only (no athlete identifier, no event name, no free text shown).
-- One statement, to be run by Louis in the production SQL editor if HPM wants the size of the compatibility change:
-- how many race_calendar rows hold HOT_TRAIL_2DAY / IXS_3DAY without the explicit series code (they lose the pre-event
-- protocol under the new contract until the rider names the competition), by state and whether they are still ahead.
select
  race_format::text as race_format,
  case
    when series is null then 'null'
    when series in ('HOT_TRAIL_SERIES', 'IXS', 'SWISS_OTHER', 'UCI_WORLD_CUP', 'UCI_WORLD_CHAMPS', 'FR_COUPE_DE_FRANCE_DH',
                    'FR_CHAMPIONNAT_DE_FRANCE_DH', 'FR_REGIONAL_DH', 'FR_OTHER_DH', 'OTHER') then 'code:' || series
    else 'free_text'
  end as series_state,
  (end_date >= current_date) as ends_today_or_later,
  status::text as status,
  count(*) as races,
  count(distinct athlete_id) as riders
from public.race_calendar
group by 1, 2, 3, 4
order by 1, 2, 3, 4;
