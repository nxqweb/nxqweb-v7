-- Automatic Commerce storefront provisioning foundation.
-- This migration only queues and tracks work. It does not contact GitHub,
-- Netlify, deploy a site, or launch anything by itself.

create table if not exists public.commerce_storefront_provisioning (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storefront_id uuid not null references public.commerce_storefronts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  status text not null default 'queued' check (status in (
    'queued',
    'processing',
    'repository_created',
    'netlify_site_created',
    'configuring',
    'preview_building',
    'preview_ready',
    'launch_approved',
    'live',
    'failed',
    'cancelled'
  )),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  repository_owner text,
  repository_name text,
  repository_url text,
  repository_id bigint,
  netlify_site_id text,
  netlify_site_name text,
  preview_url text,
  production_url text,
  custom_domain text,
  last_error text,
  error_step text,
  provider_metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  preview_ready_at timestamptz,
  launch_approved_at timestamptz,
  launched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id),
  unique (storefront_id)
);

create index if not exists commerce_storefront_provisioning_queue_idx
  on public.commerce_storefront_provisioning (status, next_attempt_at, requested_at);

alter table public.commerce_storefront_provisioning enable row level security;

create or replace function public.queue_commerce_storefront_provisioning(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  storefront_row public.commerce_storefronts%rowtype;
  project_uuid uuid;
  job_row public.commerce_storefront_provisioning%rowtype;
begin
  if target_client_id is null then
    return jsonb_build_object('queued', false, 'reason', 'missing_client_id');
  end if;

  select * into storefront_row
  from public.commerce_storefronts
  where client_id = target_client_id
  order by created_at asc
  limit 1;

  if storefront_row.id is null then
    return jsonb_build_object('queued', false, 'reason', 'storefront_not_created_yet');
  end if;

  select id into project_uuid
  from public.projects
  where client_id = target_client_id
  order by created_at desc
  limit 1;

  insert into public.commerce_storefront_provisioning (
    client_id,
    storefront_id,
    project_id,
    status,
    requested_at,
    next_attempt_at,
    updated_at
  ) values (
    target_client_id,
    storefront_row.id,
    project_uuid,
    'queued',
    now(),
    now(),
    now()
  )
  on conflict (client_id) do update
  set storefront_id = excluded.storefront_id,
      project_id = coalesce(public.commerce_storefront_provisioning.project_id, excluded.project_id),
      updated_at = now()
  returning * into job_row;

  return jsonb_build_object(
    'queued', job_row.status = 'queued',
    'job_id', job_row.id,
    'status', job_row.status,
    'storefront_id', job_row.storefront_id
  );
end;
$$;

create or replace function public.queue_provisioning_after_storefront_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.queue_commerce_storefront_provisioning(new.client_id);
  return new;
end;
$$;

drop trigger if exists commerce_storefront_queue_provisioning on public.commerce_storefronts;
create trigger commerce_storefront_queue_provisioning
after insert or update of client_id on public.commerce_storefronts
for each row execute function public.queue_provisioning_after_storefront_change();

create or replace function public.queue_provisioning_after_approval_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'accepted'
     and old.status is distinct from new.status
     and new.request_type = 'website_setup_review'
     and new.client_id is not null then
    perform public.queue_commerce_storefront_provisioning(new.client_id);
  end if;

  return new;
end;
$$;

drop trigger if exists owner_approval_queue_storefront_provisioning on public.owner_approval_requests;
create trigger owner_approval_queue_storefront_provisioning
after update of status on public.owner_approval_requests
for each row execute function public.queue_provisioning_after_approval_change();

create or replace function public.get_owner_storefront_provisioning_jobs()
returns setof public.commerce_storefront_provisioning
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(auth.jwt()->>'email', '')) <> 'nxqweb@protonmail.com' then
    raise exception 'Owner access required.';
  end if;

  return query
  select p.*
  from public.commerce_storefront_provisioning p
  order by
    case p.status
      when 'failed' then 0
      when 'preview_ready' then 1
      when 'processing' then 2
      when 'queued' then 3
      else 4
    end,
    p.updated_at desc;
end;
$$;

create or replace function public.retry_owner_storefront_provisioning(target_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.commerce_storefront_provisioning%rowtype;
begin
  if lower(coalesce(auth.jwt()->>'email', '')) <> 'nxqweb@protonmail.com' then
    raise exception 'Owner access required.';
  end if;

  update public.commerce_storefront_provisioning
  set status = 'queued',
      next_attempt_at = now(),
      locked_at = null,
      lock_token = null,
      last_error = null,
      error_step = null,
      updated_at = now()
  where id = target_job_id
    and status in ('failed', 'cancelled')
  returning * into job_row;

  if job_row.id is null then
    raise exception 'Only failed or cancelled provisioning jobs can be retried.';
  end if;

  return jsonb_build_object('ok', true, 'job_id', job_row.id, 'status', job_row.status);
end;
$$;

create or replace function public.approve_owner_storefront_launch(target_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.commerce_storefront_provisioning%rowtype;
begin
  if lower(coalesce(auth.jwt()->>'email', '')) <> 'nxqweb@protonmail.com' then
    raise exception 'Owner access required.';
  end if;

  update public.commerce_storefront_provisioning
  set status = 'launch_approved',
      launch_approved_at = now(),
      next_attempt_at = now(),
      updated_at = now()
  where id = target_job_id
    and status = 'preview_ready'
    and nullif(trim(preview_url), '') is not null
  returning * into job_row;

  if job_row.id is null then
    raise exception 'A finished preview is required before launch approval.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', job_row.id,
    'status', job_row.status,
    'preview_url', job_row.preview_url
  );
end;
$$;

create or replace function public.claim_next_storefront_provisioning_job(worker_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.commerce_storefront_provisioning%rowtype;
begin
  if worker_token is null then raise exception 'Worker token is required.'; end if;

  select * into job_row
  from public.commerce_storefront_provisioning
  where status in ('queued', 'launch_approved')
    and next_attempt_at <= now()
    and (locked_at is null or locked_at < now() - interval '15 minutes')
  order by requested_at asc
  for update skip locked
  limit 1;

  if job_row.id is null then return null; end if;

  update public.commerce_storefront_provisioning
  set status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      lock_token = worker_token,
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = job_row.id
  returning * into job_row;

  return to_jsonb(job_row);
end;
$$;

revoke all on table public.commerce_storefront_provisioning from public, anon, authenticated;
revoke all on function public.queue_commerce_storefront_provisioning(uuid) from public, anon, authenticated;
revoke all on function public.claim_next_storefront_provisioning_job(uuid) from public, anon, authenticated;
revoke all on function public.get_owner_storefront_provisioning_jobs() from public, anon;
revoke all on function public.retry_owner_storefront_provisioning(uuid) from public, anon;
revoke all on function public.approve_owner_storefront_launch(uuid) from public, anon;

grant execute on function public.get_owner_storefront_provisioning_jobs() to authenticated;
grant execute on function public.retry_owner_storefront_provisioning(uuid) to authenticated;
grant execute on function public.approve_owner_storefront_launch(uuid) to authenticated;
