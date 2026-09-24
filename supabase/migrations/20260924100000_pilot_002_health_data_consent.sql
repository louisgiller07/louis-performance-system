-- PILOT_002 (PILOT_012) — explicit health-data consent before the restricted pilot.
--
-- Stored on athlete_onboarding_profiles (the athlete's one onboarding row, already
-- scoped by athlete_onboarding_profiles_own_data RLS — no policy/grant change here).
--
--   privacy_notice_version  — the privacy notice version the athlete explicitly accepted
--                             (web PRIVACY_NOTICE_VERSION), written by the client.
--   health_data_consent_at  — set by the server only (trigger below, now()), whenever the
--                             accepted version changes; a client-supplied value is ignored.
--
-- No backfill: existing rows keep NULL (never inferred consent). The web app gates any
-- athlete whose accepted version differs from the current notice until they consent.

alter table public.athlete_onboarding_profiles
  add column privacy_notice_version text null,
  add column health_data_consent_at timestamptz null;

alter table public.athlete_onboarding_profiles
  add constraint athlete_onboarding_profiles_privacy_notice_version_not_blank
    check (privacy_notice_version is null or length(trim(privacy_notice_version)) > 0),
  add constraint athlete_onboarding_profiles_consent_pair
    check ((privacy_notice_version is null) = (health_data_consent_at is null));

-- Completing onboarding requires consent. NOT VALID: enforced on every new or updated
-- row, while the existing (pre-consent) completed rows stay untouched until the
-- athlete consents through the web gate.
alter table public.athlete_onboarding_profiles
  add constraint athlete_onboarding_profiles_completed_requires_consent
    check (onboarding_completed_at is null or privacy_notice_version is not null) not valid;

create or replace function public.set_health_data_consent_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.privacy_notice_version is distinct from old.privacy_notice_version then
    new.health_data_consent_at := case when new.privacy_notice_version is null then null else now() end;
  else
    new.health_data_consent_at := old.health_data_consent_at;
  end if;
  return new;
end;
$$;

create trigger trg_athlete_onboarding_profiles_health_data_consent_at
  before insert or update on public.athlete_onboarding_profiles
  for each row execute function public.set_health_data_consent_at();
