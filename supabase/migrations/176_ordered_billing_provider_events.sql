-- Wave 17: ordered, server-mapped billing provider events.
-- Provider webhooks identify their own customer reference; NXQ resolves the client server-side.

create table if not exists public.billing_provider_customer_links (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  provider_customer_id text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'active' check(status in ('active','disabled','replaced')),
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key,provider_customer_id),
  unique(provider_key,client_id)
);

alter table public.billing_provider_customer_links enable row level security;
revoke all on table public.billing_provider_customer_links from public,anon,authenticated;
grant select,insert,update,delete on public.billing_provider_customer_links to service_role;
create policy owner_read_billing_provider_customer_links on public.billing_provider_customer_links
for select to authenticated
using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));

alter table public.billing_provider_events
  add column if not exists provider_customer_id text,
  add column if not exists ignored boolean not null default false,
  add column if not exists ignore_reason text;

create index if not exists billing_provider_events_order_idx
on public.billing_provider_events(client_id,provider_key,occurred_at desc,received_at desc);

create or replace function public.apply_verified_billing_provider_event(target_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  e public.billing_provider_events%rowtype;
  previous_status text;
  latest_applied_at timestamptz;
  resulting_status text;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into e from public.billing_provider_events where id=target_event_id for update;
  if not found then raise exception 'Billing event not found.'; end if;
  if e.applied then
    return jsonb_build_object('ok',true,'already_applied',true,'ignored',e.ignored,'ignore_reason',e.ignore_reason,'event_id',e.id);
  end if;

  if e.occurred_at>now()+interval '5 minutes' then raise exception 'Billing event timestamp is too far in the future.'; end if;
  if e.occurred_at<now()-interval '365 days' then raise exception 'Billing event timestamp is outside the accepted history window.'; end if;

  perform 1 from public.clients where id=e.client_id for update;
  if not found then raise exception 'Billing client not found.'; end if;
  select billing_status::text into previous_status from public.clients where id=e.client_id;

  select max(occurred_at) into latest_applied_at
  from public.billing_provider_events
  where client_id=e.client_id
    and provider_key=e.provider_key
    and applied=true
    and ignored=false
    and id<>e.id;

  if latest_applied_at is not null and e.occurred_at<=latest_applied_at then
    update public.billing_provider_events
    set applied=true,applied_at=now(),ignored=true,ignore_reason='stale_or_out_of_order_event',apply_error=null
    where id=e.id;
    insert into public.automation_audit_log(client_id,event_type,actor_type,details)
    values(e.client_id,'stale_billing_provider_event_ignored','backend',jsonb_build_object(
      'provider',e.provider_key,
      'provider_event_id',e.provider_event_id,
      'billing_event_type',e.event_type,
      'occurred_at',e.occurred_at,
      'latest_applied_at',latest_applied_at,
      'auto_freeze',false
    ));
    return jsonb_build_object('ok',true,'event_id',e.id,'ignored',true,'reason','stale_or_out_of_order_event','latest_applied_at',latest_applied_at);
  end if;

  if e.event_type in ('payment_succeeded','subscription_active') then
    update public.clients
    set billing_status='active',billing_overdue_since=null,billing_frozen_at=null,billing_provider=e.provider_key
    where id=e.client_id;
  elsif e.event_type='payment_failed' then
    update public.clients
    set billing_status=case when billing_status::text in ('cancelled','frozen') then billing_status else 'past_due' end,
        billing_overdue_since=coalesce(billing_overdue_since,e.occurred_at),
        billing_provider=e.provider_key
    where id=e.client_id;
  elsif e.event_type='subscription_cancelled' then
    update public.clients set billing_status='cancelled',billing_provider=e.provider_key where id=e.client_id;
  end if;

  select billing_status::text into resulting_status from public.clients where id=e.client_id;
  update public.billing_provider_events
  set applied=true,applied_at=now(),ignored=false,ignore_reason=null,apply_error=null
  where id=e.id;

  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(e.client_id,'verified_billing_provider_event_applied','backend',jsonb_build_object(
    'provider',e.provider_key,
    'provider_event_id',e.provider_event_id,
    'provider_customer_id',e.provider_customer_id,
    'billing_event_type',e.event_type,
    'previous_status',previous_status,
    'resulting_status',resulting_status,
    'occurred_at',e.occurred_at,
    'auto_freeze',false,
    'auto_unfreeze_on_verified_payment',e.event_type in ('payment_succeeded','subscription_active')
  ));

  return jsonb_build_object(
    'ok',true,
    'event_id',e.id,
    'event_type',e.event_type,
    'previous_status',previous_status,
    'resulting_status',resulting_status,
    'ignored',false,
    'auto_freeze',false
  );
exception when others then
  update public.billing_provider_events set apply_error=left(sqlerrm,2000) where id=target_event_id;
  raise;
end;
$$;

revoke all on function public.apply_verified_billing_provider_event(uuid) from public,anon,authenticated;
grant execute on function public.apply_verified_billing_provider_event(uuid) to service_role;

comment on table public.billing_provider_customer_links is 'Server-controlled mapping from provider customer references to NXQ clients. Webhook payloads never choose an NXQ client UUID directly.';
comment on function public.apply_verified_billing_provider_event(uuid) is 'Applies verified billing events in provider occurrence order. Stale events are audited and ignored; one webhook never directly freezes service.';
