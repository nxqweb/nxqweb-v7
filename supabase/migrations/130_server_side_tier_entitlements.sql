-- Server-side product-family/tier entitlement authority.
-- UI visibility is not authorization. Features default to denied unless explicitly enabled.

create table if not exists public.nxq_tier_entitlements (
  id uuid primary key default gen_random_uuid(),
  product_family_slug text not null,
  tier_key text not null,
  feature_key text not null,
  enabled boolean not null default false,
  limits jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_family_slug, tier_key, feature_key)
);

-- Business-family capability matrix. This is intentionally independent of price.
insert into public.nxq_tier_entitlements (product_family_slug, tier_key, feature_key, enabled, limits)
values
  ('business','starter','managed_website',true,'{}'),
  ('business','starter','client_portal',true,'{}'),
  ('business','starter','hosting_monitoring',true,'{}'),
  ('business','starter','basic_seo',true,'{}'),
  ('business','starter','lead_capture',true,'{}'),
  ('business','starter','advanced_analytics',false,'{}'),
  ('business','starter','advanced_seo',false,'{}'),
  ('business','starter','mouse_tracking',false,'{}'),
  ('business','starter','location_management',true,jsonb_build_object('max_locations',1)),
  ('business','starter','multi_location',false,jsonb_build_object('max_locations',1)),

  ('business','growth','managed_website',true,'{}'),
  ('business','growth','client_portal',true,'{}'),
  ('business','growth','hosting_monitoring',true,'{}'),
  ('business','growth','basic_seo',true,'{}'),
  ('business','growth','lead_capture',true,'{}'),
  ('business','growth','advanced_analytics',true,'{}'),
  ('business','growth','advanced_seo',false,'{}'),
  ('business','growth','mouse_tracking',false,'{}'),
  ('business','growth','location_management',true,jsonb_build_object('max_locations',1)),
  ('business','growth','multi_location',false,jsonb_build_object('max_locations',1)),

  ('business','intelligence','managed_website',true,'{}'),
  ('business','intelligence','client_portal',true,'{}'),
  ('business','intelligence','hosting_monitoring',true,'{}'),
  ('business','intelligence','basic_seo',true,'{}'),
  ('business','intelligence','lead_capture',true,'{}'),
  ('business','intelligence','advanced_analytics',true,'{}'),
  ('business','intelligence','advanced_seo',true,'{}'),
  ('business','intelligence','mouse_tracking',true,jsonb_build_object('consent_required',true,'retention_days',90)),
  ('business','intelligence','location_management',true,jsonb_build_object('max_locations',1)),
  ('business','intelligence','multi_location',false,jsonb_build_object('max_locations',1)),

  ('business','enterprise','managed_website',true,'{}'),
  ('business','enterprise','client_portal',true,'{}'),
  ('business','enterprise','hosting_monitoring',true,'{}'),
  ('business','enterprise','basic_seo',true,'{}'),
  ('business','enterprise','lead_capture',true,'{}'),
  ('business','enterprise','advanced_analytics',true,'{}'),
  ('business','enterprise','advanced_seo',true,'{}'),
  ('business','enterprise','mouse_tracking',true,jsonb_build_object('consent_required',true,'retention_days',90)),
  ('business','enterprise','location_management',true,jsonb_build_object('max_locations',100)),
  ('business','enterprise','multi_location',true,jsonb_build_object('max_locations',100))
on conflict (product_family_slug, tier_key, feature_key) do update
set enabled = excluded.enabled,
    limits = excluded.limits,
    updated_at = now();

alter table public.nxq_tier_entitlements enable row level security;
revoke all on table public.nxq_tier_entitlements from public, anon, authenticated;
grant select, insert, update, delete on table public.nxq_tier_entitlements to service_role;

drop policy if exists owner_manage_nxq_tier_entitlements on public.nxq_tier_entitlements;
create policy owner_manage_nxq_tier_entitlements
on public.nxq_tier_entitlements for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

grant select on table public.nxq_tier_entitlements to authenticated;

create or replace function public.current_client_feature_access(target_feature_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_row record;
  family_slug text;
  tier_key_value text;
  entitlement_row public.nxq_tier_entitlements%rowtype;
begin
  if nullif(btrim(target_feature_key), '') is null then
    return jsonb_build_object('allowed', false, 'reason', 'feature_key_required');
  end if;

  select c.id, c.status, pf.slug, pft.tier_key
  into client_row
  from public.clients c
  left join public.product_families pf on pf.id = c.product_family_id
  left join public.product_family_tiers pft on pft.id = c.product_tier_id
  where c.auth_user_id = auth.uid()
  order by c.created_at desc
  limit 1;

  if client_row.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'client_missing');
  end if;

  family_slug := coalesce(client_row.slug, 'business');
  tier_key_value := lower(coalesce(client_row.tier_key, 'starter'));

  select * into entitlement_row
  from public.nxq_tier_entitlements
  where product_family_slug = family_slug
    and tier_key = tier_key_value
    and feature_key = target_feature_key
  limit 1;

  if entitlement_row.id is null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'feature_not_entitled',
      'product_family_slug', family_slug,
      'tier_key', tier_key_value,
      'feature_key', target_feature_key
    );
  end if;

  return jsonb_build_object(
    'allowed', entitlement_row.enabled and client_row.status::text in ('approved','active','overdue'),
    'reason', case
      when client_row.status::text not in ('approved','active','overdue') then 'client_not_active'
      when not entitlement_row.enabled then 'tier_not_entitled'
      else 'allowed'
    end,
    'product_family_slug', family_slug,
    'tier_key', tier_key_value,
    'feature_key', target_feature_key,
    'limits', entitlement_row.limits
  );
end;
$$;

revoke all on function public.current_client_feature_access(text) from public, anon;
grant execute on function public.current_client_feature_access(text) to authenticated, service_role;

create or replace function public.client_feature_access(target_client_id uuid, target_feature_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_row record;
  entitlement_row public.nxq_tier_entitlements%rowtype;
  family_slug text;
  tier_key_value text;
begin
  if auth.role() <> 'service_role'
     and not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner or service-role access required.';
  end if;

  select c.id, c.status, pf.slug, pft.tier_key
  into client_row
  from public.clients c
  left join public.product_families pf on pf.id = c.product_family_id
  left join public.product_family_tiers pft on pft.id = c.product_tier_id
  where c.id = target_client_id;

  if client_row.id is null then return jsonb_build_object('allowed', false, 'reason', 'client_missing'); end if;

  family_slug := coalesce(client_row.slug, 'business');
  tier_key_value := lower(coalesce(client_row.tier_key, 'starter'));

  select * into entitlement_row
  from public.nxq_tier_entitlements
  where product_family_slug = family_slug and tier_key = tier_key_value and feature_key = target_feature_key;

  return jsonb_build_object(
    'allowed', coalesce(entitlement_row.enabled, false) and client_row.status::text in ('approved','active','overdue'),
    'product_family_slug', family_slug,
    'tier_key', tier_key_value,
    'feature_key', target_feature_key,
    'limits', coalesce(entitlement_row.limits, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.client_feature_access(uuid, text) from public, anon, authenticated;
grant execute on function public.client_feature_access(uuid, text) to service_role;
grant execute on function public.client_feature_access(uuid, text) to authenticated;

comment on function public.current_client_feature_access(text) is
  'Deny-by-default server-side feature entitlement check for the authenticated client. UI visibility must not substitute for this check.';
