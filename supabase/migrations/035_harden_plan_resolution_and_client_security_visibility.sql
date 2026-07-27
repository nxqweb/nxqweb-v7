-- Final audit hardening:
-- 1) stale plan requests cannot be approved into unavailable families or tiers;
-- 2) clients receive only a safe security overview, not raw incident evidence or AI findings.

create or replace function public.resolve_client_plan_change(
  target_approval_id uuid,
  decision_status text,
  owner_response_text text,
  one_time_fee numeric default null,
  approved_monthly_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_is_authorized boolean;
  approval_row public.owner_approval_requests%rowtype;
  request_row public.client_plan_change_requests%rowtype;
  family_row public.product_families%rowtype;
  tier_row public.product_family_tiers%rowtype;
  clean_note text;
  clean_decision text;
  final_monthly_price numeric;
begin
  select exists (
    select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()
  ) into owner_is_authorized;

  if not owner_is_authorized then
    raise exception 'Owner access is required.';
  end if;

  clean_decision := lower(trim(coalesce(decision_status, '')));
  clean_note := trim(coalesce(owner_response_text, ''));

  if clean_decision not in ('accepted', 'denied') then
    raise exception 'Decision must be accepted or denied.';
  end if;

  if clean_note = '' then
    raise exception 'An owner note is required.';
  end if;

  if one_time_fee is not null and one_time_fee < 0 then
    raise exception 'One-time fee cannot be negative.';
  end if;

  select * into approval_row
  from public.owner_approval_requests
  where id = target_approval_id
  for update;

  if approval_row.id is null then
    raise exception 'Approval request was not found.';
  end if;

  if approval_row.request_type <> 'client_plan_change' then
    raise exception 'This approval is not a client plan-change request.';
  end if;

  if approval_row.status <> 'pending' then
    raise exception 'This approval has already been resolved.';
  end if;

  select * into request_row
  from public.client_plan_change_requests
  where owner_approval_request_id = approval_row.id
  for update;

  if request_row.id is null then
    raise exception 'The linked plan-change request was not found.';
  end if;

  if request_row.status <> 'pending_owner_review' then
    raise exception 'This plan-change request is no longer pending owner review.';
  end if;

  select * into family_row
  from public.product_families
  where id = request_row.requested_product_family_id;

  select * into tier_row
  from public.product_family_tiers
  where id = request_row.requested_product_tier_id
    and product_family_id = request_row.requested_product_family_id;

  if family_row.id is null or tier_row.id is null then
    raise exception 'The requested family or tier no longer exists.';
  end if;

  if clean_decision = 'accepted' then
    if family_row.is_active is distinct from true
       or family_row.public_status not in ('available', 'beta') then
      raise exception 'This product family is not currently available for approval.';
    end if;

    if tier_row.is_active is distinct from true
       or tier_row.public_status not in ('available', 'beta') then
      raise exception 'This product tier is not currently available for approval.';
    end if;

    if tier_row.tier_key = 'enterprise' then
      if approved_monthly_price is null or approved_monthly_price <= 0 then
        raise exception 'Enterprise approval requires a positive monthly price.';
      end if;
      final_monthly_price := approved_monthly_price;
    else
      if tier_row.monthly_price is null then
        raise exception 'The selected tier does not have an active monthly price.';
      end if;
      final_monthly_price := tier_row.monthly_price;
    end if;

    update public.clients
    set product_family_id = request_row.requested_product_family_id,
        product_tier_id = request_row.requested_product_tier_id,
        monthly_price = final_monthly_price,
        updated_at = now()
    where id = request_row.client_id;

    update public.projects
    set product_family_id = request_row.requested_product_family_id,
        product_tier_id = request_row.requested_product_tier_id,
        updated_at = now()
    where client_id = request_row.client_id;

    update public.client_plan_change_requests
    set status = 'completed',
        requested_monthly_price = final_monthly_price,
        one_time_change_fee = one_time_fee,
        owner_note = clean_note,
        resolved_at = now()
    where id = request_row.id;

    update public.owner_approval_requests
    set status = 'accepted',
        owner_response = clean_note,
        resolved_at = now()
    where id = approval_row.id;

    insert into public.activity_logs (client_id, actor_type, action, details)
    values (
      request_row.client_id,
      'owner',
      'client_plan_change_approved',
      jsonb_build_object(
        'approval_id', approval_row.id,
        'plan_change_request_id', request_row.id,
        'product_family', family_row.slug,
        'tier', tier_row.tier_key,
        'monthly_price', final_monthly_price,
        'one_time_fee', one_time_fee,
        'owner_note', clean_note
      )
    );

    return jsonb_build_object(
      'status', 'completed',
      'monthly_price', final_monthly_price,
      'message', format(
        'Plan changed to %s %s. Monthly price is now $%s/month.',
        family_row.name,
        tier_row.name,
        trim(to_char(final_monthly_price, 'FM999999990.00'))
      )
    );
  end if;

  update public.client_plan_change_requests
  set status = 'denied',
      one_time_change_fee = one_time_fee,
      owner_note = clean_note,
      resolved_at = now()
  where id = request_row.id;

  update public.owner_approval_requests
  set status = 'denied',
      owner_response = clean_note,
      resolved_at = now()
  where id = approval_row.id;

  insert into public.activity_logs (client_id, actor_type, action, details)
  values (
    request_row.client_id,
    'owner',
    'client_plan_change_denied',
    jsonb_build_object(
      'approval_id', approval_row.id,
      'plan_change_request_id', request_row.id,
      'one_time_fee', one_time_fee,
      'owner_note', clean_note
    )
  );

  return jsonb_build_object(
    'status', 'denied',
    'message', 'Plan-change request denied. The current client plan was not changed.'
  );
end;
$$;

revoke all on function public.resolve_client_plan_change(uuid, text, text, numeric, numeric)
  from public, anon;
grant execute on function public.resolve_client_plan_change(uuid, text, text, numeric, numeric)
  to authenticated;

-- Remove direct client access to raw monitoring and incident records.
drop policy if exists clients_view_own_website_security_profiles
  on public.website_security_profiles;
drop policy if exists clients_view_own_website_health_checks
  on public.website_health_checks;
drop policy if exists clients_view_own_website_security_incidents
  on public.website_security_incidents;

create or replace function public.get_client_security_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  profile_row public.website_security_profiles%rowtype;
  latest_check_row public.website_health_checks%rowtype;
  active_incident_count integer := 0;
begin
  select * into client_row
  from public.clients
  where auth_user_id = auth.uid()
  limit 1;

  if client_row.id is null then
    raise exception 'Client workspace not found.';
  end if;

  select * into profile_row
  from public.website_security_profiles
  where client_id = client_row.id
  order by updated_at desc
  limit 1;

  if profile_row.id is null then
    return jsonb_build_object(
      'profile', null,
      'latest_check', null,
      'active_incidents', 0
    );
  end if;

  select * into latest_check_row
  from public.website_health_checks
  where security_profile_id = profile_row.id
  order by checked_at desc
  limit 1;

  select count(*)::integer into active_incident_count
  from public.website_security_incidents
  where security_profile_id = profile_row.id
    and status in ('open', 'investigating', 'repair_prepared', 'awaiting_owner');

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'monitoring_status', profile_row.monitoring_status,
      'website_health', profile_row.website_health,
      'ssl_status', profile_row.ssl_status,
      'monitored_url', profile_row.monitored_url,
      'threats_blocked_total', profile_row.threats_blocked_total,
      'last_scan_at', profile_row.last_scan_at
    ),
    'latest_check', case
      when latest_check_row.id is null then null
      else jsonb_build_object(
        'status', latest_check_row.status,
        'check_type', latest_check_row.check_type,
        'response_time_ms', latest_check_row.response_time_ms,
        'http_status', latest_check_row.http_status,
        'checked_at', latest_check_row.checked_at
      )
    end,
    'active_incidents', active_incident_count
  );
end;
$$;

revoke all on function public.get_client_security_overview() from public, anon;
grant execute on function public.get_client_security_overview() to authenticated;

comment on function public.get_client_security_overview() is
  'Returns a client-safe website security summary without raw incident evidence, AI findings, repair branches, or internal error details.';
