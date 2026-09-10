-- V0.3_007C — Athlete Debrief Fields
--
-- Voir docs/11_DECISION_LOG.md (V0.3_007C) pour le contexte complet.
--
-- Ajoute trois champs athlete-reported nullables à completed_sessions :
--   technical_outcome   — l'athlète a-t-il réussi la tâche technique
--                          PRESCRITE par la décision liée ? (yes/partial/no)
--   change_reason       — pourquoi la séance n'a pas été un DONE ordinaire
--                          (taxonomie structurée à choix unique)
--   change_reason_note  — précision optionnelle courte, liée sémantiquement
--                          à change_reason (distincte de free_notes)
--
-- Additif, non destructif : aucun backfill, toute row existante reste NULL
-- sur les trois champs. Aucune nouvelle table, planned_session_id reste
-- hors périmètre (inchangé). Ces champs sont délibérément inertes pour le
-- moteur (aucun consommateur RawContext/recentLoad/Safety/arbitrage) et
-- pour le longitudinal (aucun consommateur recommendationVsActualExecution/
-- pattern evidence) — voir docs/06_ARCHITECTURE.md §V0.3_007C.
--
-- Convention d'enum suivie : type nommé au singulier sans préfixe de table
-- (mêmes conventions que public.completion_status/public.session_type).

create type public.technical_outcome as enum ('yes', 'partial', 'no');

create type public.change_reason as enum (
  'coach_criterion',
  'fatigue_control',
  'pain',
  'mechanical',
  'weather_terrain',
  'time_life',
  'motivation',
  'activity_change',
  'other'
);

alter table public.completed_sessions
  add column technical_outcome public.technical_outcome null,
  add column change_reason public.change_reason null,
  add column change_reason_note text null;

-- ===========================================================================
-- persist_completed_session — étendu pour les 3 nouveaux champs.
-- ===========================================================================
--
-- Les 3 nouveaux champs sont la SEULE exception au contrat FULL REPLACEMENT
-- strict existant : la clé PEUT être absente (rollout-safety, voir
-- docs/11_DECISION_LOG.md V0.3_007C — "ROLLOUT COMPATIBILITY GATE").
-- Absence prouvée empiriquement dangereuse à interdire : un Edge Function
-- completed-session pré-007C actuellement déployé ne connaît pas ces trois
-- clés et ne les enverra jamais — si cette RPC les exigeait présentes, la
-- fenêtre entre le déploiement de CETTE migration et le déploiement du
-- nouvel Edge Function casserait purement et simplement tout enregistrement
-- de séance complétée en production. Absente → NULL (même résultat qu'un
-- JSON null explicite). Présente (y compris JSON null explicite) → castée/
-- validée normalement. Toutes les autres clés du contrat restent aussi
-- strictes qu'avant (présence obligatoire) — cette exception est
-- délibérément scopée à exactement ces 3 champs nouvellement introduits,
-- jamais généralisée.
--
-- Ordre de déploiement sûr rendu possible par ce choix : 1) cette migration
-- (RPC mise à jour) ; l'Edge Function pré-007C actuellement déployée
-- continue d'écrire sans erreur (clés absentes → NULL) ; 2) nouvel Edge
-- Function 007C (envoie les 3 clés) ; 3) nouveau web. Un onglet web resté
-- ouvert sur un ancien bundle pendant/après ce rollout continue également
-- de fonctionner (l'Edge Function, pas seulement la RPC, normalise déjà
-- l'absence en NULL — voir validation.ts).
--
-- Aucune validation de cohérence métier (ex. "technical_outcome exige
-- decision_id non-null", "change_reason='coach_criterion' exige
-- decision_id non-null") n'est ajoutée ICI — cette frontière reste, comme
-- pour le reste du contrat M5_003/V0.3_007B, la responsabilité de l'Edge
-- Function (supabase/functions/completed-session/validation.ts), jamais de
-- cette RPC. La RPC ne valide que l'intégrité structurelle (clés
-- acceptées, ownership/date de decision_id).

create or replace function public.persist_completed_session(
  p_athlete_id uuid,
  p_row jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key text;
  v_id uuid;

  v_session_date date;
  v_session_type public.session_type;
  v_completion_status public.completion_status;
  v_new_pain boolean;

  v_decision_id uuid;
  v_actual_duration_min integer;
  v_rpe integer;
  v_main_content jsonb;
  v_intervention jsonb;
  v_free_notes text;
  v_post_leg_fatigue integer;
  v_post_grip_fatigue integer;
  v_new_pain_note text;
  v_technical_outcome public.technical_outcome;
  v_change_reason public.change_reason;
  v_change_reason_note text;

  v_decision_athlete_id uuid;
  v_decision_date date;
begin
  if p_row is null then
    raise exception 'persist_completed_session: p_row is required';
  end if;

  -----------------------------------------------------------------------
  -- Explicitly forbidden keys — dedicated messages (typo/data-loss
  -- protection is easier to diagnose with a specific reason than a
  -- generic "unknown key").
  -----------------------------------------------------------------------
  if p_row ? 'id' then
    raise exception 'persist_completed_session: p_row.id is not accepted (DB-managed identity)';
  end if;
  if p_row ? 'session_load' then
    raise exception 'persist_completed_session: p_row.session_load is not accepted (trigger-derived, never client-supplied)';
  end if;
  if p_row ? 'submitted_at' then
    raise exception 'persist_completed_session: p_row.submitted_at is not accepted (DB-managed, fixed at first insert)';
  end if;
  if p_row ? 'created_at' then
    raise exception 'persist_completed_session: p_row.created_at is not accepted (DB-managed)';
  end if;
  if p_row ? 'updated_at' then
    raise exception 'persist_completed_session: p_row.updated_at is not accepted (DB-managed, trigger-maintained)';
  end if;
  if p_row ? 'athlete_id' then
    raise exception 'persist_completed_session: p_row.athlete_id is not accepted — ownership comes exclusively from p_athlete_id';
  end if;
  if p_row ? 'planned_session_id' then
    raise exception 'persist_completed_session: p_row.planned_session_id is not accepted (outside the M5_001A contract; the existing value, if any, is always preserved untouched)';
  end if;

  -----------------------------------------------------------------------
  -- Any other unknown/typoed key is rejected — only the canonical set
  -- below is accepted (full replacement, strict).
  -----------------------------------------------------------------------
  for v_key in select jsonb_object_keys(p_row) loop
    if v_key <> all (array[
      'session_date', 'session_type', 'completion_status', 'new_pain',
      'decision_id', 'actual_duration_min', 'rpe', 'main_content', 'intervention',
      'free_notes', 'post_leg_fatigue', 'post_grip_fatigue', 'new_pain_note',
      'technical_outcome', 'change_reason', 'change_reason_note'
    ]) then
      raise exception 'persist_completed_session: unknown key "%" in p_row', v_key;
    end if;
  end loop;

  -----------------------------------------------------------------------
  -- Required, non-null fields.
  -----------------------------------------------------------------------
  if not (p_row ? 'session_date') or (p_row->>'session_date') is null then
    raise exception 'persist_completed_session: p_row.session_date is required and must not be null';
  end if;
  v_session_date := (p_row->>'session_date')::date;

  if not (p_row ? 'session_type') or (p_row->>'session_type') is null then
    raise exception 'persist_completed_session: p_row.session_type is required and must not be null';
  end if;
  v_session_type := (p_row->>'session_type')::public.session_type;

  if not (p_row ? 'completion_status') or (p_row->>'completion_status') is null then
    raise exception 'persist_completed_session: p_row.completion_status is required and must not be null';
  end if;
  v_completion_status := (p_row->>'completion_status')::public.completion_status;

  -- new_pain: health/safety field (same family as daily_checkins.pain,
  -- whose silent omission already caused a real bug elsewhere in this
  -- project — see the M4_003 check-in bugfix in docs/11_DECISION_LOG.md).
  -- The DB column is NOT NULL DEFAULT false (no tri-state representation
  -- possible at the SQL level), but this RPC never accepts a missing or
  -- null value as an implicit "false".
  if not (p_row ? 'new_pain') or (p_row->>'new_pain') is null then
    raise exception 'persist_completed_session: p_row.new_pain is required and must not be null';
  end if;
  v_new_pain := (p_row->>'new_pain')::boolean;

  -----------------------------------------------------------------------
  -- Required-present, nullable fields — the key MUST exist; the value MAY
  -- be JSON null. A missing key is always an exception, never treated as
  -- an implicit null.
  -----------------------------------------------------------------------
  if not (p_row ? 'decision_id') then
    raise exception 'persist_completed_session: p_row.decision_id key is required (uuid or explicit null)';
  end if;
  if not (p_row ? 'actual_duration_min') then
    raise exception 'persist_completed_session: p_row.actual_duration_min key is required (integer or explicit null)';
  end if;
  if not (p_row ? 'rpe') then
    raise exception 'persist_completed_session: p_row.rpe key is required (integer or explicit null)';
  end if;
  if not (p_row ? 'main_content') then
    raise exception 'persist_completed_session: p_row.main_content key is required (object or explicit null)';
  end if;
  if not (p_row ? 'intervention') then
    raise exception 'persist_completed_session: p_row.intervention key is required (object or explicit null)';
  end if;
  if not (p_row ? 'free_notes') then
    raise exception 'persist_completed_session: p_row.free_notes key is required (text or explicit null)';
  end if;
  if not (p_row ? 'post_leg_fatigue') then
    raise exception 'persist_completed_session: p_row.post_leg_fatigue key is required (integer or explicit null)';
  end if;
  if not (p_row ? 'post_grip_fatigue') then
    raise exception 'persist_completed_session: p_row.post_grip_fatigue key is required (integer or explicit null)';
  end if;
  if not (p_row ? 'new_pain_note') then
    raise exception 'persist_completed_session: p_row.new_pain_note key is required (text or explicit null)';
  end if;

  v_actual_duration_min := (p_row->>'actual_duration_min')::integer;
  v_rpe := (p_row->>'rpe')::integer;
  v_main_content := p_row->'main_content';
  v_intervention := p_row->'intervention';
  v_free_notes := p_row->>'free_notes';
  v_post_leg_fatigue := (p_row->>'post_leg_fatigue')::integer;
  v_post_grip_fatigue := (p_row->>'post_grip_fatigue')::integer;
  v_new_pain_note := p_row->>'new_pain_note';

  -----------------------------------------------------------------------
  -- technical_outcome / change_reason / change_reason_note — the ONLY
  -- keys in this contract that may be ABSENT. See the module doc above
  -- (rollout-safety). Absent -> NULL; present (including JSON null) ->
  -- cast/read normally, identical to every other field's treatment.
  -----------------------------------------------------------------------
  if p_row ? 'technical_outcome' then
    v_technical_outcome := (p_row->>'technical_outcome')::public.technical_outcome;
  else
    v_technical_outcome := null;
  end if;

  if p_row ? 'change_reason' then
    v_change_reason := (p_row->>'change_reason')::public.change_reason;
  else
    v_change_reason := null;
  end if;

  if p_row ? 'change_reason_note' then
    v_change_reason_note := p_row->>'change_reason_note';
  else
    v_change_reason_note := null;
  end if;

  -----------------------------------------------------------------------
  -- decision_id integrity (value-level, key presence already enforced
  -- above): same athlete, same date as session_date.
  -----------------------------------------------------------------------
  if (p_row->>'decision_id') is not null then
    v_decision_id := (p_row->>'decision_id')::uuid;

    select athlete_id, decision_date
    into v_decision_athlete_id, v_decision_date
    from public.decisions
    where id = v_decision_id;

    if not found then
      raise exception 'persist_completed_session: decision_id % does not exist', v_decision_id;
    end if;

    if v_decision_athlete_id <> p_athlete_id then
      raise exception 'persist_completed_session: decision_id % does not belong to athlete %', v_decision_id, p_athlete_id;
    end if;

    if v_decision_date <> v_session_date then
      raise exception 'persist_completed_session: decision_id % decision_date (%) does not match session_date (%)',
        v_decision_id, v_decision_date, v_session_date;
    end if;
  else
    v_decision_id := null;
  end if;

  -----------------------------------------------------------------------
  -- UPSERT on the existing unique_completed_per_day (athlete_id, session_date).
  -- session_load is never in this column list — trg_compute_session_load
  -- derives it on both the INSERT and the DO UPDATE branch.
  -- planned_session_id is never in this column list either — absent from
  -- the INSERT (takes its column default, NULL) and absent from the
  -- DO UPDATE SET clause (Postgres leaves an unlisted column untouched on
  -- UPDATE, so any existing value is preserved automatically).
  -----------------------------------------------------------------------
  insert into public.completed_sessions (
    athlete_id, session_date, session_type, completion_status,
    actual_duration_min, rpe, main_content, intervention, free_notes,
    post_leg_fatigue, post_grip_fatigue, new_pain, new_pain_note, decision_id,
    technical_outcome, change_reason, change_reason_note
  )
  values (
    p_athlete_id, v_session_date, v_session_type, v_completion_status,
    v_actual_duration_min, v_rpe, v_main_content, v_intervention, v_free_notes,
    v_post_leg_fatigue, v_post_grip_fatigue, v_new_pain, v_new_pain_note, v_decision_id,
    v_technical_outcome, v_change_reason, v_change_reason_note
  )
  on conflict (athlete_id, session_date) do update set
    session_type = excluded.session_type,
    completion_status = excluded.completion_status,
    actual_duration_min = excluded.actual_duration_min,
    rpe = excluded.rpe,
    main_content = excluded.main_content,
    intervention = excluded.intervention,
    free_notes = excluded.free_notes,
    post_leg_fatigue = excluded.post_leg_fatigue,
    post_grip_fatigue = excluded.post_grip_fatigue,
    new_pain = excluded.new_pain,
    new_pain_note = excluded.new_pain_note,
    decision_id = excluded.decision_id,
    technical_outcome = excluded.technical_outcome,
    change_reason = excluded.change_reason,
    change_reason_note = excluded.change_reason_note
    -- submitted_at intentionally absent: keeps its original first-submission
    -- value across updates. updated_at is auto-maintained separately by
    -- trg_completed_sessions_updated_at. planned_session_id intentionally
    -- absent: see module doc above.
  returning id into v_id;

  -- Minimal, stable response — the caller does not need to distinguish
  -- INSERT from UPDATE (no xmax-based "created" flag exposed).
  return jsonb_build_object('completed_session_id', v_id);
end;
$$;

revoke all on function public.persist_completed_session(uuid, jsonb) from public;
revoke all on function public.persist_completed_session(uuid, jsonb) from anon;
revoke all on function public.persist_completed_session(uuid, jsonb) from authenticated;
grant execute on function public.persist_completed_session(uuid, jsonb) to service_role;
