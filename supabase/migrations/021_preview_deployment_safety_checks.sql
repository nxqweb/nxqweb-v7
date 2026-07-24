-- Persist read-only preview deployment safety checks.
-- This migration does not enable or trigger deployments.

alter table public.preview_deployment_requests
  add column if not exists safety_checked_at timestamptz,
  add column if not exists safety_status text not null default 'not_checked'
    check (safety_status in ('not_checked', 'passed', 'needs_attention')),
  add column if not exists safety_details jsonb;

create index if not exists preview_deployment_requests_safety_status_idx
  on public.preview_deployment_requests(safety_status, created_at desc);
