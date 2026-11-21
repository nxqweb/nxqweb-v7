-- Harden automatic Commerce storefront provisioning before launch.
-- Forward-only: preserves applied migrations and existing provider checkpoints.
-- Key guarantees:
--   1) Provisioning cannot queue before an accepted website setup approval.
--   2) QA jobs cannot receive storefront launch approval.
--   3) Retrying a failed preview starts a fresh Netlify build without recreating repo/site.
--   4) Storefront worker claims preview work only; production publication remains a separate guarded workflow.
--   5) Owner authorization uses owner_users/auth.uid(), not a hard-coded email address.

alter table public.commerce_storefront_provisioning
  add column if not exists qa_only boolean not null default false;

-- Preserve the known disposable QA storefront as permanently non-launchable.
update public.commerce_storefront_provisioning
set qa_only = true,
    updated_at = now()
where client_id = 'ca1d8990-7e66-4bb6-96c1-8346813e708b'::uuid;

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
  client_status_value text;
begin
  if target_client_id is null then
    return jsonb_build_object('queued', false, 'reason', 'missing_client_id');
  end if;

  select c.status::text into client_status_value
  from public.clients c
  where c.id = target_client_id;

  if not found then
    return jsonb_build_object('queued', false, 'reason', 'client_not_found');
  end if;

  if client_status_value in ('denied', 'archived', 'dormant') then
    return jsonb_build_object('queued', false, 'reason', 'client_not_eligible', 'client_status', client_status_value);
  end if;

  if not exists (
    select 1
    from public.owner_approval_requests a
    where a.client_id = target_client_id
      and a.request_type = 'website_setup_review'
      and a.status = 'accepted'
  ) then
    return jsonb_build_object('queued', false, 'reason', 'owner_approval_required');
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
    'storefront_id', job_row.storefront_id,
    'qa_only', job_row.qa_only
  );
end;
$$;

create or replace function public.get_owner_storefront_provisioning_jobs()
returns setof public.commerce_storefront_provisioning
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  return query
  select p.*
  from public.commerce_storefront_provisioning p
  order by
    case p.status
      when 'failed' then 0
      when 'preview_ready' then 1
      when 'launch_approved' then 2
      when 'processing' then 3
      when 'queued' then 4
      else 5
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
  if not exists (
    select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  update public.commerce_storefront_provisioning
  set status = 'queued',
      next_attempt_at = now(),
      locked_at = null,
      lock_token = null,
      last_error = null,
      error_step = null,
      provider_metadata = coalesce(provider_metadata, '{}'::jsonb)
        - 'netlify_build_triggered_at'
        - 'netlify_build_id',
      updated_at = now()
  where id = target_job_id
    and status in ('failed', 'cancelled')
  returning * into job_row;

  if job_row.id is null then
    raise exception 'Only failed or cancelled provisioning jobs can be retried.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', job_row.id,
    'status', job_row.status,
    'fresh_preview_build_required', true
  );
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
  if not exists (
    select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  if exists (
    select 1
    from public.commerce_storefront_provisioning p
    where p.id = target_job_id and p.qa_only = true
  ) then
    raise exception 'QA storefronts are permanently blocked from production launch.';
  end if;

  update public.commerce_storefront_provisioning
  set status = 'launch_approved',
      launch_approved_at = now(),
      next_attempt_at = now(),
      provider_metadata = coalesce(provider_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'production_publish_required', true,
          'production_publish_automatic', false,
          'launch_gate_approved_at', now()
        ),
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
    'preview_url', job_row.preview_url,
    'production_publish_required', true,
    'message', 'Preview launch gate approved. Production publication remains blocked until the guarded production workflow completes.'
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
  if worker_token is null then
    raise exception 'Worker token is required.';
  end if;

  select * into job_row
  from public.commerce_storefront_provisioning
  where status = 'queued'
    and next_attempt_at <= now()
    and (locked_at is null or locked_at < now() - interval '15 minutes')
  order by requested_at asc
  for update skip locked
  limit 1;

  if job_row.id is null then
    return null;
  end if;

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

-- The service worker validates approvals and owner roles directly.
grant select on public.owner_approval_requests to service_role;
grant select on public.owner_users to service_role;

revoke all on function public.queue_commerce_storefront_provisioning(uuid) from public, anon, authenticated;
revoke all on function public.claim_next_storefront_provisioning_job(uuid) from public, anon, authenticated;
revoke all on function public.get_owner_storefront_provisioning_jobs() from public, anon;
revoke all on function public.retry_owner_storefront_provisioning(uuid) from public, anon;
revoke all on function public.approve_owner_storefront_launch(uuid) from public, anon;

grant execute on function public.claim_next_storefront_provisioning_job(uuid) to service_role;
grant execute on function public.get_owner_storefront_provisioning_jobs() to authenticated;
grant execute on function public.retry_owner_storefront_provisioning(uuid) to authenticated;
grant execute on function public.approve_owner_storefront_launch(uuid) to authenticated;
