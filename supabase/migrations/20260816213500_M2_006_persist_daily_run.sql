-- M2_006 — persist_daily_run: écriture atomique health_flag + decisions
--
-- Voir docs/06_ARCHITECTURE.md §Persistance idempotente + atomique et
-- docs/11_DECISION_LOG.md (2026-08-13/14 — persistance atomique via RPC,
-- contrat de sécurité de la RPC).
--
-- Pur enregistreur transactionnel : aucune logique de coaching, aucune
-- décision métier, aucune transformation qualitatif → numérique. Les deux
-- payloads (p_health_flag, p_decision_row) sont déjà calculés/normalisés
-- par l'application (dailyPlanToDecisionRow.ts côté DAL) ; cette fonction
-- ne fait que les valider structurellement puis les persister.
--
-- Atomicité : une FUNCTION PostgreSQL s'exécute intrinsèquement dans une
-- transaction unique. Aucun COMMIT/ROLLBACK explicite (invalide dans une
-- FUNCTION). Toute exception non interceptée annule les deux écritures de
-- cet appel.
--
-- Idempotence health_flag : repose sur l'index unique partiel M2_005
-- (health_flags_open_unique) via INSERT ... ON CONFLICT (athlete_id,
-- flag_type) WHERE status IN ('active','monitoring') DO NOTHING, avec
-- fallback SELECT ... FOR UPDATE du flag ouvert existant si le conflit
-- s'est produit, dans une boucle de retry : si le flag qui a causé le
-- conflit est résolu par une transaction concurrente entre notre INSERT et
-- notre SELECT, ce SELECT peut ne plus rien trouver (0 ligne) — la boucle
-- retente alors l'INSERT (qui réussira désormais, l'index partiel ne
-- couvrant plus aucune ligne) plutôt que de retourner health_flag_id NULL
-- alors que p_health_flag était fourni. Chaque itération du LOOP est une
-- nouvelle instruction PL/pgSQL : sous READ COMMITTED (isolation par
-- défaut), chaque instruction prend un nouveau snapshot des lignes
-- committées, donc l'INSERT retenté voit bien l'état résolu. Le FOR UPDATE
-- verrouille la ligne trouvée pour la durée de la transaction appelante,
-- empêchant une résolution concurrente de l'invalider entre notre lecture
-- et notre retour. `status` n'est jamais fixé explicitement par cette fonction : la colonne
-- health_flags.status a déjà pour DEFAULT 'active' dans le schéma existant
-- (baseline V0.2) — on laisse ce default s'appliquer, exactement comme
-- pour decisions.overridden_by_user en M2_002/M2_003, plutôt que de coder
-- une règle "les nouveaux flags sont actifs" en SQL.
--
-- decisions reste append-only : chaque appel valide insère une nouvelle
-- row. Ni `confidence` (legacy numeric) ni `overridden_by_user` ni
-- `triggered_rules` ne sont dans la liste de colonnes de l'INSERT — leurs
-- DEFAULT/NULL respectifs s'appliquent naturellement (aucune de ces trois
-- colonnes ne fait partie du DecisionInsertRow produit par
-- dailyPlanToDecisionRow.ts). `stop_conditions` est explicitement forcé à
-- NULL par cette fonction (jamais dérivé du payload), conformément à
-- docs/05_DATA_MODEL.md §decisions.

create or replace function public.persist_daily_run(
  p_athlete_id uuid,
  p_health_flag jsonb,
  p_decision_row jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_health_flag_id uuid := null;
  v_decision_id uuid;

  -- health_flag payload (validated fields only — no coaching, no derived rules)
  v_flag_type public.health_flag_type;
  v_flag_date date;
  v_description text;
  v_source_checkin_id uuid;

  -- decision payload (validated fields only)
  v_row_athlete_id uuid;
  v_decision_date date;
  v_planned_session_before public.session_type;
  v_final_session public.session_type;
  v_reason text;
  v_do_not_do jsonb;
  v_override_reason text;
  v_engine_version text;
  v_daily_plan jsonb;
  v_active_mode public.training_mode;
  v_confidence_level public.confidence_level;
begin
  -----------------------------------------------------------------------
  -- 1. Health flag (optional) — ensure-open, idempotent via M2_005 index
  -----------------------------------------------------------------------
  if p_health_flag is not null then
    if not (p_health_flag ? 'flag_type') or (p_health_flag->>'flag_type') is null then
      raise exception 'persist_daily_run: p_health_flag.flag_type is required';
    end if;
    v_flag_type := (p_health_flag->>'flag_type')::public.health_flag_type;

    if not (p_health_flag ? 'flag_date') or (p_health_flag->>'flag_date') is null then
      raise exception 'persist_daily_run: p_health_flag.flag_date is required';
    end if;
    v_flag_date := (p_health_flag->>'flag_date')::date;

    if not (p_health_flag ? 'description') or (p_health_flag->>'description') is null then
      raise exception 'persist_daily_run: p_health_flag.description is required';
    end if;
    v_description := p_health_flag->>'description';

    if (p_health_flag ? 'source_checkin_id') and (p_health_flag->>'source_checkin_id') is not null then
      v_source_checkin_id := (p_health_flag->>'source_checkin_id')::uuid;
    else
      v_source_checkin_id := null;
    end if;

    loop
      v_health_flag_id := null;

      insert into public.health_flags (athlete_id, flag_date, flag_type, description, source_checkin_id)
      values (p_athlete_id, v_flag_date, v_flag_type, v_description, v_source_checkin_id)
      on conflict (athlete_id, flag_type) where status in ('active', 'monitoring')
      do nothing
      returning id into v_health_flag_id;

      exit when v_health_flag_id is not null;

      select id
      into v_health_flag_id
      from public.health_flags
      where athlete_id = p_athlete_id
        and flag_type = v_flag_type
        and status in ('active', 'monitoring')
      limit 1
      for update;

      exit when v_health_flag_id is not null;

      -- Le flag qui a causé le conflit a été résolu par une transaction
      -- concurrente entre notre INSERT et notre SELECT : plus aucune ligne
      -- ouverte ne couvre (athlete_id, flag_type). On retente l'INSERT.
    end loop;
  end if;

  -----------------------------------------------------------------------
  -- 2. Decision (mandatory) — append-only insert
  -----------------------------------------------------------------------
  if p_decision_row is null then
    raise exception 'persist_daily_run: p_decision_row is required';
  end if;

  if (p_decision_row ? 'athlete_id') and (p_decision_row->>'athlete_id') is not null then
    v_row_athlete_id := (p_decision_row->>'athlete_id')::uuid;
    if v_row_athlete_id <> p_athlete_id then
      raise exception 'persist_daily_run: p_decision_row.athlete_id (%) does not match p_athlete_id (%)',
        v_row_athlete_id, p_athlete_id;
    end if;
  end if;

  if not (p_decision_row ? 'decision_date') or (p_decision_row->>'decision_date') is null then
    raise exception 'persist_daily_run: p_decision_row.decision_date is required';
  end if;
  v_decision_date := (p_decision_row->>'decision_date')::date;

  if (p_decision_row ? 'planned_session_before') and (p_decision_row->>'planned_session_before') is not null then
    v_planned_session_before := (p_decision_row->>'planned_session_before')::public.session_type;
  else
    v_planned_session_before := null;
  end if;

  if not (p_decision_row ? 'final_session') or (p_decision_row->>'final_session') is null then
    raise exception 'persist_daily_run: p_decision_row.final_session is required';
  end if;
  v_final_session := (p_decision_row->>'final_session')::public.session_type;

  if not (p_decision_row ? 'reason') or (p_decision_row->>'reason') is null then
    raise exception 'persist_daily_run: p_decision_row.reason is required';
  end if;
  v_reason := p_decision_row->>'reason';

  v_do_not_do := p_decision_row->'do_not_do';
  v_override_reason := p_decision_row->>'override_reason';

  if not (p_decision_row ? 'engine_version') or (p_decision_row->>'engine_version') is null then
    raise exception 'persist_daily_run: p_decision_row.engine_version is required';
  end if;
  v_engine_version := p_decision_row->>'engine_version';

  if not (p_decision_row ? 'daily_plan')
     or (p_decision_row->'daily_plan') is null
     or (p_decision_row->'daily_plan') = 'null'::jsonb
     or jsonb_typeof(p_decision_row->'daily_plan') <> 'object' then
    raise exception 'persist_daily_run: p_decision_row.daily_plan must be a non-null JSON object';
  end if;
  v_daily_plan := p_decision_row->'daily_plan';

  if not (p_decision_row ? 'active_mode') or (p_decision_row->>'active_mode') is null then
    raise exception 'persist_daily_run: p_decision_row.active_mode is required';
  end if;
  v_active_mode := (p_decision_row->>'active_mode')::public.training_mode;

  if not (p_decision_row ? 'confidence_level') or (p_decision_row->>'confidence_level') is null then
    raise exception 'persist_daily_run: p_decision_row.confidence_level is required';
  end if;
  v_confidence_level := (p_decision_row->>'confidence_level')::public.confidence_level;

  -- confidence (legacy numeric), overridden_by_user and triggered_rules are
  -- intentionally absent from this column list: their DEFAULT/NULL applies.
  insert into public.decisions (
    athlete_id, decision_date, planned_session_before, final_session, reason,
    do_not_do, override_reason, engine_version, stop_conditions,
    daily_plan, active_mode, confidence_level
  )
  values (
    p_athlete_id, v_decision_date, v_planned_session_before, v_final_session, v_reason,
    v_do_not_do, v_override_reason, v_engine_version, null,
    v_daily_plan, v_active_mode, v_confidence_level
  )
  returning id into v_decision_id;

  return jsonb_build_object('decision_id', v_decision_id, 'health_flag_id', v_health_flag_id);
end;
$$;

revoke all on function public.persist_daily_run(uuid, jsonb, jsonb) from public;
revoke all on function public.persist_daily_run(uuid, jsonb, jsonb) from anon;
revoke all on function public.persist_daily_run(uuid, jsonb, jsonb) from authenticated;
grant execute on function public.persist_daily_run(uuid, jsonb, jsonb) to service_role;
