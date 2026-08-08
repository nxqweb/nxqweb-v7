-- Public Business lead intake foundation.
-- Public form keys identify a site/form but never authorize reads or tenant access.

create extension if not exists pgcrypto;

create table if not exists public.business_lead_forms (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  form_key text not null unique default ('FORM-' || lower(replace(gen_random_uuid()::text,'-',''))),
  form_name text not null default 'Primary contact form',
  status text not null default 'active' check(status in ('active','paused','retired')),
  allowed_origins text[] not null default '{}'::text[],
  allowed_service_keys text[] not null default '{}'::text[],
  max_message_length integer not null default 4000 check(max_message_length between 100 and 10000),
  hourly_limit integer not null default 40 check(hourly_limit between 1 and 1000),
  require_challenge boolean not null default false,
  challenge_provider text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,form_name)
);

create table if not exists public.business_lead_intake_attempts (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.business_lead_forms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  request_fingerprint_hash text not null,
  outcome text not null check(outcome in ('accepted','rate_limited','rejected','spam')),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists business_lead_intake_attempts_rate_idx on public.business_lead_intake_attempts(form_id,request_fingerprint_hash,created_at desc);

alter table public.business_lead_forms enable row level security;
alter table public.business_lead_intake_attempts enable row level security;
revoke all on table public.business_lead_forms from public,anon;
revoke all on table public.business_lead_intake_attempts from public,anon,authenticated;
grant select on public.business_lead_forms to authenticated;
grant select,insert,update,delete on public.business_lead_forms to service_role;
grant select,insert,update,delete on public.business_lead_intake_attempts to service_role;
create policy client_read_own_lead_forms on public.business_lead_forms for select to authenticated
using(exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()));
create policy owner_manage_lead_forms on public.business_lead_forms for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

create or replace function public.create_default_business_lead_form(target_client_id uuid,target_project_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare key_value text;
begin
  if not exists(select 1 from public.projects p where p.id=target_project_id and p.client_id=target_client_id) then raise exception 'Project/client mismatch.'; end if;
  insert into public.business_lead_forms(client_id,project_id,form_name)
  values(target_client_id,target_project_id,'Primary contact form')
  on conflict(project_id,form_name) do update set updated_at=now()
  returning form_key into key_value;
  return key_value;
end; $$;
revoke all on function public.create_default_business_lead_form(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_default_business_lead_form(uuid,uuid) to service_role;

comment on table public.business_lead_forms is 'Public lead-form configuration. form_key is a public identifier only and provides no read/write tenant authority by itself.';