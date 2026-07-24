-- Preview execution preparation foundation.
-- Adds owner-audited preparation state only. This migration does not call
-- GitHub, Netlify, or any deployment provider.

alter table public.preview_deployment_requests
  add column if not exists execution_status text not null default 'not_prepared'
    check (execution_status in (
      'not_prepared',
      'prepared',
      'executing',
      'published',
      'failed',
      'cancelled'
    )),
  add column if not exists execution_prepared_at timestamptz,
  add column if not exists execution_prepared_by uuid,
  add column if not exists execution_deployment_id uuid
    references public.project_deployments(id) on delete set null,
  add column if not exists execution_error text;

create unique index if not exists preview_deployment_requests_execution_deployment_uidx
  on public.preview_deployment_requests(execution_deployment_id)
  where execution_deployment_id is not null;

create index if not exists preview_deployment_requests_execution_status_idx
  on public.preview_deployment_requests(execution_status, created_at desc);

comment on column public.preview_deployment_requests.execution_status is
  'Internal execution preparation state. prepared means a local queued record exists; it does not mean Netlify was called.';
