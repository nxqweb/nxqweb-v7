-- NXQ automation governance, privacy, and account-security foundation.
-- No raw biometrics, passwords, recovery codes, ID images, or provider secrets belong here.

create extension if not exists pgcrypto;

create table if not exists public.automation_governance_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  version integer not null default 1,
  scope_type text not null default 'global' check(scope_type in ('global','product_family','client','project','provider','feature')),
  scope_reference text,
  enabled boolean not null default true,
  mode text not null default 'active' check(mode in ('active','dry_run','paused','disabled','canary')),
  rollout_percent smallint not null default 100 check(rollout_percent between 0 and 100),
  policy jsonb not null default '{}'::jsonb,
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique(rule_key,version,scope_type,scope_reference)
);

create table if not exists public.automation_kill_switches (
  id uuid primary key default gen_random_uuid(),
  switch_key text not null unique,
  scope_type text not null check(scope_type in ('global','product_family','client','project','provider','feature')),
  scope_reference text,
  is_paused boolean not null default false,
  reason text,
  changed_by_auth_user_id uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.privacy_consents (
  id uuid primary key default gen_random_uuid(),
  nxq_account_id uuid references public.nxq_accounts(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  consent_type text not null check(consent_type in ('analytics','heatmaps','marketing_email','marketing_sms','cookies','product_terms','privacy_policy','data_processing')),
  policy_version text not null,
  status text not null check(status in ('granted','denied','withdrawn','expired')),
  source text not null default 'portal',
  evidence jsonb not null default '{}'::jsonb,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists privacy_consents_account_type_idx on public.privacy_consents(nxq_account_id,consent_type,created_at desc);

create table if not exists public.data_retention_policies (
  policy_key text primary key,
  category text not null,
  retention_days integer,
  hard_delete_after_days integer,
  legal_hold_supported boolean not null default false,
  policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.data_retention_policies(policy_key,category,retention_days,hard_delete_after_days,legal_hold_supported)
values
 ('analytics_raw','analytics',90,120,false),
 ('analytics_aggregates','analytics',730,800,false),
 ('automation_audit','operations',2555,null,true),
 ('client_messages','communications',1095,null,true),
 ('security_events','security',2555,null,true),
 ('verification_references','identity',365,null,true)
on conflict(policy_key) do nothing;

create table if not exists public.account_security_events (
  id uuid primary key default gen_random_uuid(),
  nxq_account_id uuid references public.nxq_accounts(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check(severity in ('info','warning','high','critical')),
  trusted boolean not null default false,
  ip_hash text,
  user_agent_family text,
  device_reference text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists account_security_events_account_idx on public.account_security_events(nxq_account_id,created_at desc);

create table if not exists public.nxq_trusted_credentials (
  id uuid primary key default gen_random_uuid(),
  nxq_account_id uuid not null references public.nxq_accounts(id) on delete cascade,
  credential_type text not null check(credential_type in ('passkey','security_key','platform_authenticator','trusted_device')),
  credential_reference text not null,
  display_name text,
  public_key_reference text,
  assurance_level smallint not null default 1 check(assurance_level between 0 and 4),
  status text not null default 'active' check(status in ('pending','active','revoked','expired')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(nxq_account_id,credential_reference)
);
comment on table public.nxq_trusted_credentials is 'Safe credential/provider references only. Never stores Face ID/Touch ID/fingerprint/face templates or private keys.';

create table if not exists public.step_up_auth_requirements (
  capability_key text primary key,
  minimum_assurance_level smallint not null default 1 check(minimum_assurance_level between 0 and 4),
  require_recent_auth_minutes integer,
  require_passkey boolean not null default false,
  enabled boolean not null default true,
  policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.step_up_auth_requirements(capability_key,minimum_assurance_level,require_recent_auth_minutes,require_passkey)
values
 ('owner_publish_production',2,15,true),
 ('owner_change_provider_credentials',2,10,true),
 ('nxq_identity_high_risk_change',2,10,true),
 ('organization_transfer_ownership',2,10,true)
on conflict(capability_key) do nothing;

alter table public.automation_governance_rules enable row level security;
alter table public.automation_kill_switches enable row level security;
alter table public.privacy_consents enable row level security;
alter table public.data_retention_policies enable row level security;
alter table public.account_security_events enable row level security;
alter table public.nxq_trusted_credentials enable row level security;
alter table public.step_up_auth_requirements enable row level security;

revoke all on table public.automation_governance_rules from public,anon,authenticated;
revoke all on table public.automation_kill_switches from public,anon,authenticated;
revoke all on table public.data_retention_policies from public,anon,authenticated;
revoke all on table public.step_up_auth_requirements from public,anon,authenticated;
revoke all on table public.privacy_consents from public,anon;
revoke all on table public.account_security_events from public,anon;
revoke all on table public.nxq_trusted_credentials from public,anon;

grant select,insert,update,delete on public.automation_governance_rules to service_role;
grant select,insert,update,delete on public.automation_kill_switches to service_role;
grant select,insert,update,delete on public.privacy_consents to service_role;
grant select,insert,update,delete on public.data_retention_policies to service_role;
grant select,insert,update,delete on public.account_security_events to service_role;
grant select,insert,update,delete on public.nxq_trusted_credentials to service_role;
grant select,insert,update,delete on public.step_up_auth_requirements to service_role;
grant select,insert on public.privacy_consents to authenticated;
grant select on public.account_security_events to authenticated;
grant select on public.nxq_trusted_credentials to authenticated;

create policy client_manage_own_consents on public.privacy_consents for all to authenticated
using (
  (nxq_account_id is not null and nxq_account_id = public.current_nxq_account_id())
  or (client_id is not null and exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()))
)
with check (
  (nxq_account_id is not null and nxq_account_id = public.current_nxq_account_id())
  or (client_id is not null and exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()))
);
create policy client_read_own_security_events on public.account_security_events for select to authenticated
using(nxq_account_id=public.current_nxq_account_id());
create policy client_read_own_credentials on public.nxq_trusted_credentials for select to authenticated
using(nxq_account_id=public.current_nxq_account_id());

create policy owner_manage_governance on public.automation_governance_rules for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy owner_manage_kill_switches on public.automation_kill_switches for all to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()))
with check(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy owner_read_retention on public.data_retention_policies for select to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));
create policy owner_read_step_up on public.step_up_auth_requirements for select to authenticated
using(exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()));

create or replace function public.nxq_automation_scope_allowed(target_scope_type text,target_scope_reference text default null)
returns boolean language sql stable security definer set search_path=public as $$
  select not exists(
    select 1 from public.automation_kill_switches s
    where s.is_paused
      and (
        s.scope_type='global'
        or (s.scope_type=target_scope_type and coalesce(s.scope_reference,'')=coalesce(target_scope_reference,''))
      )
  );
$$;
revoke all on function public.nxq_automation_scope_allowed(text,text) from public,anon,authenticated;
grant execute on function public.nxq_automation_scope_allowed(text,text) to service_role;

comment on table public.automation_kill_switches is 'Central pause/kill-switch registry used before autonomous work or provider mutation.';
comment on table public.privacy_consents is 'Versioned user/client consent evidence for analytics, heatmaps, marketing and policy acceptance.';