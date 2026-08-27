-- M5_007 — integrity layer for the pattern_insight review ledger: a
-- predecessor-chain hardening trigger for pattern_insight_reviews (mirrors
-- check_pattern_evidence_revision_predecessor, M5_006A, exactly) plus
-- append-only enforcement (UPDATE/DELETE rejection) for BOTH new tables,
-- reusing public.reject_append_only_mutation() verbatim (already defined by
-- M5_006A — generic, keyed only off TG_OP/TG_TABLE_NAME) rather than
-- redefining it. See docs/11_DECISION_LOG.md (M5_007).
--
-- Allocation of review_number/supersedes_id itself remains entirely owned
-- by persist_pattern_insight_review (next migration) under the identity's
-- advisory lock; this trigger only ever VALIDATES what was proposed, never
-- allocates — same division of responsibility as the M5_006A/B
-- predecessor-check triggers.

create or replace function public.check_pattern_insight_review_predecessor() returns trigger
  language plpgsql
  as $$
declare
  v_predecessor_identity_id uuid;
  v_predecessor_review_number integer;
begin
  if NEW.review_number = 1 then
    if NEW.supersedes_id is not null then
      raise exception 'pattern_insight_reviews: review 1 must have supersedes_id NULL (got %)', NEW.supersedes_id;
    end if;
    return NEW;
  end if;

  -- review_number > 1 here (review_number >= 1 already enforced by the table CHECK).
  if NEW.supersedes_id is null then
    raise exception 'pattern_insight_reviews: review % must specify supersedes_id', NEW.review_number;
  end if;

  select insight_identity_id, review_number
  into v_predecessor_identity_id, v_predecessor_review_number
  from public.pattern_insight_reviews
  where id = NEW.supersedes_id;

  if not found then
    raise exception 'pattern_insight_reviews: supersedes_id % does not reference an existing review', NEW.supersedes_id;
  end if;

  if v_predecessor_identity_id <> NEW.insight_identity_id then
    raise exception 'pattern_insight_reviews: supersedes_id % belongs to a different insight_identity_id (% expected %)',
      NEW.supersedes_id, v_predecessor_identity_id, NEW.insight_identity_id;
  end if;

  if v_predecessor_review_number <> NEW.review_number - 1 then
    raise exception 'pattern_insight_reviews: supersedes_id % is review %, but review % may only supersede its immediate predecessor (review %)',
      NEW.supersedes_id, v_predecessor_review_number, NEW.review_number, NEW.review_number - 1;
  end if;

  return NEW;
end;
$$;

create trigger trg_pattern_insight_reviews_predecessor_check
  before insert on public.pattern_insight_reviews
  for each row execute function public.check_pattern_insight_review_predecessor();

-- reject_append_only_mutation() already exists (M5_006A) — reused verbatim,
-- never redefined.
create trigger trg_pattern_insight_identities_no_update
  before update on public.pattern_insight_identities
  for each row execute function public.reject_append_only_mutation();

create trigger trg_pattern_insight_identities_no_delete
  before delete on public.pattern_insight_identities
  for each row execute function public.reject_append_only_mutation();

create trigger trg_pattern_insight_reviews_no_update
  before update on public.pattern_insight_reviews
  for each row execute function public.reject_append_only_mutation();

create trigger trg_pattern_insight_reviews_no_delete
  before delete on public.pattern_insight_reviews
  for each row execute function public.reject_append_only_mutation();
