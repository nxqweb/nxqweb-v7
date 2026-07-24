-- Preview-only Netlify execution tracking.
-- Adds provider build identifiers and timestamps. It does not trigger a build.

alter table public.preview_deployment_requests
  add column if not exists execution_started_at timestamptz,
  add column if not exists execution_completed_at timestamptz,
  add column if not exists netlify_build_id text;

create index if not exists preview_deployment_requests_netlify_build_idx
  on public.preview_deployment_requests(netlify_build_id)
  where netlify_build_id is not null;

comment on column public.preview_deployment_requests.netlify_build_id is
  'Netlify build identifier created only by the owner-approved preview execution function.';
