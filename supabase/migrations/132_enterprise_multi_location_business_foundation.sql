-- Enterprise / multi-location Business foundation.
-- One NXQ client can own many verified locations while sharing one account/project/site.

create table if not exists public.client_locations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  location_code text not null,
  display_name text not null,
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('draft','active','paused','closed')),
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country_code text not null default 'US',
  phone text,
  email text,
  service_area text,
  timezone text,
  latitude numeric,
  longitude numeric,
  seo_slug text not null,
  seo_title text,
  seo_description text,
  structured_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, location_code),
  unique(client_id, seo_slug),
  check (length(location_code) between 1 and 40),
  check (length(seo_slug) between 1 and 100)
);

create unique index if not exists client_locations_one_primary_idx
  on public.client_locations(client_id)
  where is_primary = true and status <> 'closed';

create table if not exists public.client_location_services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  location_id uuid not null references public.client_locations(id) on delete cascade,
  service_name text not null,
  service_slug text not null,
  summary text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, service_slug)
);

create table if not exists public.client_location_pages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  location_id uuid not null references public.client_locations(id) on delete cascade,
  page_slug text not null,
  page_title text not null,
  meta_description text,
  canonical_path text not null,
  status text not null default 'draft' check (status in ('draft','ready','published','archived')),
  content jsonb not null default '{}'::jsonb,
  last_generated_at timestamptz,
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, location_id, page_slug)
);

create index if not exists client_locations_client_status_idx on public.client_locations(client_id, status);
create index if not exists client_location_services_location_idx on public.client_location_services(location_id, active);
create index if not exists client_location_pages_project_status_idx on public.client_location_pages(project_id, status);

alter table public.client_locations enable row level security;
alter table public.client_location_services enable row level security;
alter table public.client_location_pages enable row level security;

revoke all on table public.client_locations from public, anon;
revoke all on table public.client_location_services from public, anon;
revoke all on table public.client_location_pages from public, anon;

grant select, insert, update, delete on table public.client_locations to authenticated;
grant select, insert, update, delete on table public.client_location_services to authenticated;
grant select on table public.client_location_pages to authenticated;
grant select, insert, update, delete on table public.client_locations to service_role;
grant select, insert, update, delete on table public.client_location_services to service_role;
grant select, insert, update, delete on table public.client_location_pages to service_role;

create policy owner_manage_client_locations
on public.client_locations for all to authenticated
using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy client_manage_own_locations
on public.client_locations for all to authenticated
using (exists (select 1 from public.clients c where c.id = client_locations.client_id and c.auth_user_id = auth.uid()))
with check (exists (select 1 from public.clients c where c.id = client_locations.client_id and c.auth_user_id = auth.uid()));

create policy owner_manage_client_location_services
on public.client_location_services for all to authenticated
using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy client_manage_own_location_services
on public.client_location_services for all to authenticated
using (exists (select 1 from public.clients c where c.id = client_location_services.client_id and c.auth_user_id = auth.uid()))
with check (exists (select 1 from public.clients c where c.id = client_location_services.client_id and c.auth_user_id = auth.uid()));

create policy owner_manage_client_location_pages
on public.client_location_pages for all to authenticated
using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
create policy client_view_own_location_pages
on public.client_location_pages for select to authenticated
using (exists (select 1 from public.clients c where c.id = client_location_pages.client_id and c.auth_user_id = auth.uid()));

create or replace function public.current_client_locations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  payload jsonb;
begin
  select id into client_uuid from public.clients where auth_user_id = auth.uid() order by created_at desc limit 1;
  if client_uuid is null then raise exception 'Client account not found.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'location_code', l.location_code,
    'display_name', l.display_name,
    'is_primary', l.is_primary,
    'status', l.status,
    'city', l.city,
    'state_region', l.state_region,
    'postal_code', l.postal_code,
    'country_code', l.country_code,
    'phone', l.phone,
    'email', l.email,
    'service_area', l.service_area,
    'seo_slug', l.seo_slug,
    'seo_title', l.seo_title,
    'seo_description', l.seo_description,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.service_name, 'slug', s.service_slug, 'summary', s.summary) order by s.service_name)
      from public.client_location_services s
      where s.location_id = l.id and s.active = true
    ), '[]'::jsonb)
  ) order by l.is_primary desc, l.display_name), '[]'::jsonb)
  into payload
  from public.client_locations l
  where l.client_id = client_uuid and l.status <> 'closed';

  return jsonb_build_object('client_id', client_uuid, 'locations', payload, 'generated_at', now());
end;
$$;

revoke all on function public.current_client_locations() from public, anon;
grant execute on function public.current_client_locations() to authenticated, service_role;

create or replace function public.queue_location_seo_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  target_location_id uuid;
  project_uuid uuid;
  client_status text;
begin
  target_client_id := coalesce(new.client_id, old.client_id);
  target_location_id := case
    when tg_table_name = 'client_locations' then coalesce(new.id, old.id)
    else coalesce(new.location_id, old.location_id)
  end;

  select status::text into client_status from public.clients where id = target_client_id;
  if client_status not in ('approved','active') then return coalesce(new, old); end if;

  select id into project_uuid from public.projects where client_id = target_client_id order by created_at desc limit 1;
  if project_uuid is null then return coalesce(new, old); end if;

  perform public.enqueue_automation_job(
    target_client_id,
    project_uuid,
    'website_location_seo_refresh',
    'project:' || project_uuid::text || ':location:' || target_location_id::text || ':seo:' || to_char(now(), 'YYYYMMDDHH24MI'),
    jsonb_build_object(
      'execution_target', 'edge',
      'requires_external_worker', true,
      'location_id', target_location_id,
      'source', tg_table_name
    ),
    now() + interval '2 minutes',
    55
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists queue_location_seo_refresh_from_location on public.client_locations;
create trigger queue_location_seo_refresh_from_location
after insert or update on public.client_locations
for each row execute function public.queue_location_seo_refresh();

drop trigger if exists queue_location_seo_refresh_from_service on public.client_location_services;
create trigger queue_location_seo_refresh_from_service
after insert or update or delete on public.client_location_services
for each row execute function public.queue_location_seo_refresh();

revoke all on function public.queue_location_seo_refresh() from public, anon, authenticated;

comment on table public.client_locations is
  'Multi-location Business identity/SEO records under one NXQ client account and unified website project.';