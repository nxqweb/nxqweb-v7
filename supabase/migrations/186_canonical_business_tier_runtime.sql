-- Align runtime entitlements with the authoritative public catalog:
-- Starter, Growth, Intelligence, Enterprise. Retire stale Pro/Premium keys and
-- keep analytics/heatmaps synchronized after upgrades, downgrades, or freezes.

delete from public.nxq_tier_entitlements
where product_family_slug='business' and tier_key in ('pro','premium');

insert into public.nxq_tier_entitlements(product_family_slug,tier_key,feature_key,enabled,limits)
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
on conflict(product_family_slug,tier_key,feature_key) do update set
  enabled=excluded.enabled,limits=excluded.limits,updated_at=now();

revoke insert,update,delete on public.nxq_tier_entitlements from authenticated;
grant select on public.nxq_tier_entitlements to authenticated;

create or replace function public.current_client_feature_access(target_feature_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  client_row record;
  entitlement_row public.nxq_tier_entitlements%rowtype;
  family_slug text;
  tier_key_value text;
begin
  if nullif(btrim(target_feature_key),'') is null then
    return jsonb_build_object('allowed',false,'reason','feature_key_required');
  end if;
  select c.id,c.status,pf.slug,pft.tier_key into client_row
  from public.clients c
  left join public.product_families pf on pf.id=c.product_family_id
  left join public.product_family_tiers pft on pft.id=c.product_tier_id
  where c.auth_user_id=auth.uid() order by c.created_at desc limit 1;
  if client_row.id is null then return jsonb_build_object('allowed',false,'reason','client_missing'); end if;
  family_slug:=coalesce(client_row.slug,'business');
  tier_key_value:=lower(coalesce(client_row.tier_key,'starter'));
  select * into entitlement_row from public.nxq_tier_entitlements
  where product_family_slug=family_slug and tier_key=tier_key_value and feature_key=target_feature_key;
  if not found then return jsonb_build_object(
    'allowed',false,'reason','feature_not_entitled','product_family_slug',family_slug,
    'tier_key',tier_key_value,'feature_key',target_feature_key,'limits','{}'::jsonb
  ); end if;
  return jsonb_build_object(
    'allowed',entitlement_row.enabled and client_row.status::text in ('approved','active','overdue'),
    'reason',case
      when client_row.status::text not in ('approved','active','overdue') then 'client_not_active'
      when not entitlement_row.enabled then 'tier_not_entitled' else 'allowed' end,
    'product_family_slug',family_slug,'tier_key',tier_key_value,
    'feature_key',target_feature_key,'limits',entitlement_row.limits
  );
end;
$$;

create or replace function public.client_feature_access(target_client_id uuid,target_feature_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  client_row record;
  entitlement_row public.nxq_tier_entitlements%rowtype;
  family_slug text;
  tier_key_value text;
begin
  if auth.role()<>'service_role'
     and not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then
    raise exception 'Owner or service-role access required.';
  end if;
  select c.id,c.status,pf.slug,pft.tier_key into client_row
  from public.clients c
  left join public.product_families pf on pf.id=c.product_family_id
  left join public.product_family_tiers pft on pft.id=c.product_tier_id
  where c.id=target_client_id;
  if client_row.id is null then return jsonb_build_object('allowed',false,'reason','client_missing'); end if;
  family_slug:=coalesce(client_row.slug,'business');
  tier_key_value:=lower(coalesce(client_row.tier_key,'starter'));
  select * into entitlement_row from public.nxq_tier_entitlements
  where product_family_slug=family_slug and tier_key=tier_key_value and feature_key=target_feature_key;
  return jsonb_build_object(
    'allowed',coalesce(entitlement_row.enabled,false) and client_row.status::text in ('approved','active','overdue'),
    'reason',case
      when client_row.status::text not in ('approved','active','overdue') then 'client_not_active'
      when entitlement_row.id is null then 'feature_not_entitled'
      when not entitlement_row.enabled then 'tier_not_entitled' else 'allowed' end,
    'product_family_slug',family_slug,'tier_key',tier_key_value,
    'feature_key',target_feature_key,'limits',coalesce(entitlement_row.limits,'{}'::jsonb)
  );
end;
$$;

revoke all on function public.current_client_feature_access(text) from public,anon,authenticated,service_role;
revoke all on function public.client_feature_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.current_client_feature_access(text) to authenticated;
grant execute on function public.client_feature_access(uuid,text) to authenticated,service_role;

create or replace function public.sync_client_analytics_entitlements()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  tier_key_value text;
  eligible boolean;
  analytics_allowed boolean;
  mouse_allowed boolean;
begin
  select tier_key into tier_key_value from public.product_family_tiers
  where id=new.product_tier_id and product_family_id=new.product_family_id;
  eligible:=new.status::text in ('approved','active','overdue');
  analytics_allowed:=eligible and tier_key_value in ('growth','intelligence','enterprise');
  mouse_allowed:=eligible and tier_key_value in ('intelligence','enterprise');
  update public.website_analytics_profiles set
    status=case when not analytics_allowed then 'disabled'
      when status='paused' then 'paused' else 'enabled' end,
    mouse_tracking_enabled=mouse_allowed,
    retention_days=case when mouse_allowed then 90 else 30 end,
    updated_at=now()
  where client_id=new.id;
  if found then
    insert into public.automation_audit_log(client_id,event_type,actor_type,details)
    values(new.id,'client_analytics_entitlements_synced','backend',jsonb_build_object(
      'tier_key',tier_key_value,'client_status',new.status::text,
      'advanced_analytics_allowed',analytics_allowed,'mouse_tracking_allowed',mouse_allowed,
      'consent_required',true
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists sync_client_analytics_entitlements on public.clients;
create trigger sync_client_analytics_entitlements
after update of product_family_id,product_tier_id,status on public.clients
for each row when(
  old.product_family_id is distinct from new.product_family_id
  or old.product_tier_id is distinct from new.product_tier_id
  or old.status is distinct from new.status
)
execute function public.sync_client_analytics_entitlements();

update public.website_analytics_profiles profile
set
  status=case
    when client.status::text not in ('approved','active','overdue') then 'disabled'
    when tier.tier_key not in ('growth','intelligence','enterprise') then 'disabled'
    when profile.status='paused' then 'paused' else 'enabled' end,
  mouse_tracking_enabled=(
    client.status::text in ('approved','active','overdue')
    and tier.tier_key in ('intelligence','enterprise')
  ),
  retention_days=case when (
    client.status::text in ('approved','active','overdue')
    and tier.tier_key in ('intelligence','enterprise')
  ) then 90 else 30 end,
  updated_at=now()
from public.clients client
join public.product_family_tiers tier on tier.id=client.product_tier_id
where profile.client_id=client.id;

revoke all on function public.sync_client_analytics_entitlements() from public,anon,authenticated,service_role;

comment on function public.sync_client_analytics_entitlements() is
  'Fail-closed runtime synchronization for Business analytics and consent-gated heatmaps after tier/lifecycle changes.';
