-- Dedicated billing state for NXQ Web.
-- This does not change project stages or launch status.

do $$ begin
  create type public.billing_status as enum (
    'not_configured',
    'activation_pending',
    'active',
    'past_due',
    'freeze_review',
    'frozen',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.clients
  add column if not exists billing_status public.billing_status
    not null default 'not_configured',
  add column if not exists billing_provider text,
  add column if not exists billing_due_at timestamptz,
  add column if not exists billing_overdue_since timestamptz,
  add column if not exists billing_frozen_at timestamptz,
  add column if not exists billing_updated_at timestamptz
    not null default now();

update public.clients
set
  billing_status = case
    when status = 'active' then 'active'::public.billing_status
    when status = 'overdue' then 'past_due'::public.billing_status
    when status = 'frozen' then 'frozen'::public.billing_status
    else billing_status
  end,
  billing_provider = case
    when status in ('active', 'overdue', 'frozen')
      and billing_provider is null
    then 'manual'
    else billing_provider
  end,
  billing_updated_at = now();

create or replace function public.set_client_billing_state(
  target_client_id uuid,
  next_billing_status public.billing_status,
  next_billing_provider text default null,
  billing_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_client public.clients%rowtype;
  event_action text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.owner_users
    where owner_users.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  select *
  into selected_client
  from public.clients
  where id = target_client_id
  for update;

  if not found then
    raise exception 'Client not found.';
  end if;

  update public.clients
  set
    billing_status = next_billing_status,
    billing_provider = coalesce(next_billing_provider, billing_provider),
    billing_overdue_since = case
      when next_billing_status = 'past_due'
        then coalesce(billing_overdue_since, now())
      when next_billing_status in ('active', 'cancelled')
        then null
      else billing_overdue_since
    end,
    billing_frozen_at = case
      when next_billing_status = 'frozen'
        then coalesce(billing_frozen_at, now())
      when next_billing_status = 'active'
        then null
      else billing_frozen_at
    end,
    billing_updated_at = now(),
    updated_at = now()
  where id = target_client_id;

  event_action := 'billing_' || next_billing_status::text;

  insert into public.activity_logs (
    client_id,
    actor_type,
    action,
    details
  )
  values (
    target_client_id,
    'owner',
    event_action,
    jsonb_build_object(
      'billing_status', next_billing_status,
      'billing_provider', coalesce(next_billing_provider, selected_client.billing_provider),
      'note', billing_note,
      'source', 'set_client_billing_state_rpc'
    )
  );

  return jsonb_build_object(
    'success', true,
    'client_id', target_client_id,
    'billing_status', next_billing_status,
    'message',
      selected_client.business_name ||
      ' billing status changed to ' ||
      replace(next_billing_status::text, '_', ' ') ||
      '. Project stage was not changed.'
  );
end;
$$;

revoke all
on function public.set_client_billing_state(
  uuid,
  public.billing_status,
  text,
  text
)
from public;

revoke all
on function public.set_client_billing_state(
  uuid,
  public.billing_status,
  text,
  text
)
from anon;

grant execute
on function public.set_client_billing_state(
  uuid,
  public.billing_status,
  text,
  text
)
to authenticated;
-- Sync active and overdue payment records into the dedicated billing state.
-- This keeps manual activation and future payment providers consistent.

create or replace function public.sync_client_billing_from_payment_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is null then
    return new;
  end if;

  if lower(new.status) = 'active' then
    update public.clients
    set
      billing_status = 'active',
      billing_provider = new.provider,
      billing_overdue_since = null,
      billing_frozen_at = null,
      billing_updated_at = now(),
      updated_at = now()
    where id = new.client_id;

  elsif lower(new.status) in ('overdue', 'past_due') then
    update public.clients
    set
      billing_status = 'past_due',
      billing_provider = new.provider,
      billing_overdue_since = coalesce(billing_overdue_since, now()),
      billing_updated_at = now(),
      updated_at = now()
    where id = new.client_id;

  elsif lower(new.status) = 'cancelled' then
    update public.clients
    set
      billing_status = 'cancelled',
      billing_provider = new.provider,
      billing_overdue_since = null,
      billing_updated_at = now(),
      updated_at = now()
    where id = new.client_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_client_billing_from_payment_record
on public.payment_records;

create trigger sync_client_billing_from_payment_record
after insert or update of status, provider
on public.payment_records
for each row
execute function public.sync_client_billing_from_payment_record();

revoke all
on function public.sync_client_billing_from_payment_record()
from public;

revoke all
on function public.sync_client_billing_from_payment_record()
from anon;