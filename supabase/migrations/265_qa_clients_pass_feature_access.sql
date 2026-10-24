-- Migration 265: let NXQ-owned QA-only clients pass the managed-website feature check (applied only after owner approval).
--
-- Why: migration 246's client_feature_access() requires billing_status in ('active','past_due'). QA-only clients are permanently locked to
-- 'not_configured' billing by migration 181 (enforce_qa_client_nonbillable), so since 246 every QA build-plan job fails with
-- "The current Business subscription is not entitled to managed website planning" and no disposable QA approve-run can pass the strict evidence check.
--
-- What changes: only the billing condition, and only for qa_only clients. Everything else is identical to migration 246's definition: the tier entitlement
-- must still be enabled, the client status must still be approved/active/overdue, and a stopped pipeline still denies. Real (non-QA) clients are unaffected.
-- QA clients stay blocked from billing artifacts and external notifications by the existing triggers; this does not touch them.

create or replace function public.client_feature_access(target_client_id uuid,target_feature_key text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare client_row record; entitlement public.nxq_tier_entitlements%rowtype; billing_ok boolean;
begin
  if auth.role()<>'service_role' and not public.is_nxq_owner() then raise exception 'Owner or service-role access required.'; end if;
  select c.id,c.status::text client_status,c.billing_status::text billing_status,c.pipeline_stopped_at,coalesce(c.qa_only,false) qa_only,
    pf.slug family_slug,pft.tier_key into client_row
  from public.clients c join public.product_families pf on pf.id=c.product_family_id and pf.is_active=true
  join public.product_family_tiers pft on pft.id=c.product_tier_id and pft.product_family_id=pf.id and pft.is_active=true
  where c.id=target_client_id;
  if client_row.id is null then return jsonb_build_object('allowed',false,'reason','client_family_or_tier_missing'); end if;
  select * into entitlement from public.nxq_tier_entitlements where product_family_slug=client_row.family_slug
    and tier_key=client_row.tier_key and feature_key=target_feature_key;
  billing_ok:=client_row.billing_status in ('active','past_due') or client_row.qa_only;
  return jsonb_build_object('allowed',coalesce(entitlement.enabled,false)
      and client_row.client_status in ('approved','active','overdue')
      and billing_ok and client_row.pipeline_stopped_at is null,
    'reason',case when client_row.pipeline_stopped_at is not null then 'pipeline_stopped'
      when client_row.client_status not in ('approved','active','overdue') then 'client_not_active'
      when not billing_ok then 'billing_not_active'
      when entitlement.id is null then 'feature_not_entitled' when not entitlement.enabled then 'tier_not_entitled' else 'allowed' end,
    'product_family_slug',client_row.family_slug,'tier_key',client_row.tier_key,
    'feature_key',target_feature_key,'limits',coalesce(entitlement.limits,'{}'::jsonb));
end; $$;

revoke all on function public.client_feature_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.client_feature_access(uuid,text) to authenticated,service_role;
