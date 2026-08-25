-- M5_006A — persist_pattern_evidence: atomic, append-only, concurrency-safe
-- RPC for writing one detector evidence observation. See
-- docs/11_DECISION_LOG.md (M5_006A) for the full design record.
--
-- Contrat de sécurité (même rigueur que persist_completed_session /
-- persist_decision_outcome) :
--   - SECURITY INVOKER (pas DEFINER).
--   - EXECUTE réservé à service_role ; anon et authenticated explicitement
--     REVOKE. Jamais appelable directement depuis le navigateur.
--   - p_athlete_id est l'unique source de vérité pour l'ownership.
--
-- ===========================================================================
-- p_provenance shape
-- ===========================================================================
-- A JSON array, each element a JSON OBJECT containing EXACTLY these three
-- keys, never more, never fewer, never the camelCase spelling:
-- { "role": text, "source_kind": text, "source_id": uuid }.
-- source_kind is exactly one of: "decision" | "completed_session" |
-- "daily_checkin" | "health_flag" | "decision_outcome" — mapping directly to
-- pattern_evidence_source_refs's five source_*_id columns. Any element that
-- is not a JSON object, or is an object with a different key set (missing a
-- required key, carrying an unrecognized extra key, or using the rejected
-- camelCase names sourceKind/sourceId), fails loudly BEFORE any write with
-- pattern_evidence_provenance_invalid_shape — never silently ignored,
-- never coerced.
--
-- ===========================================================================
-- Identity lock — concurrency design
-- ===========================================================================
-- A transaction-scoped advisory lock (pg_advisory_xact_lock, keyed by a hash
-- of the natural identity key: athlete_id/detector_rule_id/
-- detector_rule_version/evidence_key) serializes the entire critical section
-- for one logical identity — acquired before the identity insert-or-fetch,
-- released automatically when this call's transaction ends (never leaked,
-- never an explicit unlock). Two concurrent calls sharing the same natural
-- key block on this line until the first resolves. This replaces a row-lock
-- design (SELECT ... FOR UPDATE on the identity row) that empirically
-- requires the UPDATE table privilege in PostgreSQL regardless of whether
-- any column is ever written — directly incompatible with this same
-- migration's own least-privilege requirement (service_role never receives
-- UPDATE on pattern_evidence_identities) — see the inline comment at the
-- lock's call site for the full empirical account. The INSERT ... ON
-- CONFLICT ... DO NOTHING immediately after is itself also independently
-- concurrency-safe at the Postgres unique-index level (a second concurrent
-- inserter blocks until the first's transaction resolves), so both
-- mechanisms agree, layered rather than conflicting. No retry loop, no
-- application-side check-then-insert, no head-row-only locking (the
-- IDENTITY's natural key, not the latest revision, is the lock — a revision
-- may not exist yet at all for a brand-new identity).
--
-- ===========================================================================
-- Semantic equality — exact
-- ===========================================================================
-- The incoming call equals the CURRENT HEAD revision (never any older
-- revision) only when ALL of: event_type, event_date, observed_value
-- (native jsonb `=` — key-order-insensitive, array-order-sensitive, never a
-- hash/canonicalizer of any kind), and the provenance SET (role/source_kind/
-- source_id triples, order-independent) all match. Any difference anywhere
-- produces a new revision — this is precisely why `skipped -> done -> skipped`
-- produces three distinct revisions (1, 2, 3), never collapsing back to a
-- previously-seen value.
--
-- ===========================================================================
-- Provenance validation
-- ===========================================================================
-- Every provenance entry is validated BEFORE any write, in this order:
-- exact object shape — {role, source_kind, source_id}, nothing else
-- (pattern_evidence_provenance_invalid_shape) — then role non-blank
-- (<=64 chars), source_kind recognized, source_id a valid uuid, no
-- duplicate (role, source_kind, source_id) triple in the same call
-- (pattern_evidence_provenance_duplicate_payload), the referenced source row
-- must exist (pattern_evidence_provenance_source_missing) and belong to
-- p_athlete_id (pattern_evidence_provenance_cross_athlete) — RLS is NOT
-- sufficient here since this function runs as service_role. An empty
-- provenance array is rejected outright (pattern_evidence_provenance_empty).

create or replace function public.persist_pattern_evidence(
  p_athlete_id uuid,
  p_detector_rule_id text,
  p_detector_rule_version text,
  p_evaluation_key text,
  p_evidence_key text,
  p_event_type public.pattern_evidence_event_type,
  p_event_date date,
  p_observed_value jsonb,
  p_provenance jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_existing_evaluation_key text;

  v_head_id uuid;
  v_head_revision_number integer;
  v_head_event_type public.pattern_evidence_event_type;
  v_head_event_date date;
  v_head_observed_value jsonb;

  v_new_revision_id uuid;
  v_new_revision_number integer;

  v_provenance_item jsonb;
  v_provenance_keys text[];
  v_role text;
  v_source_kind text;
  v_source_id uuid;
  v_seen_triples text[] := array[]::text[];
  v_triple text;
  v_source_athlete_id uuid;

  v_current_provenance_sorted text[];
  v_new_provenance_sorted text[];
  v_provenance_changed boolean;
begin
  -----------------------------------------------------------------------
  -- Required scalar fields.
  -----------------------------------------------------------------------
  if p_athlete_id is null then
    raise exception 'persist_pattern_evidence: p_athlete_id is required';
  end if;
  if p_detector_rule_id is null or length(trim(p_detector_rule_id)) = 0 then
    raise exception 'persist_pattern_evidence: p_detector_rule_id is required and must be non-blank';
  end if;
  if p_detector_rule_version is null or length(trim(p_detector_rule_version)) = 0 then
    raise exception 'persist_pattern_evidence: p_detector_rule_version is required and must be non-blank';
  end if;
  if p_evaluation_key is null or length(trim(p_evaluation_key)) = 0 then
    raise exception 'persist_pattern_evidence: p_evaluation_key is required and must be non-blank';
  end if;
  if p_evidence_key is null or length(trim(p_evidence_key)) = 0 then
    raise exception 'persist_pattern_evidence: p_evidence_key is required and must be non-blank';
  end if;
  if p_event_type is null then
    raise exception 'persist_pattern_evidence: p_event_type is required';
  end if;
  if p_event_date is null then
    raise exception 'persist_pattern_evidence: p_event_date is required';
  end if;
  if p_observed_value is null or jsonb_typeof(p_observed_value) <> 'object' then
    raise exception 'persist_pattern_evidence: p_observed_value is required and must be a JSON object';
  end if;
  if p_provenance is null or jsonb_typeof(p_provenance) <> 'array' then
    raise exception 'persist_pattern_evidence: p_provenance is required and must be a JSON array';
  end if;
  if jsonb_array_length(p_provenance) = 0 then
    raise exception 'pattern_evidence_provenance_empty: p_provenance must contain at least one entry';
  end if;

  -----------------------------------------------------------------------
  -- Provenance validation pass — shape, duplicates, existence, ownership.
  -- No write has happened yet at this point.
  -----------------------------------------------------------------------
  for v_provenance_item in select * from jsonb_array_elements(p_provenance)
  loop
    -- Exact shape first: a JSON object with exactly {role, source_id, source_kind} as its key
    -- set (sorted) — never a scalar/array element, never missing a key, never an extra key,
    -- never the rejected camelCase sourceKind/sourceId spelling. This single structural check
    -- subsumes "missing role"/"missing source_kind"/"missing source_id"/"extra key"/"old
    -- camelCase payload"/"scalar element" — all of them necessarily fail this exact-key-set
    -- comparison.
    if jsonb_typeof(v_provenance_item) <> 'object' then
      raise exception 'pattern_evidence_provenance_invalid_shape: each provenance entry must be a JSON object, got %', jsonb_typeof(v_provenance_item);
    end if;

    select array_agg(k order by k) into v_provenance_keys from jsonb_object_keys(v_provenance_item) as k;
    if v_provenance_keys is distinct from array['role', 'source_id', 'source_kind'] then
      raise exception 'pattern_evidence_provenance_invalid_shape: each provenance entry must contain exactly the keys role, source_kind, source_id (got: %)',
        array_to_string(coalesce(v_provenance_keys, array[]::text[]), ', ');
    end if;

    v_role := v_provenance_item->>'role';
    if v_role is null or length(trim(v_role)) = 0 or length(v_role) > 64 then
      raise exception 'persist_pattern_evidence: each provenance entry requires a non-blank role of at most 64 characters';
    end if;

    v_source_kind := v_provenance_item->>'source_kind';
    if v_source_kind is null or length(trim(v_source_kind)) = 0 then
      raise exception 'persist_pattern_evidence: each provenance entry requires a non-blank source_kind';
    end if;

    begin
      v_source_id := (v_provenance_item->>'source_id')::uuid;
    exception when others then
      raise exception 'pattern_evidence_provenance_invalid_shape: provenance source_id "%" is not a valid uuid', v_provenance_item->>'source_id';
    end;
    if v_source_id is null then
      raise exception 'persist_pattern_evidence: each provenance entry requires source_id';
    end if;

    v_triple := v_role || '|' || v_source_kind || '|' || v_source_id::text;
    if v_triple = any(v_seen_triples) then
      raise exception 'pattern_evidence_provenance_duplicate_payload: duplicate provenance entry (role=%, source_kind=%, source_id=%)', v_role, v_source_kind, v_source_id;
    end if;
    v_seen_triples := array_append(v_seen_triples, v_triple);

    v_source_athlete_id := null;
    if v_source_kind = 'decision' then
      select athlete_id into v_source_athlete_id from public.decisions where id = v_source_id;
    elsif v_source_kind = 'completed_session' then
      select athlete_id into v_source_athlete_id from public.completed_sessions where id = v_source_id;
    elsif v_source_kind = 'daily_checkin' then
      select athlete_id into v_source_athlete_id from public.daily_checkins where id = v_source_id;
    elsif v_source_kind = 'health_flag' then
      select athlete_id into v_source_athlete_id from public.health_flags where id = v_source_id;
    elsif v_source_kind = 'decision_outcome' then
      select athlete_id into v_source_athlete_id from public.decision_outcomes where id = v_source_id;
    else
      raise exception 'persist_pattern_evidence: unrecognized provenance source_kind "%"', v_source_kind;
    end if;

    if v_source_athlete_id is null then
      raise exception 'pattern_evidence_provenance_source_missing: % % does not exist', v_source_kind, v_source_id;
    end if;
    if v_source_athlete_id <> p_athlete_id then
      raise exception 'pattern_evidence_provenance_cross_athlete: % % does not belong to athlete %', v_source_kind, v_source_id, p_athlete_id;
    end if;
  end loop;

  select array_agg(t order by t) into v_new_provenance_sorted from unnest(v_seen_triples) as t;

  -----------------------------------------------------------------------
  -- Identity lock — see module doc above for the full concurrency argument.
  --
  -- Implementation note: the lock spec's own architecture describes this as
  -- "SELECT identity FOR UPDATE" — empirically, that literal mechanism
  -- turned out to require the UPDATE table privilege in PostgreSQL (row
  -- locking is gated by UPDATE, not SELECT, regardless of whether any
  -- column is ever actually written), which directly conflicts with this
  -- same migration's own least-privilege requirement that service_role
  -- never receive UPDATE on this table. A transaction-scoped advisory lock
  -- (pg_advisory_xact_lock, released automatically at the end of this
  -- function call's enclosing transaction — never leaked, never requiring
  -- an explicit unlock) provides the exact same per-identity serialization
  -- guarantee without requiring any row-lock privilege at all: two
  -- concurrent calls sharing the same natural key
  -- (athlete_id, detector_rule_id, detector_rule_version, evidence_key)
  -- block on this line until the first caller's transaction resolves,
  -- identically to how the row-lock design would have serialized them.
  -- Acquired BEFORE the identity insert-or-fetch, so the entire
  -- identity-resolution + revision-allocation critical section below is
  -- covered, not merely the row read.
  --
  -- Tuple encoding: each component is length-prefixed ("<byteLength>:<value>")
  -- before concatenation, not simply pipe-joined — a plain
  -- `a || '|' || b || '|' || c || '|' || d` would let two DIFFERENT tuples
  -- produce the IDENTICAL pre-hash string whenever a '|' character appears
  -- inside detector_rule_id or detector_rule_version (e.g. detector_rule_id=
  -- "foo|bar", detector_rule_version="1.0.0" collides byte-for-byte with
  -- detector_rule_id="foo", detector_rule_version="bar|1.0.0") — a
  -- guaranteed, deterministic collision, not merely a probabilistic hash
  -- collision. Length-prefixing each component makes the encoding
  -- unambiguous for any possible field content, independent of whatever
  -- characters detector_rule_id/detector_rule_version/evidence_key happen to
  -- contain. A genuine 64-bit hash collision between two DIFFERENT
  -- unambiguous encodings remains theoretically possible (hashtextextended's
  -- range is finite) but is harmless here: its only effect would be
  -- unnecessary serialization between two unrelated identities, never
  -- incorrect data — the identity's own real uniqueness constraint
  -- (pattern_evidence_identities_unique_key) is the actual correctness
  -- guarantee; this lock only needs to be a reliable serialization point.
  -----------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended(
    length(p_athlete_id::text)::text || ':' || p_athlete_id::text
    || '|' || length(p_detector_rule_id)::text || ':' || p_detector_rule_id
    || '|' || length(p_detector_rule_version)::text || ':' || p_detector_rule_version
    || '|' || length(p_evidence_key)::text || ':' || p_evidence_key,
    0
  ));

  insert into public.pattern_evidence_identities (athlete_id, detector_rule_id, detector_rule_version, evaluation_key, evidence_key)
  values (p_athlete_id, p_detector_rule_id, p_detector_rule_version, p_evaluation_key, p_evidence_key)
  on conflict (athlete_id, detector_rule_id, detector_rule_version, evidence_key) do nothing;

  select id, evaluation_key
  into v_identity_id, v_existing_evaluation_key
  from public.pattern_evidence_identities
  where athlete_id = p_athlete_id
    and detector_rule_id = p_detector_rule_id
    and detector_rule_version = p_detector_rule_version
    and evidence_key = p_evidence_key;

  if v_identity_id is null then
    raise exception 'persist_pattern_evidence: internal error — identity row not found immediately after insert-or-fetch';
  end if;

  if v_existing_evaluation_key <> p_evaluation_key then
    raise exception 'pattern_evidence_evaluation_key_mismatch: identity % has evaluation_key %, but this call supplied %',
      v_identity_id, v_existing_evaluation_key, p_evaluation_key;
  end if;

  -----------------------------------------------------------------------
  -- Current head (if any) — everything from here on (head lookup, semantic
  -- equality comparison, revision allocation, and the provenance inserts
  -- further below) happens strictly while the transaction-scoped advisory
  -- lock acquired above is held.
  -----------------------------------------------------------------------
  select id, revision_number, event_type, event_date, observed_value
  into v_head_id, v_head_revision_number, v_head_event_type, v_head_event_date, v_head_observed_value
  from public.pattern_evidence_revisions
  where evidence_identity_id = v_identity_id
  order by revision_number desc
  limit 1;

  if v_head_id is not null then
    select array_agg(t order by t) into v_current_provenance_sorted
    from (
      select
        role || '|' ||
        (case
          when source_decision_id is not null then 'decision'
          when source_completed_session_id is not null then 'completed_session'
          when source_daily_checkin_id is not null then 'daily_checkin'
          when source_health_flag_id is not null then 'health_flag'
          when source_decision_outcome_id is not null then 'decision_outcome'
        end) || '|' ||
        coalesce(
          source_decision_id, source_completed_session_id, source_daily_checkin_id,
          source_health_flag_id, source_decision_outcome_id
        )::text as t
      from public.pattern_evidence_source_refs
      where revision_id = v_head_id
    ) s;

    v_provenance_changed := (v_current_provenance_sorted is distinct from v_new_provenance_sorted);

    if v_head_event_type = p_event_type
       and v_head_event_date = p_event_date
       and v_head_observed_value = p_observed_value
       and not v_provenance_changed
    then
      return jsonb_build_object(
        'identity_id', v_identity_id,
        'revision_id', v_head_id,
        'revision_number', v_head_revision_number,
        'action', 'unchanged'
      );
    end if;
  end if;

  -----------------------------------------------------------------------
  -- New revision — allocation is exclusively owned here, under the lock.
  -- trg_pattern_evidence_revisions_predecessor_check re-validates this same
  -- invariant independently at the schema layer (defense in depth).
  -----------------------------------------------------------------------
  v_new_revision_number := coalesce(v_head_revision_number, 0) + 1;

  insert into public.pattern_evidence_revisions (evidence_identity_id, revision_number, supersedes_id, event_type, event_date, observed_value)
  values (v_identity_id, v_new_revision_number, v_head_id, p_event_type, p_event_date, p_observed_value)
  returning id into v_new_revision_id;

  for v_provenance_item in select * from jsonb_array_elements(p_provenance)
  loop
    v_role := v_provenance_item->>'role';
    v_source_kind := v_provenance_item->>'source_kind';
    v_source_id := (v_provenance_item->>'source_id')::uuid;

    if v_source_kind = 'decision' then
      insert into public.pattern_evidence_source_refs (revision_id, role, source_decision_id) values (v_new_revision_id, v_role, v_source_id);
    elsif v_source_kind = 'completed_session' then
      insert into public.pattern_evidence_source_refs (revision_id, role, source_completed_session_id) values (v_new_revision_id, v_role, v_source_id);
    elsif v_source_kind = 'daily_checkin' then
      insert into public.pattern_evidence_source_refs (revision_id, role, source_daily_checkin_id) values (v_new_revision_id, v_role, v_source_id);
    elsif v_source_kind = 'health_flag' then
      insert into public.pattern_evidence_source_refs (revision_id, role, source_health_flag_id) values (v_new_revision_id, v_role, v_source_id);
    elsif v_source_kind = 'decision_outcome' then
      insert into public.pattern_evidence_source_refs (revision_id, role, source_decision_outcome_id) values (v_new_revision_id, v_role, v_source_id);
    end if;
  end loop;

  return jsonb_build_object(
    'identity_id', v_identity_id,
    'revision_id', v_new_revision_id,
    'revision_number', v_new_revision_number,
    'action', case when v_head_id is null then 'inserted' else 'superseded' end
  );
end;
$$;

revoke all on function public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb) from public;
revoke all on function public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb) from anon;
revoke all on function public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb) from authenticated;
grant execute on function public.persist_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb) to service_role;
