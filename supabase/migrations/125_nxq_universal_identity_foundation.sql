-- NXQ universal identity foundation.
-- Establishes a durable NXQ ID that can span NXQ products while keeping
-- product membership and higher-assurance verification requirements separate.
--
-- Security rules:
-- - Do NOT store raw biometric templates, Face ID/Touch ID data, government-ID
--   document images, passwords, recovery codes, or provider secrets in these tables.
-- - Passkeys/biometric authentication should be performed by the device/auth provider;
--   NXQ stores only safe provider references / public verification state.
-- - Government-ID verification should prefer a specialized verification provider;
--   NXQ stores verification status and provider reference, not loose document copies.

create extension if not exists pgcrypto;

create table if not exists public.nxq_accounts (
  id uuid primary key default gen_random_uuid(),
  nxq_id text not null unique default ('NXQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  account_status text not null default 'active' check (account_status in ('active','restricted','suspended','closed')),
  assurance_level smallint not null default 0 check (assurance_level between 0 and 4),
  primary_email_verified boolean not null default false,
  primary_phone_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nxq_accounts is
  'Global NXQ identity account. One auth user maps to one NXQ ID across product families.';
comment on column public.nxq_accounts.nxq_id is
  'Human-safe public NXQ identifier. Never use this value alone as authentication.';

create table if not exists public.nxq_products (
  id uuid primary key default gen_random_uuid(),
  product_slug text not null unique,
  product_name text not null,
  status text not null default 'planned' check (status in ('planned','private_beta','active','paused','retired')),
  minimum_assurance_level smallint not null default 0 check (minimum_assurance_level between 0 and 4),
  verification_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.nxq_products (product_slug, product_name, status, minimum_assurance_level, verification_policy)
values
  ('web', 'NXQ Web', 'active', 0, jsonb_build_object('required', jsonb_build_array('email'))),
  ('systems', 'NXQ Systems', 'planned', 1, jsonb_build_object('required', jsonb_build_array('email'), 'step_up_for_admin', true)),
  ('security', 'NXQ Security', 'planned', 2, jsonb_build_object('required', jsonb_build_array('email','government_id_or_org_authority'))),
  ('health', 'NXQ Health', 'planned', 3, jsonb_build_object('required', jsonb_build_array('email','government_id'), 'regulated_data', true))
on conflict (product_slug) do nothing;

create table if not exists public.nxq_product_memberships (
  id uuid primary key default gen_random_uuid(),
  nxq_account_id uuid not null references public.nxq_accounts(id) on delete cascade,
  product_id uuid not null references public.nxq_products(id) on delete cascade,
  membership_status text not null default 'active' check (membership_status in ('pending','active','blocked','revoked')),
  product_role text not null default 'member',
  product_profile jsonb not null default '{}'::jsonb,
  enrolled_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nxq_account_id, product_id)
);

create table if not exists public.nxq_verification_claims (
  id uuid primary key default gen_random_uuid(),
  nxq_account_id uuid not null references public.nxq_accounts(id) on delete cascade,
  verification_type text not null check (verification_type in (
    'email','phone','address','age','government_id','organization_authority',
    'passkey','device_biometric_assertion','enhanced_identity'
  )),
  status text not null default 'pending' check (status in ('pending','verified','failed','expired','revoked')),
  assurance_level smallint not null default 0 check (assurance_level between 0 and 4),
  provider text,
  provider_reference text,
  verified_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or verified_at is null or expires_at > verified_at)
);

comment on table public.nxq_verification_claims is
  'Verification state only. Never store raw biometric templates, passwords, recovery codes, government-ID images, or secret provider credentials here.';

create index if not exists nxq_verification_claims_account_type_idx
  on public.nxq_verification_claims(nxq_account_id, verification_type, status, created_at desc);

create table if not exists public.nxq_product_verification_requirements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.nxq_products(id) on delete cascade,
  capability_key text not null default 'base_access',
  minimum_assurance_level smallint not null default 0 check (minimum_assurance_level between 0 and 4),
  required_claim_types text[] not null default '{}'::text[],
  step_up_required boolean not null default false,
  policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, capability_key)
);

create table if not exists public.nxq_organizations (
  id uuid primary key default gen_random_uuid(),
  organization_code text not null unique default ('ORG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  legal_name text not null,
  display_name text,
  organization_type text not null default 'business' check (organization_type in ('business','nonprofit','government','school','household','other')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','pending','verified','rejected','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nxq_organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.nxq_organizations(id) on delete cascade,
  nxq_account_id uuid not null references public.nxq_accounts(id) on delete cascade,
  role_key text not null default 'member',
  status text not null default 'active' check (status in ('invited','active','suspended','revoked')),
  authority_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, nxq_account_id)
);

-- Give NXQ Web clients a stable product-specific client code while preserving
-- the existing UUID primary key used throughout the application.
alter table public.clients
  add column if not exists nxq_account_id uuid references public.nxq_accounts(id) on delete set null,
  add column if not exists client_code text;

update public.clients
set client_code = 'WEB-' || upper(substr(replace(id::text, '-', ''), 1, 12))
where client_code is null;

create unique index if not exists clients_client_code_unique_idx
  on public.clients(client_code)
  where client_code is not null;
create index if not exists clients_nxq_account_idx
  on public.clients(nxq_account_id);

create or replace function public.ensure_nxq_account_for_auth_user(target_auth_user_id uuid, target_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id uuid;
begin
  if target_auth_user_id is null then
    raise exception 'Auth user id is required.';
  end if;

  insert into public.nxq_accounts (auth_user_id, display_name)
  values (target_auth_user_id, nullif(btrim(target_display_name), ''))
  on conflict (auth_user_id) do update
    set display_name = coalesce(public.nxq_accounts.display_name, excluded.display_name),
        updated_at = now()
  returning id into account_id;

  return account_id;
end;
$$;

revoke all on function public.ensure_nxq_account_for_auth_user(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_nxq_account_for_auth_user(uuid, text) to service_role;

create or replace function public.attach_client_to_nxq_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id uuid;
  web_product_id uuid;
begin
  if new.client_code is null then
    new.client_code := 'WEB-' || upper(substr(replace(new.id::text, '-', ''), 1, 12));
  end if;

  if new.auth_user_id is not null then
    account_id := public.ensure_nxq_account_for_auth_user(new.auth_user_id, coalesce(new.contact_name, new.business_name));
    new.nxq_account_id := account_id;

    select id into web_product_id from public.nxq_products where product_slug = 'web';
    if web_product_id is not null then
      insert into public.nxq_product_memberships (nxq_account_id, product_id, membership_status, product_role)
      values (account_id, web_product_id, 'active', 'client')
      on conflict (nxq_account_id, product_id) do update
        set membership_status = 'active',
            updated_at = now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists attach_client_to_nxq_account on public.clients;
create trigger attach_client_to_nxq_account
before insert or update of auth_user_id on public.clients
for each row execute function public.attach_client_to_nxq_account();

-- Backfill existing authenticated NXQ Web clients into the global identity layer.
do $$
declare
  client_row record;
  account_id uuid;
  web_product_id uuid;
begin
  select id into web_product_id from public.nxq_products where product_slug = 'web';

  for client_row in
    select id, auth_user_id, contact_name, business_name
    from public.clients
    where auth_user_id is not null
  loop
    account_id := public.ensure_nxq_account_for_auth_user(
      client_row.auth_user_id,
      coalesce(client_row.contact_name, client_row.business_name)
    );

    update public.clients
    set nxq_account_id = account_id,
        client_code = coalesce(client_code, 'WEB-' || upper(substr(replace(id::text, '-', ''), 1, 12)))
    where id = client_row.id;

    if web_product_id is not null then
      insert into public.nxq_product_memberships (nxq_account_id, product_id, membership_status, product_role)
      values (account_id, web_product_id, 'active', 'client')
      on conflict (nxq_account_id, product_id) do nothing;
    end if;
  end loop;
end;
$$;

create or replace function public.current_nxq_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.nxq_accounts where auth_user_id = auth.uid() limit 1;
$$;

revoke all on function public.current_nxq_account_id() from public, anon;
grant execute on function public.current_nxq_account_id() to authenticated, service_role;

create or replace function public.nxq_product_access_status(target_product_slug text, target_capability_key text default 'base_access')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  account_row public.nxq_accounts%rowtype;
  product_row public.nxq_products%rowtype;
  requirement_row public.nxq_product_verification_requirements%rowtype;
  missing_claims text[] := '{}'::text[];
  claim_type text;
begin
  select * into account_row from public.nxq_accounts where auth_user_id = auth.uid();
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'nxq_account_missing');
  end if;

  select * into product_row from public.nxq_products where product_slug = target_product_slug;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'product_unknown');
  end if;

  select * into requirement_row
  from public.nxq_product_verification_requirements
  where product_id = product_row.id and capability_key = target_capability_key;

  if not found then
    requirement_row.minimum_assurance_level := product_row.minimum_assurance_level;
    requirement_row.required_claim_types := '{}'::text[];
    requirement_row.step_up_required := false;
  end if;

  foreach claim_type in array coalesce(requirement_row.required_claim_types, '{}'::text[])
  loop
    if not exists (
      select 1 from public.nxq_verification_claims vc
      where vc.nxq_account_id = account_row.id
        and vc.verification_type = claim_type
        and vc.status = 'verified'
        and (vc.expires_at is null or vc.expires_at > now())
    ) then
      missing_claims := array_append(missing_claims, claim_type);
    end if;
  end loop;

  return jsonb_build_object(
    'allowed', account_row.account_status = 'active'
      and account_row.assurance_level >= requirement_row.minimum_assurance_level
      and cardinality(missing_claims) = 0,
    'nxq_id', account_row.nxq_id,
    'account_status', account_row.account_status,
    'current_assurance_level', account_row.assurance_level,
    'required_assurance_level', requirement_row.minimum_assurance_level,
    'missing_claims', to_jsonb(missing_claims),
    'step_up_required', requirement_row.step_up_required
  );
end;
$$;

revoke all on function public.nxq_product_access_status(text, text) from public, anon;
grant execute on function public.nxq_product_access_status(text, text) to authenticated, service_role;

-- RLS: users can see their own global identity state. Verification mutations remain
-- owner/service-side until dedicated verified flows are implemented.
alter table public.nxq_accounts enable row level security;
alter table public.nxq_products enable row level security;
alter table public.nxq_product_memberships enable row level security;
alter table public.nxq_verification_claims enable row level security;
alter table public.nxq_product_verification_requirements enable row level security;
alter table public.nxq_organizations enable row level security;
alter table public.nxq_organization_memberships enable row level security;

revoke all on table public.nxq_accounts from public, anon;
revoke all on table public.nxq_products from public, anon;
revoke all on table public.nxq_product_memberships from public, anon;
revoke all on table public.nxq_verification_claims from public, anon;
revoke all on table public.nxq_product_verification_requirements from public, anon;
revoke all on table public.nxq_organizations from public, anon;
revoke all on table public.nxq_organization_memberships from public, anon;

grant select on public.nxq_accounts to authenticated;
grant select on public.nxq_products to authenticated;
grant select on public.nxq_product_memberships to authenticated;
grant select on public.nxq_verification_claims to authenticated;
grant select on public.nxq_product_verification_requirements to authenticated;
grant select on public.nxq_organizations to authenticated;
grant select on public.nxq_organization_memberships to authenticated;

grant select, insert, update, delete on public.nxq_accounts to service_role;
grant select, insert, update, delete on public.nxq_products to service_role;
grant select, insert, update, delete on public.nxq_product_memberships to service_role;
grant select, insert, update, delete on public.nxq_verification_claims to service_role;
grant select, insert, update, delete on public.nxq_product_verification_requirements to service_role;
grant select, insert, update, delete on public.nxq_organizations to service_role;
grant select, insert, update, delete on public.nxq_organization_memberships to service_role;

create policy nxq_account_self_read on public.nxq_accounts
for select to authenticated
using (auth_user_id = auth.uid());

create policy nxq_products_authenticated_read on public.nxq_products
for select to authenticated
using (true);

create policy nxq_product_membership_self_read on public.nxq_product_memberships
for select to authenticated
using (nxq_account_id = public.current_nxq_account_id());

create policy nxq_verification_claim_self_read on public.nxq_verification_claims
for select to authenticated
using (nxq_account_id = public.current_nxq_account_id());

create policy nxq_product_requirements_authenticated_read on public.nxq_product_verification_requirements
for select to authenticated
using (true);

create policy nxq_organization_member_read on public.nxq_organizations
for select to authenticated
using (exists (
  select 1 from public.nxq_organization_memberships m
  where m.organization_id = nxq_organizations.id
    and m.nxq_account_id = public.current_nxq_account_id()
    and m.status = 'active'
));

create policy nxq_organization_membership_self_read on public.nxq_organization_memberships
for select to authenticated
using (nxq_account_id = public.current_nxq_account_id());

comment on function public.nxq_product_access_status(text, text) is
  'Returns whether the current NXQ ID satisfies a product/capability assurance requirement and which verification claims are still missing.';
