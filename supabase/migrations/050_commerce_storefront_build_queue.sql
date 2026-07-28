-- Guarded owner-only queue for separate Commerce storefront builds.
-- This migration records approved build snapshots and isolation metadata.
-- It does not create repositories, deploy previews, connect domains, or activate payments.

create table if not exists public.commerce_storefront_build_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  intake_id uuid not null references public.commerce_intakes(id) on delete cascade,
  status text not null default 'queued'
    check (status in (
      'queued',
      'repo_requested',
      'repo_created',
      'preview_building',
      'preview_ready',
      'changes_requested',
      'owner_approved',
      'production_approved',
      'paused',
      'failed',
      'cancelled'
    )),
  build_snapshot jsonb not null,
  repository_owner text,
  repository_name text,
  repository_url text,
  repository_default_branch text not null default 'main',
  preview_provider text,
  preview_site_id text,
  preview_url text,
  production_url text,
  domain_connection_status text not null default 'not_requested'
    check (domain_connection_status in ('not_requested','pending_owner_approval','approved','connected','failed')),
  checkout_activation_status text not null default 'disabled'
    check (checkout_activation_status in ('disabled','provider_required','pending_owner_approval','approved','active','failed')),
  owner_note text,
  last_error text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  preview_ready_at timestamptz,
  owner_approved_at timestamptz,
  production_approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commerce_storefront_build_jobs_one_active_per_client
  on public.commerce_storefront_build_jobs(client_id)
  where status not in ('cancelled','failed');

create index if not exists commerce_storefront_build_jobs_status_idx
  on public.commerce_storefront_build_jobs(status, queued_at desc);

alter table public.commerce_storefront_build_jobs enable row level security;
revoke all on public.commerce_storefront_build_jobs from public, anon, authenticated;

create or replace function public.queue_commerce_storefront_build(
  target_client_id uuid,
  owner_note_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  intake_row public.commerce_intakes%rowtype;
  existing_job public.commerce_storefront_build_jobs%rowtype;
  new_job public.commerce_storefront_build_jobs%rowtype;
  snapshot jsonb;
begin
  if not public.is_nxq_owner() then
    raise exception 'Owner access required.';
  end if;

  select * into intake_row
  from public.commerce_intakes
  where client_id = target_client_id
  for update;

  if intake_row.id is null then
    raise exception 'Commerce intake not found.';
  end if;

  if intake_row.owner_review_status <> 'ready_for_build'
     or intake_row.status <> 'approved'
     or intake_row.build_plan is null then
    raise exception 'Commerce intake must be approved and marked ready for build before queueing.';
  end if;

  select * into existing_job
  from public.commerce_storefront_build_jobs
  where client_id = target_client_id
    and status not in ('cancelled','failed')
  order by created_at desc
  limit 1;

  if existing_job.id is not null then
    return jsonb_build_object(
      'status', existing_job.status,
      'job_id', existing_job.id,
      'already_queued', true
    );
  end if;

  snapshot := jsonb_build_object(
    'snapshot_version', 1,
    'client_id', target_client_id,
    'intake_id', intake_row.id,
    'build_plan', intake_row.build_plan,
    'catalog', jsonb_build_object(
      'products', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'slug', p.slug,
            'status', p.status,
            'product_type', p.product_type,
            'base_price', p.base_price,
            'compare_at_price', p.compare_at_price,
            'short_description', p.short_description,
            'description', p.description,
            'featured', p.featured,
            'category_id', p.category_id,
            'seo_title', p.seo_title,
            'seo_description', p.seo_description,
            'track_inventory', p.track_inventory,
            'requires_shipping', p.requires_shipping,
            'taxable', p.taxable
          ) order by p.created_at
        )
        from public.commerce_products p
        where p.client_id = target_client_id
      ), '[]'::jsonb),
      'categories', coalesce((
        select jsonb_agg(to_jsonb(cat) order by cat.sort_order, cat.name)
        from public.commerce_categories cat
        where cat.client_id = target_client_id
      ), '[]'::jsonb),
      'variants', coalesce((
        select jsonb_agg(to_jsonb(v) order by v.created_at)
        from public.commerce_product_variants v
        where v.client_id = target_client_id
      ), '[]'::jsonb),
      'media', coalesce((
        select jsonb_agg(to_jsonb(m) order by m.product_id, m.sort_order, m.created_at)
        from public.commerce_product_media m
        where m.client_id = target_client_id
      ), '[]'::jsonb)
    ),
    'generated_at', now(),
    'publishing_locked', true,
    'checkout_locked', true,
    'domain_locked', true
  );

  insert into public.commerce_storefront_build_jobs (
    client_id,
    intake_id,
    status,
    build_snapshot,
    owner_note
  ) values (
    target_client_id,
    intake_row.id,
    'queued',
    snapshot,
    nullif(trim(owner_note_text), '')
  ) returning * into new_job;

  return jsonb_build_object(
    'status', new_job.status,
    'job_id', new_job.id,
    'already_queued', false
  );
end;
$$;

create or replace function public.get_owner_commerce_build_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_nxq_owner() then
    raise exception 'Owner access required.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', j.id,
        'client_id', j.client_id,
        'business_name', c.business_name,
        'contact_email', c.contact_email,
        'monthly_price', c.monthly_price,
        'status', j.status,
        'repository_owner', j.repository_owner,
        'repository_name', j.repository_name,
        'repository_url', j.repository_url,
        'repository_default_branch', j.repository_default_branch,
        'preview_provider', j.preview_provider,
        'preview_site_id', j.preview_site_id,
        'preview_url', j.preview_url,
        'production_url', j.production_url,
        'domain_connection_status', j.domain_connection_status,
        'checkout_activation_status', j.checkout_activation_status,
        'owner_note', j.owner_note,
        'last_error', j.last_error,
        'queued_at', j.queued_at,
        'updated_at', j.updated_at,
        'build_snapshot', j.build_snapshot
      ) order by j.queued_at desc
    )
    from public.commerce_storefront_build_jobs j
    join public.clients c on c.id = j.client_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.update_commerce_build_job_metadata(
  target_job_id uuid,
  repository_owner_text text default null,
  repository_name_text text default null,
  repository_url_text text default null,
  preview_provider_text text default null,
  preview_site_id_text text default null,
  preview_url_text text default null,
  owner_note_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.commerce_storefront_build_jobs%rowtype;
begin
  if not public.is_nxq_owner() then
    raise exception 'Owner access required.';
  end if;

  update public.commerce_storefront_build_jobs
  set repository_owner = nullif(trim(repository_owner_text), ''),
      repository_name = nullif(trim(repository_name_text), ''),
      repository_url = nullif(trim(repository_url_text), ''),
      preview_provider = nullif(trim(preview_provider_text), ''),
      preview_site_id = nullif(trim(preview_site_id_text), ''),
      preview_url = nullif(trim(preview_url_text), ''),
      owner_note = nullif(trim(owner_note_text), ''),
      updated_at = now()
  where id = target_job_id
  returning * into job;

  if job.id is null then
    raise exception 'Commerce build job not found.';
  end if;

  return jsonb_build_object('status', job.status, 'job_id', job.id);
end;
$$;

revoke all on function public.queue_commerce_storefront_build(uuid,text) from public, anon;
revoke all on function public.get_owner_commerce_build_jobs() from public, anon;
revoke all on function public.update_commerce_build_job_metadata(uuid,text,text,text,text,text,text,text) from public, anon;

grant execute on function public.queue_commerce_storefront_build(uuid,text) to authenticated;
grant execute on function public.get_owner_commerce_build_jobs() to authenticated;
grant execute on function public.update_commerce_build_job_metadata(uuid,text,text,text,text,text,text,text) to authenticated;

comment on table public.commerce_storefront_build_jobs is
  'Owner-only lifecycle records for separate Commerce storefront repositories and guarded preview deployments.';
