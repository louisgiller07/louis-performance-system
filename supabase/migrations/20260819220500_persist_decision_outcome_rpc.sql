-- M5_001B — persist_decision_outcome: RPC canonique, append-only, pour
-- écrire une observation d'issue de decision.
--
-- Voir docs/11_DECISION_LOG.md (2026-08-19 — M5_001B).
--
-- Contrat de sécurité (même rigueur que persist_daily_run et
-- persist_completed_session) :
--   - SECURITY INVOKER (pas DEFINER).
--   - EXECUTE réservé à service_role ; anon et authenticated explicitement
--     REVOKE. Jamais appelable directement depuis le navigateur.
--   - p_athlete_id est l'UNIQUE source de vérité pour l'ownership —
--     `athlete_id` est une clé interdite dans p_row (même choix que
--     persist_completed_session : redondance avec p_athlete_id sans
--     bénéfice, source de confusion possible).
--
-- Contrat de payload — FULL REPLACEMENT strict, ensemble canonique fermé,
-- toutes les clés requises (aucune n'est optionnelle ici, contrairement à
-- persist_completed_session : cette table n'a aucun champ auto-reporté par
-- l'athlète, tout provient d'un calculateur qui connaît déjà chaque
-- valeur) :
--   decision_id, horizon, calculator_id, calculator_version,
--   input_snapshot, outcome_signals.
-- Clés interdites, chacune avec message dédié : id, athlete_id, created_at,
-- calculated_at (toutes gérées par la DB — calculated_at prend
-- systématiquement la valeur DEFAULT now() de la colonne, jamais une valeur
-- fournie par l'appelant, pour la même raison que created_at ne l'est
-- jamais ailleurs dans ce schéma).
--
-- Validation d'ownership : decision_id doit exister ET appartenir à
-- p_athlete_id (la FK decision_outcomes_decision_id_fkey garantit que
-- decision_id référence une vraie ligne decisions ; cette RPC valide en
-- plus, ce qu'une FK seule ne peut pas exprimer, que cette ligne appartient
-- bien à l'athlete appelant).
--
-- ===========================================================================
-- Idempotence / conflit — sémantique exacte
-- ===========================================================================
-- Clé d'unicité (contrainte DB decision_outcomes_unique_key) :
--   (athlete_id, decision_id, horizon, calculator_id, calculator_version)
--
--   1. Aucune ligne existante pour cette clé -> INSERT, nouvel id retourné.
--   2. Une ligne existe déjà pour cette clé, ET son input_snapshot ET son
--      outcome_signals sont jsonb-égaux (égalité profonde, insensible à
--      l'ordre des clés — propriété native du type jsonb en PostgreSQL,
--      pas une comparaison textuelle) au payload actuel -> AUCUNE écriture,
--      l'id de la ligne existante est retourné tel quel (rejeu exact
--      idempotent, jamais de doublon).
--   3. Une ligne existe déjà pour cette clé, mais son input_snapshot ou son
--      outcome_signals DIFFÈRE du payload actuel -> exception. Jamais
--      d'UPDATE silencieux : la même (decision, horizon, calculator_id,
--      calculator_version) ne peut jamais produire deux vérités
--      différentes. Un calculateur corrigé doit émettre un nouveau
--      calculator_version, qui crée alors une nouvelle ligne immuable
--      distincte (les anciennes lignes ne sont jamais modifiées).
--
-- Sécurité de concurrence : le chemin rapide (1) fait d'abord un SELECT
-- pour éviter de payer le coût d'une exception dans le cas normal, mais
-- deux appels concurrents identiques pourraient tous les deux passer ce
-- SELECT avant que l'un des deux n'ait inséré. L'INSERT est donc entouré
-- d'un bloc BEGIN/EXCEPTION WHEN unique_violation qui relit la ligne
-- désormais existante et applique exactement la même logique
-- égalité-ou-conflit — l'idempotence tient donc aussi sous concurrence
-- réelle, pas seulement en séquentiel.
--
-- Aucun UPDATE n'existe nulle part dans cette fonction — l'immutabilité
-- n'est pas qu'une discipline de code, elle est aussi imposée au niveau
-- GRANT (service_role n'a pas le privilège UPDATE sur cette table, voir la
-- migration précédente).

create or replace function public.persist_decision_outcome(
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

  v_decision_id uuid;
  v_horizon public.decision_outcome_horizon;
  v_calculator_id text;
  v_calculator_version text;
  v_input_snapshot jsonb;
  v_outcome_signals jsonb;

  v_decision_athlete_id uuid;

  v_existing_id uuid;
  v_existing_input_snapshot jsonb;
  v_existing_outcome_signals jsonb;
begin
  if p_row is null then
    raise exception 'persist_decision_outcome: p_row is required';
  end if;

  -----------------------------------------------------------------------
  -- Explicitly forbidden keys — dedicated messages.
  -----------------------------------------------------------------------
  if p_row ? 'id' then
    raise exception 'persist_decision_outcome: p_row.id is not accepted (DB-managed identity)';
  end if;
  if p_row ? 'athlete_id' then
    raise exception 'persist_decision_outcome: p_row.athlete_id is not accepted — ownership comes exclusively from p_athlete_id';
  end if;
  if p_row ? 'created_at' then
    raise exception 'persist_decision_outcome: p_row.created_at is not accepted (DB-managed)';
  end if;
  if p_row ? 'calculated_at' then
    raise exception 'persist_decision_outcome: p_row.calculated_at is not accepted (DB-managed, always DEFAULT now())';
  end if;

  -----------------------------------------------------------------------
  -- Any other unknown/typoed key is rejected — only the canonical set
  -- below is accepted.
  -----------------------------------------------------------------------
  for v_key in select jsonb_object_keys(p_row) loop
    if v_key <> all (array[
      'decision_id', 'horizon', 'calculator_id', 'calculator_version',
      'input_snapshot', 'outcome_signals'
    ]) then
      raise exception 'persist_decision_outcome: unknown key "%" in p_row', v_key;
    end if;
  end loop;

  -----------------------------------------------------------------------
  -- Required fields — every canonical key must be present and non-null.
  -----------------------------------------------------------------------
  if not (p_row ? 'decision_id') or (p_row->>'decision_id') is null then
    raise exception 'persist_decision_outcome: p_row.decision_id is required and must not be null';
  end if;
  v_decision_id := (p_row->>'decision_id')::uuid;

  if not (p_row ? 'horizon') or (p_row->>'horizon') is null then
    raise exception 'persist_decision_outcome: p_row.horizon is required and must not be null';
  end if;
  v_horizon := (p_row->>'horizon')::public.decision_outcome_horizon;

  if not (p_row ? 'calculator_id') or (p_row->>'calculator_id') is null or length(trim(p_row->>'calculator_id')) = 0 then
    raise exception 'persist_decision_outcome: p_row.calculator_id is required and must be non-blank';
  end if;
  v_calculator_id := p_row->>'calculator_id';

  if not (p_row ? 'calculator_version') or (p_row->>'calculator_version') is null or length(trim(p_row->>'calculator_version')) = 0 then
    raise exception 'persist_decision_outcome: p_row.calculator_version is required and must be non-blank';
  end if;
  v_calculator_version := p_row->>'calculator_version';

  if not (p_row ? 'input_snapshot') or (p_row->'input_snapshot') is null or jsonb_typeof(p_row->'input_snapshot') <> 'object' then
    raise exception 'persist_decision_outcome: p_row.input_snapshot is required and must be a JSON object';
  end if;
  v_input_snapshot := p_row->'input_snapshot';

  if not (p_row ? 'outcome_signals') or (p_row->'outcome_signals') is null or jsonb_typeof(p_row->'outcome_signals') <> 'object' then
    raise exception 'persist_decision_outcome: p_row.outcome_signals is required and must be a JSON object';
  end if;
  v_outcome_signals := p_row->'outcome_signals';

  -----------------------------------------------------------------------
  -- Ownership integrity: decision_id must exist and belong to p_athlete_id.
  -----------------------------------------------------------------------
  select athlete_id into v_decision_athlete_id
  from public.decisions
  where id = v_decision_id;

  if not found then
    raise exception 'persist_decision_outcome: decision_id % does not exist', v_decision_id;
  end if;

  if v_decision_athlete_id <> p_athlete_id then
    raise exception 'persist_decision_outcome: decision_id % does not belong to athlete %', v_decision_id, p_athlete_id;
  end if;

  -----------------------------------------------------------------------
  -- Idempotency fast path: does this exact uniqueness key already exist?
  -----------------------------------------------------------------------
  select id, input_snapshot, outcome_signals
  into v_existing_id, v_existing_input_snapshot, v_existing_outcome_signals
  from public.decision_outcomes
  where athlete_id = p_athlete_id
    and decision_id = v_decision_id
    and horizon = v_horizon
    and calculator_id = v_calculator_id
    and calculator_version = v_calculator_version;

  if found then
    if v_existing_input_snapshot = v_input_snapshot and v_existing_outcome_signals = v_outcome_signals then
      return jsonb_build_object('decision_outcome_id', v_existing_id);
    end if;

    raise exception 'persist_decision_outcome: conflicting outcome already exists for athlete %, decision %, horizon %, calculator %/% (existing id=%) with different content — outcomes are immutable, use a new calculator_version instead',
      p_athlete_id, v_decision_id, v_horizon, v_calculator_id, v_calculator_version, v_existing_id;
  end if;

  -----------------------------------------------------------------------
  -- INSERT only — never UPDATE. Guarded against a concurrent duplicate
  -- insert race (see module doc).
  -----------------------------------------------------------------------
  begin
    insert into public.decision_outcomes (
      athlete_id, decision_id, horizon, calculator_id, calculator_version, input_snapshot, outcome_signals
    )
    values (
      p_athlete_id, v_decision_id, v_horizon, v_calculator_id, v_calculator_version, v_input_snapshot, v_outcome_signals
    )
    returning id into v_id;

    return jsonb_build_object('decision_outcome_id', v_id);
  exception
    when unique_violation then
      select id, input_snapshot, outcome_signals
      into v_existing_id, v_existing_input_snapshot, v_existing_outcome_signals
      from public.decision_outcomes
      where athlete_id = p_athlete_id
        and decision_id = v_decision_id
        and horizon = v_horizon
        and calculator_id = v_calculator_id
        and calculator_version = v_calculator_version;

      if v_existing_input_snapshot = v_input_snapshot and v_existing_outcome_signals = v_outcome_signals then
        return jsonb_build_object('decision_outcome_id', v_existing_id);
      end if;

      raise exception 'persist_decision_outcome: conflicting outcome already exists (concurrent race) for athlete %, decision %, horizon %, calculator %/% (existing id=%) with different content',
        p_athlete_id, v_decision_id, v_horizon, v_calculator_id, v_calculator_version, v_existing_id;
  end;
end;
$$;

revoke all on function public.persist_decision_outcome(uuid, jsonb) from public;
revoke all on function public.persist_decision_outcome(uuid, jsonb) from anon;
revoke all on function public.persist_decision_outcome(uuid, jsonb) from authenticated;
grant execute on function public.persist_decision_outcome(uuid, jsonb) to service_role;
