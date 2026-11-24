-- Draft 11: the server side of the automatic store-background maker (added 2026-11-24). ADDITIVE: two new tables and eight new functions; nothing existing is changed.
-- REQUIRES draft 10 (the look check must already accept an own-folder `background`): apply 10 first.
-- Plan: docs/BACKGROUND_GENERATION_PLAN.md. The picture maker itself (a provider account, its key as a server secret, an Edge function that calls it) is NOT here and
-- NOT built: this is the counter, the owner's limits and the owner's approve-or-reject step, so adding a provider later is the only missing piece.
--
-- Everything fails closed: the master switch starts OFF, the per-store allowance starts at 0 and the monthly ceiling starts at 0, so nothing can be requested until the owner sets numbers.
-- Counted in pictures, never in money. A request counts from the moment a slot is claimed, whatever happens next (failed and rejected tries count). A generated picture NEVER goes live by itself:
-- it ends 'pending_approval' and only the owner's approval writes it into the store look.

create table if not exists public.nxq_background_settings (
  id boolean primary key default true check (id),
  switched_on boolean not null default false,
  per_store_allowance integer not null default 0 check (per_store_allowance between 0 and 50),
  period_days integer not null default 365 check (period_days between 1 and 3650),
  monthly_cap integer not null default 0 check (monthly_cap between 0 and 100000),
  cooldown_seconds integer not null default 60 check (cooldown_seconds between 0 and 86400),
  updated_at timestamptz not null default now()
);
insert into public.nxq_background_settings (id) values (true) on conflict (id) do nothing;
alter table public.nxq_background_settings enable row level security;
revoke all on table public.nxq_background_settings from public, anon, authenticated;
grant select, insert, update on table public.nxq_background_settings to service_role;

create table if not exists public.store_background_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'generating' check (status in ('generating', 'pending_approval', 'approved', 'rejected', 'failed')),
  image_url text,
  overlay numeric(3,2) check (overlay is null or (overlay >= 0 and overlay <= 0.75)),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists store_background_requests_client_idx on public.store_background_requests (client_id, created_at desc);
create index if not exists store_background_requests_created_idx on public.store_background_requests (created_at);
alter table public.store_background_requests enable row level security;
revoke all on table public.store_background_requests from public, anon, authenticated;
grant select, insert, update on table public.store_background_requests to service_role;

-- The one place the rules live (internal; nobody calls it directly). Same rules as src/lib/backgroundLimits.ts.
create or replace function public.nxq_background_gate(client_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.nxq_background_settings%rowtype; used integer; all_month integer; last_at timestamptz; wait integer;
begin
  select * into s from public.nxq_background_settings where id;
  if not found or s.switched_on is not true then return jsonb_build_object('ok', false, 'reason', 'Automatic backgrounds are switched off right now.'); end if;
  select count(*) into all_month from public.store_background_requests where created_at >= date_trunc('month', now());
  if all_month >= s.monthly_cap then return jsonb_build_object('ok', false, 'reason', 'The monthly limit for all stores has been reached. It resets next month, or the owner can raise it.'); end if;
  select count(*), max(created_at) into used, last_at from public.store_background_requests where client_id = client_uuid and created_at >= now() - make_interval(days => s.period_days);
  if used >= s.per_store_allowance then return jsonb_build_object('ok', false, 'reason', 'This store has used its background pictures for this period.'); end if;
  select max(created_at) into last_at from public.store_background_requests where client_id = client_uuid;
  if last_at is not null then
    wait := ceil(extract(epoch from (last_at + make_interval(secs => s.cooldown_seconds) - now())))::integer;
    if wait > 0 then return jsonb_build_object('ok', false, 'reason', 'Please wait ' || wait || ' second' || case when wait = 1 then '' else 's' end || ' before trying again.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'reason', '');
end;
$$;
revoke all on function public.nxq_background_gate(uuid) from public, anon, authenticated;

-- The owner's limits.
create or replace function public.owner_get_background_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.nxq_background_settings%rowtype;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  select * into s from public.nxq_background_settings where id;
  return jsonb_build_object('switched_on', s.switched_on, 'per_store_allowance', s.per_store_allowance, 'period_days', s.period_days, 'monthly_cap', s.monthly_cap, 'cooldown_seconds', s.cooldown_seconds,
    'made_this_month', (select count(*) from public.store_background_requests where created_at >= date_trunc('month', now())));
end;
$$;

create or replace function public.owner_set_background_settings(switched_on_value boolean, per_store_allowance_value integer, period_days_value integer, monthly_cap_value integer, cooldown_seconds_value integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  if switched_on_value is null then raise exception 'Choose on or off.'; end if;
  if per_store_allowance_value is null or per_store_allowance_value < 0 or per_store_allowance_value > 50 then raise exception 'Pictures per store must be a number from 0 to 50.'; end if;
  if period_days_value is null or period_days_value < 1 or period_days_value > 3650 then raise exception 'The period must be from 1 to 3650 days.'; end if;
  if monthly_cap_value is null or monthly_cap_value < 0 or monthly_cap_value > 100000 then raise exception 'The monthly limit must be a number from 0 to 100000.'; end if;
  if cooldown_seconds_value is null or cooldown_seconds_value < 0 or cooldown_seconds_value > 86400 then raise exception 'The wait between tries must be from 0 to 86400 seconds.'; end if;
  update public.nxq_background_settings set switched_on = switched_on_value, per_store_allowance = per_store_allowance_value, period_days = period_days_value,
    monthly_cap = monthly_cap_value, cooldown_seconds = cooldown_seconds_value, updated_at = now() where id;
  insert into public.automation_audit_log(event_type, actor_type, details)
  values ('background_settings_set', 'owner', jsonb_build_object('owner_auth_user_id', auth.uid(), 'switched_on', switched_on_value, 'per_store_allowance', per_store_allowance_value, 'monthly_cap', monthly_cap_value));
  return public.owner_get_background_settings();
end;
$$;

-- What the signed-in client may see about their own allowance (never anyone else's, never the global numbers).
create or replace function public.get_my_background_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare client_uuid uuid; s public.nxq_background_settings%rowtype; used integer; gate jsonb; latest record;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select * into s from public.nxq_background_settings where id;
  select count(*) into used from public.store_background_requests where client_id = client_uuid and created_at >= now() - make_interval(days => s.period_days);
  gate := public.nxq_background_gate(client_uuid);
  select status, image_url, created_at into latest from public.store_background_requests where client_id = client_uuid order by created_at desc limit 1;
  return jsonb_build_object('enabled', s.switched_on, 'allowance', s.per_store_allowance, 'used', used, 'remaining', greatest(s.per_store_allowance - used, 0),
    'can_request', (gate ->> 'ok')::boolean, 'reason', gate ->> 'reason',
    'latest_status', latest.status, 'latest_created_at', latest.created_at);
end;
$$;

-- For the picture maker (service role only): check every rule and, if allowed, reserve one slot. The slot counts even if the maker then fails.
create or replace function public.nxq_background_claim_slot(client_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare gate jsonb; request_uuid uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  if client_uuid is null or not exists (select 1 from public.commerce_storefronts where client_id = client_uuid) then return jsonb_build_object('ok', false, 'reason', 'Create your store first.'); end if;
  perform 1 from public.nxq_background_settings where id for update; -- one request at a time across all stores, so the monthly ceiling cannot be overshot
  gate := public.nxq_background_gate(client_uuid);
  if (gate ->> 'ok')::boolean is not true then return jsonb_build_object('ok', false, 'reason', gate ->> 'reason'); end if;
  insert into public.store_background_requests (client_id) values (client_uuid) returning id into request_uuid;
  return jsonb_build_object('ok', true, 'request_id', request_uuid, 'reason', '');
end;
$$;

-- The maker reports back (service role only). A good result waits for the owner; it is never live.
create or replace function public.nxq_background_finish(request_uuid uuid, success boolean, image_url_value text default null, overlay_value numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.store_background_requests%rowtype; problem text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  select * into r from public.store_background_requests where id = request_uuid for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'generating' then raise exception 'That request is already finished.'; end if;
  if success is not true then
    update public.store_background_requests set status = 'failed', decided_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;
  if image_url_value is null or position('/storage/v1/object/public/commerce-website-content/' || r.client_id::text || '/branding/' in image_url_value) = 0 then raise exception 'The picture must be in this store''s own branding folder.'; end if;
  problem := public.nxq_store_look_problem(jsonb_build_object('background', image_url_value, 'background_overlay', coalesce(overlay_value, 0)));
  if problem is not null then raise exception '%', problem; end if;
  update public.store_background_requests set status = 'pending_approval', image_url = image_url_value, overlay = coalesce(overlay_value, 0) where id = r.id;
  return jsonb_build_object('ok', true, 'status', 'pending_approval');
end;
$$;

-- The owner's queue and decision.
create or replace function public.owner_list_background_requests(status_filter text default 'pending_approval')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'store_name', q.store_name, 'store_slug', q.store_slug, 'status', q.status, 'image_url', q.image_url, 'overlay', q.overlay, 'created_at', q.created_at) order by q.created_at desc)
    from (select r.id, s.store_name, s.store_slug, r.status, r.image_url, r.overlay, r.created_at
          from public.store_background_requests r join public.commerce_storefronts s on s.client_id = r.client_id
          where status_filter is null or r.status = status_filter order by r.created_at desc limit 100) q), '[]'::jsonb);
end;
$$;

create or replace function public.owner_decide_background_request(request_uuid uuid, approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.store_background_requests%rowtype; sf public.commerce_storefronts%rowtype; merged jsonb; problem text;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  if approve is null then raise exception 'Choose approve or reject.'; end if;
  select * into r from public.store_background_requests where id = request_uuid for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_approval' then raise exception 'That request is not waiting for a decision.'; end if;
  if approve then
    select * into sf from public.commerce_storefronts where client_id = r.client_id for update;
    if not found then raise exception 'Store not found.'; end if;
    merged := coalesce(sf.settings -> 'look', '{}'::jsonb) || jsonb_build_object('background', r.image_url, 'background_overlay', coalesce(r.overlay, 0));
    problem := public.nxq_store_look_problem(merged);
    if problem is not null then raise exception '%', problem; end if;
    update public.commerce_storefronts set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{look}', merged, true), updated_at = now() where id = sf.id;
    update public.store_background_requests set status = 'approved', decided_at = now() where id = r.id;
    insert into public.activity_logs(client_id, actor_type, action, details) values (r.client_id, 'owner', 'store_background_approved', jsonb_build_object('request_id', r.id, 'owner_auth_user_id', auth.uid()));
    return jsonb_build_object('success', true, 'status', 'approved', 'message', 'The background is live on the store now.');
  end if;
  update public.store_background_requests set status = 'rejected', decided_at = now() where id = r.id;
  insert into public.activity_logs(client_id, actor_type, action, details) values (r.client_id, 'owner', 'store_background_rejected', jsonb_build_object('request_id', r.id, 'owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'status', 'rejected', 'message', 'Rejected. The store is unchanged. It still counted toward the store''s allowance.');
end;
$$;

revoke all on function public.owner_get_background_settings() from public, anon;
revoke all on function public.owner_set_background_settings(boolean, integer, integer, integer, integer) from public, anon;
revoke all on function public.get_my_background_status() from public, anon;
revoke all on function public.nxq_background_claim_slot(uuid) from public, anon, authenticated;
revoke all on function public.nxq_background_finish(uuid, boolean, text, numeric) from public, anon, authenticated;
revoke all on function public.owner_list_background_requests(text) from public, anon;
revoke all on function public.owner_decide_background_request(uuid, boolean) from public, anon;
grant execute on function public.owner_get_background_settings() to authenticated;
grant execute on function public.owner_set_background_settings(boolean, integer, integer, integer, integer) to authenticated;
grant execute on function public.get_my_background_status() to authenticated;
grant execute on function public.nxq_background_claim_slot(uuid) to service_role;
grant execute on function public.nxq_background_finish(uuid, boolean, text, numeric) to service_role;
grant execute on function public.owner_list_background_requests(text) to authenticated;
grant execute on function public.owner_decide_background_request(uuid, boolean) to authenticated;
