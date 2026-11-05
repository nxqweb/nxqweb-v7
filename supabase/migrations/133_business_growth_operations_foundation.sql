-- NXQ Business growth/operations foundation.
-- Adds tenant-scoped leads, autonomous website change requests, content revisions,
-- and a provider-neutral notification queue. No provider credentials are stored here.

create extension if not exists pgcrypto;

create table if not exists public.client_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  location_id uuid,
  lead_code text not null unique default ('LEAD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  source text not null default 'website',
  status text not null default 'new' check (status in ('new','contacted','qualified','won','lost','spam','archived')),
  urgency text not null default 'normal' check (urgency in ('low','normal','urgent','emergency')),
  service_key text,
  contact_name text,
  contact_email text,
  contact_phone text,
  message text,
  service_area text,
  assigned_location_id uuid,
  lead_score smallint not null default 0 check (lead_score between 0 and 100),
  ai_classification jsonb not null default '{}'::jsonb,
  utm jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  contacted_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_leads_client_status_idx on public.client_leads(client_id, status, created_at desc);
create index if not exists client_leads_project_idx on public.client_leads(project_id, created_at desc);

create table if not exists public.website_change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_code text not null unique default ('CHG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  request_type text not null check (request_type in ('content','image','service','pricing','new_page','domain','seo','design','location','other')),
  title text not null,
  description text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  risk_level text not null default 'unclassified' check (risk_level in ('unclassified','low','medium','high')),
  status text not null default 'submitted' check (status in ('submitted','classifying','queued','building','preview_ready','published','needs_info','blocked','cancelled','failed')),
  requested_by_auth_user_id uuid references auth.users(id) on delete set null,
  requested_payload jsonb not null default '{}'::jsonb,
  automation_plan jsonb not null default '{}'::jsonb,
  safe_branch text,
  preview_url text,
  published_url text,
  last_error text,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists website_change_requests_client_status_idx on public.website_change_requests(client_id, status, created_at desc);
create index if not exists website_change_requests_project_idx on public.website_change_requests(project_id, created_at desc);

create table if not exists public.website_content_revisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  change_request_id uuid references public.website_change_requests(id) on delete set null,
  content_key text not null,
  revision_number integer not null,
  state text not null default 'draft' check (state in ('draft','preview','published','superseded','rolled_back')),
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'client_request',
  git_commit_sha text,
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(project_id, content_key, revision_number)
);

create index if not exists website_content_revisions_project_key_idx on public.website_content_revisions(project_id, content_key, revision_number desc);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  channel text not null check (channel in ('in_app','email','sms','push','webhook')),
  recipient_kind text not null default 'client' check (recipient_kind in ('client','owner','organization_member','lead','system')),
  recipient_reference text,
  template_key text not null,
  subject text,
  body text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'queued' check (status in ('queued','sending','delivered','failed','blocked','cancelled')),
  provider_key text,
  provider_message_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempts >= 0 and max_attempts between 1 and 12)
);

create index if not exists notification_deliveries_due_idx on public.notification_deliveries(status, run_after, priority, created_at);
create index if not exists notification_deliveries_client_idx on public.notification_deliveries(client_id, created_at desc);

-- Client RLS helpers use auth_user_id already established on clients.
alter table public.client_leads enable row level security;
alter table public.website_change_requests enable row level security;
alter table public.website_content_revisions enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on table public.client_leads from public, anon;
revoke all on table public.website_change_requests from public, anon;
revoke all on table public.website_content_revisions from public, anon;
revoke all on table public.notification_deliveries from public, anon;

grant select, insert, update on public.client_leads to authenticated;
grant select, insert, update on public.website_change_requests to authenticated;
grant select on public.website_content_revisions to authenticated;
grant select on public.notification_deliveries to authenticated;

grant select, insert, update, delete on public.client_leads to service_role;
grant select, insert, update, delete on public.website_change_requests to service_role;
grant select, insert, update, delete on public.website_content_revisions to service_role;
grant select, insert, update, delete on public.notification_deliveries to service_role;

create policy client_read_own_leads on public.client_leads
for select to authenticated
using (exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()));

create policy client_manage_own_leads on public.client_leads
for update to authenticated
using (exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()))
with check (exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()));

create policy owner_manage_all_leads on public.client_leads
for all to authenticated
using (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));

create policy client_read_own_change_requests on public.website_change_requests
for select to authenticated
using (exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()));

create policy client_insert_own_change_requests on public.website_change_requests
for insert to authenticated
with check (
  requested_by_auth_user_id = auth.uid()
  and exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid())
  and exists (select 1 from public.projects p where p.id = project_id and p.client_id = client_id)
);

create policy owner_manage_all_change_requests on public.website_change_requests
for all to authenticated
using (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));

create policy client_read_own_content_revisions on public.website_content_revisions
for select to authenticated
using (exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()));

create policy owner_manage_all_content_revisions on public.website_content_revisions
for all to authenticated
using (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));

create policy client_read_own_notifications on public.notification_deliveries
for select to authenticated
using (client_id is not null and exists (select 1 from public.clients c where c.id = client_id and c.auth_user_id = auth.uid()));

create policy owner_manage_all_notifications on public.notification_deliveries
for all to authenticated
using (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users ou where ou.auth_user_id = auth.uid()));

-- Submit change requests through a narrow RPC so ownership and project pairing are enforced.
create or replace function public.submit_current_client_change_request(
  target_project_id uuid,
  target_request_type text,
  target_title text,
  target_description text,
  target_priority text default 'normal',
  target_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  request_uuid uuid;
begin
  select id into client_uuid from public.clients where auth_user_id = auth.uid() limit 1;
  if client_uuid is null then raise exception 'Client account not found.'; end if;
  if not exists (select 1 from public.projects p where p.id = target_project_id and p.client_id = client_uuid) then
    raise exception 'Project does not belong to the current client.';
  end if;
  if target_request_type not in ('content','image','service','pricing','new_page','domain','seo','design','location','other') then
    raise exception 'Unsupported change request type.';
  end if;
  if length(btrim(coalesce(target_title,''))) < 3 or length(target_title) > 160 then raise exception 'Title length is invalid.'; end if;
  if length(btrim(coalesce(target_description,''))) < 5 or length(target_description) > 6000 then raise exception 'Description length is invalid.'; end if;
  if target_priority not in ('low','normal','high','urgent') then raise exception 'Priority is invalid.'; end if;

  insert into public.website_change_requests (
    client_id, project_id, request_type, title, description, priority,
    requested_by_auth_user_id, requested_payload
  ) values (
    client_uuid, target_project_id, target_request_type, btrim(target_title), btrim(target_description), target_priority,
    auth.uid(), coalesce(target_payload, '{}'::jsonb)
  ) returning id into request_uuid;

  perform public.enqueue_automation_job(
    client_uuid,
    target_project_id,
    'classify_website_change_request',
    'change-request:' || request_uuid::text || ':classify:v1',
    jsonb_build_object('execution_target','ai','change_request_id',request_uuid,'requires_ai_worker',true),
    now(),
    35
  );

  return request_uuid;
end;
$$;

revoke all on function public.submit_current_client_change_request(uuid,text,text,text,text,jsonb) from public, anon;
grant execute on function public.submit_current_client_change_request(uuid,text,text,text,text,jsonb) to authenticated;

comment on table public.client_leads is 'Tenant-scoped website/customer leads with status, urgency, attribution, and AI classification slots.';
comment on table public.website_change_requests is 'Client website changes that enter the same safe branch/preview/automation model as initial builds.';
comment on table public.notification_deliveries is 'Provider-neutral notification queue. Secrets and provider credentials remain outside the database rows.';