-- Privacy request and enterprise identity/integration hooks.

create extension if not exists pgcrypto;

create table if not exists public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  nxq_account_id uuid references public.nxq_accounts(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  request_code text not null unique default ('DSR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  request_type text not null check(request_type in ('export','delete','correct','restrict','consent_withdrawal')),
  status text not null default 'submitted' check(status in ('submitted','identity_check','queued','processing','ready','completed','denied','cancelled','failed')),
  requested_by_auth_user_id uuid references auth.users(id) on delete set null,
  scope jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error text,
  requested_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists data_subject_requests_account_idx on public.data_subject_requests(nxq_account_id,created_at desc);

create table if not exists public.enterprise_identity_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.nxq_organizations(id) on delete cascade,
  connection_type text not null check(connection_type in ('saml','oidc','scim')),
  provider_key text not null,
  status text not null default 'not_configured' check(status in ('not_configured','configured','testing','active','error','disabled')),
  domains text[] not null default '{}'::text[],
  config jsonb not null default '{}'::jsonb,
  required_secret_names text[] not null default '{}'::text[],
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,connection_type,provider_key)
);

create table if not exists public.enterprise_directory_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.nxq_organizations(id) on delete cascade,
  nxq_account_id uuid references public.nxq_accounts(id) on delete set null,
  external_directory_id text not null,
  email text,
  display_name text,
  role_key text not null default 'member',
  status text not null default 'active' check(status in ('active','suspended','deprovisioned')),
  attributes jsonb not null default '{}'::jsonb,
  provisioned_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,external_directory_id)
);

create table if not exists public.organization_role_permissions (
  organization_id uuid not null references public.nxq_organizations(id) on delete cascade,
  role_key text not null,
  permission_key text not null,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,role_key,permission_key)
);

alter table public.data_subject_requests enable row level security;
alter table public.enterprise_identity_connections enable row level security;
alter table public.enterprise_directory_users enable row level security;
alter table public.organization_role_permissions enable row level security;
revoke all on table public.data_subject_requests from public,anon;
revoke all on table public.enterprise_identity_connections from public,anon;
revoke all on table public.enterprise_directory_users from public,anon;
revoke all on table public.organization_role_permissions from public,anon;
grant select,insert on public.data_subject_requests to authenticated;
grant select on public.enterprise_identity_connections to authenticated;
grant select on public.enterprise_directory_users to authenticated;
grant select on public.organization_role_permissions to authenticated;
grant select,insert,update,delete on public.data_subject_requests to service_role;
grant select,insert,update,delete on public.enterprise_identity_connections to service_role;
grant select,insert,update,delete on public.enterprise_directory_users to service_role;
grant select,insert,update,delete on public.organization_role_permissions to service_role;

create policy account_manage_own_data_requests on public.data_subject_requests for all to authenticated
using(nxq_account_id=public.current_nxq_account_id() or (client_id is not null and exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid())))
with check(requested_by_auth_user_id=auth.uid() and (nxq_account_id=public.current_nxq_account_id() or (client_id is not null and exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()))));
create policy owner_manage_data_requests on public.data_subject_requests for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

create policy org_members_view_identity_connections on public.enterprise_identity_connections for select to authenticated
using(exists(select 1 from public.nxq_organization_memberships m where m.organization_id=enterprise_identity_connections.organization_id and m.nxq_account_id=public.current_nxq_account_id() and m.status='active'));
create policy owner_manage_identity_connections on public.enterprise_identity_connections for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy org_members_view_directory on public.enterprise_directory_users for select to authenticated
using(exists(select 1 from public.nxq_organization_memberships m where m.organization_id=enterprise_directory_users.organization_id and m.nxq_account_id=public.current_nxq_account_id() and m.status='active'));
create policy owner_manage_directory on public.enterprise_directory_users for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy org_members_view_role_permissions on public.organization_role_permissions for select to authenticated
using(exists(select 1 from public.nxq_organization_memberships m where m.organization_id=organization_role_permissions.organization_id and m.nxq_account_id=public.current_nxq_account_id() and m.status='active'));
create policy owner_manage_role_permissions on public.organization_role_permissions for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

create or replace function public.submit_current_account_data_request(target_request_type text,target_scope jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare account_uuid uuid; client_uuid uuid; request_uuid uuid;
begin
  if target_request_type not in ('export','delete','correct','restrict','consent_withdrawal') then raise exception 'Unsupported data request type.'; end if;
  account_uuid:=public.current_nxq_account_id();
  if account_uuid is null then raise exception 'NXQ account not found.'; end if;
  select id into client_uuid from public.clients where auth_user_id=auth.uid() order by created_at desc limit 1;
  if exists(select 1 from public.data_subject_requests r where r.nxq_account_id=account_uuid and r.request_type=target_request_type and r.status in ('submitted','identity_check','queued','processing','ready')) then raise exception 'A request of this type is already active.'; end if;
  insert into public.data_subject_requests(nxq_account_id,client_id,request_type,requested_by_auth_user_id,scope,due_at)
  values(account_uuid,client_uuid,target_request_type,auth.uid(),coalesce(target_scope,'{}'::jsonb),now()+interval '30 days') returning id into request_uuid;
  return request_uuid;
end; $$;
revoke all on function public.submit_current_account_data_request(text,jsonb) from public,anon;
grant execute on function public.submit_current_account_data_request(text,jsonb) to authenticated;

comment on table public.enterprise_identity_connections is 'Enterprise SAML/OIDC/SCIM connection metadata. Provider secrets remain in protected secret stores, not rows.';