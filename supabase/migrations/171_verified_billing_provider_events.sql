-- Provider-neutral billing event ledger. External provider adapters normalize/sign events before this layer.
create table if not exists public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  provider_event_id text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null check(event_type in ('payment_succeeded','payment_failed','subscription_cancelled','subscription_active')),
  amount numeric(12,2),
  currency text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  normalized_payload jsonb not null default '{}'::jsonb,
  applied boolean not null default false,
  applied_at timestamptz,
  apply_error text,
  unique(provider_key,provider_event_id)
);
create index if not exists billing_provider_events_client_idx on public.billing_provider_events(client_id,occurred_at desc);
alter table public.billing_provider_events enable row level security;
revoke all on table public.billing_provider_events from public,anon,authenticated;
grant select,insert,update,delete on public.billing_provider_events to service_role;
create policy owner_read_billing_provider_events on public.billing_provider_events for select to authenticated using(exists(select 1 from public.owner_users where auth_user_id=auth.uid()));

create or replace function public.apply_verified_billing_provider_event(target_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  e public.billing_provider_events%rowtype;
  previous_status text;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  select * into e from public.billing_provider_events where id=target_event_id for update;
  if not found then raise exception 'Billing event not found.'; end if;
  if e.applied then return jsonb_build_object('ok',true,'already_applied',true,'event_id',e.id); end if;
  select billing_status::text into previous_status from public.clients where id=e.client_id;
  if previous_status is null then raise exception 'Billing client not found.'; end if;

  if e.event_type in ('payment_succeeded','subscription_active') then
    update public.clients set billing_status='active',billing_overdue_since=null,billing_frozen_at=null,billing_provider=e.provider_key where id=e.client_id;
  elsif e.event_type='payment_failed' then
    update public.clients set billing_status=case when billing_status::text in ('cancelled','frozen') then billing_status else 'past_due' end,billing_overdue_since=coalesce(billing_overdue_since,e.occurred_at),billing_provider=e.provider_key where id=e.client_id;
  elsif e.event_type='subscription_cancelled' then
    update public.clients set billing_status='cancelled',billing_provider=e.provider_key where id=e.client_id;
  end if;

  update public.billing_provider_events set applied=true,applied_at=now(),apply_error=null where id=e.id;
  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(e.client_id,'verified_billing_provider_event_applied','backend',jsonb_build_object('provider',e.provider_key,'provider_event_id',e.provider_event_id,'billing_event_type',e.event_type,'previous_status',previous_status,'auto_freeze',false));
  return jsonb_build_object('ok',true,'event_id',e.id,'event_type',e.event_type,'previous_status',previous_status,'auto_freeze',false);
exception when others then
  update public.billing_provider_events set apply_error=left(sqlerrm,2000) where id=target_event_id;
  raise;
end;$$;
revoke all on function public.apply_verified_billing_provider_event(uuid) from public,anon,authenticated;
grant execute on function public.apply_verified_billing_provider_event(uuid) to service_role;
comment on table public.billing_provider_events is 'Idempotent normalized billing provider events. Provider adapters authenticate/normalize before insertion; no event can directly force a billing freeze.';