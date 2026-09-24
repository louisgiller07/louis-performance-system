-- PILOT_001 (PILOT_007/008) — pilot observability events.
--
-- Append-only technical events written best-effort by the pilot-critical
-- Edge Functions (generate/accept/daily-run/completed-session), so a tester
-- report can be diagnosed later by athlete_id + date + business ids.
--
-- Observability only: never read by the planning engine, the prescription
-- engine, the Head Coach, or any generation/daily-decision logic. Business
-- tables stay the source of truth — rows here only reference them (ids +
-- codes), never copy them (no check-in, health, prescription or plan payload).
--
-- No foreign keys on purpose: an observability write must never be able to
-- fail, or block an athlete deletion, because of a referential constraint.

create table public.pilot_observability_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null,
  severity text not null,
  athlete_id uuid not null,
  plan_version_id uuid null,
  generation_request_id uuid null,
  event_date date null,
  decision_id uuid null,
  generated_session_id uuid null,
  completed_session_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pilot_observability_events_severity_check
    check (severity in ('info', 'warning', 'error')),
  constraint pilot_observability_events_event_type_check
    check (event_type in (
      'plan_generation_succeeded',
      'plan_generation_blocked',
      'plan_generation_failed',
      'plan_acceptance_succeeded',
      'plan_acceptance_projection_warning',
      'plan_acceptance_failed',
      'daily_run_succeeded',
      'daily_run_warning',
      'daily_run_failed',
      'session_completion_succeeded',
      'session_completion_failed'
    )),
  constraint pilot_observability_events_metadata_is_object
    check (jsonb_typeof(metadata) = 'object')
);

create index idx_pilot_observability_events_athlete_created
  on public.pilot_observability_events (athlete_id, created_at desc);

create index idx_pilot_observability_events_type_created
  on public.pilot_observability_events (event_type, created_at desc);

-- RLS on, no policy at all: no anon/authenticated access. service_role
-- bypasses RLS and is the only writer.
alter table public.pilot_observability_events enable row level security;

-- Same over-broad ALTER DEFAULT PRIVILEGES reality as every post-baseline
-- table (see decision_outcomes): revoke everything, then grant the minimum.
revoke all privileges on public.pilot_observability_events from anon;
revoke all privileges on public.pilot_observability_events from authenticated;
revoke all privileges on public.pilot_observability_events from service_role;

-- Append-only by permissions: INSERT only — no select/update/delete/truncate.
-- Support queries run through the dashboard/SQL admin role.
grant insert on public.pilot_observability_events to service_role;
