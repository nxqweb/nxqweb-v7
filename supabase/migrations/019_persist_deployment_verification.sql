-- Persist the latest read-only deployment verification result for each project.

alter table public.project_deployment_configs
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_verification_status text not null default 'not_checked'
    check (last_verification_status in ('not_checked', 'passed', 'needs_attention')),
  add column if not exists last_verification_details jsonb;

comment on column public.project_deployment_configs.last_verified_at is
  'Timestamp of the most recent read-only GitHub, Netlify, URL, and lock verification.';

comment on column public.project_deployment_configs.last_verification_status is
  'Summary status for the most recent read-only deployment verification.';

comment on column public.project_deployment_configs.last_verification_details is
  'Structured result payload from the most recent read-only deployment verification.';
