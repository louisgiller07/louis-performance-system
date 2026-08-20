-- M5_001A — persist_completed_session: RPC canonique pour l'auto-report
-- d'une séance complétée par l'athlète.
--
-- Voir docs/11_DECISION_LOG.md (2026-08-19 — M5_001A) pour le contexte
-- complet (audit M5_001, architecture cible browser JWT → future Edge
-- Function M5_003 → service_role → cette RPC → UPSERT).
--
-- Contrairement à persist_daily_run (decisions, append-only), cette
-- fonction gère une table UPSERT-shaped : UNIQUE (athlete_id, session_date)
-- existe déjà depuis le baseline (unique_completed_per_day) et n'est PAS
-- modifiée ici — un athlète ne peut reporter qu'une seule séance complétée
-- par jour ; un second appel pour le même jour met à jour la même ligne,
-- il n'en crée jamais une seconde.
--
-- Contrat de sécurité (identique en rigueur à persist_daily_run) :
--   - SECURITY INVOKER (pas DEFINER).
--   - EXECUTE réservé à service_role ; anon et authenticated explicitement
--     REVOKE. Jamais appelable directement depuis le navigateur — seule une
--     future Edge Function authentifiée (M5_003), après avoir résolu
--     l'athlete propre de l'appelant via RLS, pourra l'invoquer avec un
--     client service_role.
--   - p_athlete_id est l'UNIQUE source de vérité pour l'ownership de la
--     ligne. p_row.athlete_id est un champ interdit (voir le contrat
--     ci-dessous) — la redondance avec p_athlete_id est un risque
--     (incohérence possible) sans aucun bénéfice, donc simplement rejetée.
--   - session_load n'est JAMAIS lu depuis p_row et n'est JAMAIS écrit
--     explicitement par cette fonction — la colonne reste exclusivement
--     dérivée par le trigger existant trg_compute_session_load, qui se
--     déclenche correctement sur les deux branches d'un
--     INSERT ... ON CONFLICT ... DO UPDATE.
--   - Si decision_id (clé toujours requise, valeur nullable) est non-null,
--     il est validé DB-side avant toute écriture : la decision doit
--     appartenir à p_athlete_id ET sa decision_date doit être strictement
--     égale au session_date fourni. Aucune liaison vers la decision d'un
--     autre athlète, aucune liaison vers une decision d'une autre date.
--     Cette validation vit ici (dans la RPC), pas dans une future Edge
--     Function — la RPC est le seul point qui doit être fait confiance
--     pour l'intégrité des écritures.
--
-- planned_session_id est HORS PÉRIMÈTRE de ce contrat M5_001A — la RPC ne
-- l'accepte pas du tout (clé interdite, voir plus bas). Comportement exact :
--   - Sur un premier appel (INSERT) : la colonne n'est pas dans la liste de
--     colonnes de l'INSERT, elle prend donc son défaut colonne (NULL).
--   - Sur un appel suivant pour la même (athlete_id, session_date)
--     (branche UPDATE de l'upsert) : la colonne n'est PAS dans la clause
--     SET de l'UPDATE, donc sa valeur existante est préservée telle
--     quelle — jamais réinitialisée à NULL, jamais écrasée. C'est le
--     comportement natif de Postgres pour une colonne absente d'un SET
--     UPDATE, pas une règle codée explicitement ici.
--
-- ===========================================================================
-- CONTRAT D'UPDATE : FULL REPLACEMENT STRICT, pas PATCH.
-- ===========================================================================
--
-- p_row représente l'état complet du "snapshot éditable" de la séance
-- complétée à cet instant. Sur un upsert (deuxième appel même
-- athlete_id/session_date), CHAQUE champ éditable de p_row REMPLACE la
-- valeur existante, y compris vers NULL. Il n'existe aucun mécanisme de
-- "ne pas toucher ce champ" — un futur appelant qui veut conserver une
-- valeur doit la renvoyer explicitement à chaque appel.
--
-- "Strict" signifie concrètement :
--   1. Seul l'ensemble canonique de clés listé ci-dessous est accepté.
--      Toute clé inconnue (typo, champ retiré, champ pas encore prévu)
--      lève une exception — jamais silencieusement ignorée.
--   2. TOUTE clé du contrat DOIT être présente dans p_row à chaque appel,
--      y compris quand sa valeur est JSON null. Une clé absente n'est
--      JAMAIS interprétée comme "null" ou "ne pas toucher" — c'est
--      systématiquement une exception. Ceci est une protection délibérée
--      contre la perte de donnée silencieuse (typo de clé, champ oublié
--      dans un futur payload construit à la main) : un `decision_id` ou un
--      `new_pain` oublié ne peut plus jamais se comporter différemment
--      d'un `decision_id`/`new_pain` explicitement fourni.
--
-- Champs requis non-null (contrainte DB NOT NULL, doivent être fournis et
-- non-null) : session_date, session_type, completion_status, new_pain.
--
-- Champs requis mais nullable (la clé DOIT exister ; la valeur PEUT être
-- JSON null) : decision_id, actual_duration_min, rpe, main_content,
-- intervention, free_notes, post_leg_fatigue, post_grip_fatigue,
-- new_pain_note.
--
-- Clés explicitement interdites (jamais acceptées, exception dédiée) :
-- id, session_load, submitted_at, created_at, updated_at (toutes
-- gérées/dérivées par la DB), athlete_id (redondant avec p_athlete_id,
-- voir plus haut), planned_session_id (hors périmètre, voir plus haut).
--
-- Raison de FULL REPLACEMENT plutôt que PATCH (documenté ici, pas
-- seulement dans le decision log) : la future Edge Function M5_003
-- authentifie l'appelant et peut donc toujours reconstruire et envoyer la
-- forme canonique complète — un PATCH générique (fusion partielle côté
-- RPC) ajouterait de la complexité et de l'ambiguïté (quelle est la
-- sémantique d'un champ omis ? Toujours "ne pas toucher" ? Toujours
-- "remettre à NULL" ? Cela dépend du champ ?) pour un besoin qui n'existe
-- pas encore. Aucune API de patch générique n'est construite ici.

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
      'free_notes', 'post_leg_fatigue', 'post_grip_fatigue', 'new_pain_note'
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
    post_leg_fatigue, post_grip_fatigue, new_pain, new_pain_note, decision_id
  )
  values (
    p_athlete_id, v_session_date, v_session_type, v_completion_status,
    v_actual_duration_min, v_rpe, v_main_content, v_intervention, v_free_notes,
    v_post_leg_fatigue, v_post_grip_fatigue, v_new_pain, v_new_pain_note, v_decision_id
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
    decision_id = excluded.decision_id
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
