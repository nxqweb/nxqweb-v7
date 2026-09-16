-- NXQ Web automatic billing orchestration foundation
-- Builds deterministic subscription, retry, grace, freeze, and restore behavior.
-- No real payment is attempted until processor_connected is explicitly true and an external processor worker is connected.

create extension if not exists pg_cron;

create table if not exists public.billing_subscriptions (
  client_id uuid primary key references public.clients(id) on delete cascade,
  provider text not null default 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  processor_connected boolean not null default false,
  automation_enabled boolean not null default true,
  amount numeric(10,2) not null default 0,
  currency text not null default 'USD',
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly')),
  next_charge_at timestamptz,
  grace_days integer not null default 14 check (grace_days between 1 and 60),
  max_retry_attempts integer not null default 4 check (max_retry_attempts between 1 and 12),
  retry_interval_hours integer not null default 24 check (retry_interval_hours between 1 and 168),
  consecutive_failures integer not null default 0,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  subscription_client_id uuid not null references public.billing_subscriptions(client_id) on delete cascade,
  idempotency_key text not null unique,
  provider text not null,
  provider_attempt_id text,
  amount numeric(10,2) not null,
  currency text not null default 'USD',
  attempt_number integer not null default 1,
  status text not null default 'queued' check (status in (
    'queued','processing','succeeded','failed','blocked_processor_not_connected','cancelled'
  )),
  failure_code text,
  failure_message text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_payment_attempts_client_idx
  on public.billing_payment_attempts (client_id, created_at desc);
create index if not exists billing_payment_attempts_status_idx
  on public.billing_payment_attempts (status, requested_at);

create table if not exists public.billing_notification_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null,
  idempotency_key text not null unique,
  delivery_status text not null default 'recorded_not_connected' check (delivery_status in (
    'recorded_not_connected','queued','sent','failed','cancelled'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.billing_subscriptions enable row level security;
alter table public.billing_payment_attempts enable row level security;
alter table public.billing_notification_events enable row level security;

drop policy if exists "Owner can manage billing subscriptions" on public.billing_subscriptions;
create policy "Owner can manage billing subscriptions"
on public.billing_subscriptions for all to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()))
with check (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists "Owner can read billing attempts" on public.billing_payment_attempts;
create policy "Owner can read billing attempts"
on public.billing_payment_attempts for select to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

drop policy if exists "Owner can read billing notifications" on public.billing_notification_events;
create policy "Owner can read billing notifications"
on public.billing_notification_events for select to authenticated
using (exists (select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()));

create or replace function public.touch_billing_automation_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_billing_subscriptions on public.billing_subscriptions;
create trigger touch_billing_subscriptions
before update on public.billing_subscriptions
for each row execute function public.touch_billing_automation_updated_at();

drop trigger if exists touch_billing_payment_attempts on public.billing_payment_attempts;
create trigger touch_billing_payment_attempts
before update on public.billing_payment_attempts
for each row execute function public.touch_billing_automation_updated_at();

-- Keep subscription settings aligned with active clients without enabling a processor automatically.
insert into public.billing_subscriptions (
  client_id, provider, amount, currency, next_charge_at, processor_connected, automation_enabled
)
select
  c.id,
  coalesce(nullif(c.billing_provider, ''), 'manual'),
  greatest(coalesce(c.monthly_price, 0), 0),
  'USD',
  c.billing_due_at,
  false,
  true
from public.clients c
on conflict (client_id) do update
set amount = excluded.amount,
    provider = coalesce(nullif(public.billing_subscriptions.provider, ''), excluded.provider),
    next_charge_at = coalesce(public.billing_subscriptions.next_charge_at, excluded.next_charge_at),
    updated_at = now();

create or replace function public.sync_client_billing_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.billing_subscriptions (
    client_id, provider, amount, currency, next_charge_at, processor_connected, automation_enabled
  ) values (
    new.id,
    coalesce(nullif(new.billing_provider, ''), 'manual'),
    greatest(coalesce(new.monthly_price, 0), 0),
    'USD',
    new.billing_due_at,
    false,
    true
  )
  on conflict (client_id) do update
  set amount = greatest(coalesce(excluded.amount, 0), 0),
      provider = case
        when public.billing_subscriptions.processor_connected then public.billing_subscriptions.provider
        else excluded.provider
      end,
      next_charge_at = coalesce(excluded.next_charge_at, public.billing_subscriptions.next_charge_at),
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_client_billing_subscription_trigger on public.clients;
create trigger sync_client_billing_subscription_trigger
after insert or update of monthly_price, billing_provider, billing_due_at on public.clients
for each row execute function public.sync_client_billing_subscription();

create or replace function public.record_billing_notification(
  target_client_id uuid,
  target_event_type text,
  target_idempotency_key text,
  target_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
begin
  insert into public.billing_notification_events (
    client_id, event_type, idempotency_key, payload
  ) values (
    target_client_id,
    target_event_type,
    target_idempotency_key,
    coalesce(target_payload, '{}'::jsonb)
  )
  on conflict (idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into saved_id;

  return saved_id;
end;
$$;

create or replace function public.queue_due_billing_attempts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sub_row public.billing_subscriptions%rowtype;
  client_row public.clients%rowtype;
  attempt_key text;
  attempt_number_value integer;
  queued_count integer := 0;
  blocked_count integer := 0;
begin
  for sub_row in
    select *
    from public.billing_subscriptions
    where automation_enabled = true
      and amount > 0
      and next_charge_at is not null
      and next_charge_at <= now()
      and (next_retry_at is null or next_retry_at <= now())
    order by next_charge_at asc
    for update skip locked
  loop
    select * into client_row from public.clients where id = sub_row.client_id;

    if client_row.status::text in ('denied','archived','dormant')
       or client_row.billing_status::text = 'cancelled' then
      continue;
    end if;

    attempt_number_value := sub_row.consecutive_failures + 1;
    attempt_key := 'billing:' || sub_row.client_id::text || ':' ||
      to_char(sub_row.next_charge_at at time zone 'UTC', 'YYYYMMDDHH24MISS') ||
      ':attempt:' || attempt_number_value::text;

    if not sub_row.processor_connected then
      insert into public.billing_payment_attempts (
        client_id, subscription_client_id, idempotency_key, provider,
        amount, currency, attempt_number, status, failure_code, failure_message, processed_at
      ) values (
        sub_row.client_id, sub_row.client_id, attempt_key, sub_row.provider,
        sub_row.amount, sub_row.currency, attempt_number_value,
        'blocked_processor_not_connected', 'processor_not_connected',
        'No real payment processor is connected. No charge was attempted.', now()
      )
      on conflict (idempotency_key) do nothing;

      perform public.record_billing_notification(
        sub_row.client_id,
        'billing_processor_connection_required',
        attempt_key || ':processor-required',
        jsonb_build_object('amount', sub_row.amount, 'currency', sub_row.currency, 'real_charge_attempted', false)
      );

      insert into public.automation_escalations (
        client_id, escalation_type, severity, title, summary, details
      )
      select
        sub_row.client_id,
        'billing_processor_not_connected',
        'low',
        'Billing processor connection required',
        'Automatic billing is configured, but no processor is connected. No charge was attempted.',
        jsonb_build_object('provider', sub_row.provider, 'amount', sub_row.amount)
      where not exists (
        select 1 from public.automation_escalations e
        where e.client_id = sub_row.client_id
          and e.escalation_type = 'billing_processor_not_connected'
          and e.status in ('open','acknowledged')
      );

      update public.billing_subscriptions
      set last_attempt_at = now(),
          next_retry_at = now() + interval '24 hours'
      where client_id = sub_row.client_id;

      blocked_count := blocked_count + 1;
      continue;
    end if;

    insert into public.billing_payment_attempts (
      client_id, subscription_client_id, idempotency_key, provider,
      amount, currency, attempt_number, status
    ) values (
      sub_row.client_id, sub_row.client_id, attempt_key, sub_row.provider,
      sub_row.amount, sub_row.currency, attempt_number_value, 'queued'
    )
    on conflict (idempotency_key) do nothing;

    update public.billing_subscriptions
    set last_attempt_at = now()
    where client_id = sub_row.client_id;

    queued_count := queued_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'queued', queued_count, 'blocked', blocked_count, 'ran_at', now());
end;
$$;

create or replace function public.apply_billing_processor_result(
  target_attempt_id uuid,
  target_status text,
  target_provider_attempt_id text default null,
  target_failure_code text default null,
  target_failure_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.billing_payment_attempts%rowtype;
  sub_row public.billing_subscriptions%rowtype;
  next_due timestamptz;
  overdue_at timestamptz;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Backend service role required.';
  end if;

  if target_status not in ('succeeded','failed') then
    raise exception 'Processor result must be succeeded or failed.';
  end if;

  select * into attempt_row
  from public.billing_payment_attempts
  where id = target_attempt_id
  for update;

  if not found then
    raise exception 'Billing attempt not found.';
  end if;

  if attempt_row.status in ('succeeded','failed','cancelled') then
    return jsonb_build_object('ok', true, 'duplicate_result_ignored', true, 'attempt_id', attempt_row.id, 'status', attempt_row.status);
  end if;

  select * into sub_row
  from public.billing_subscriptions
  where client_id = attempt_row.client_id
  for update;

  update public.billing_payment_attempts
  set status = target_status,
      provider_attempt_id = coalesce(target_provider_attempt_id, provider_attempt_id),
      failure_code = case when target_status = 'failed' then target_failure_code else null end,
      failure_message = case when target_status = 'failed' then target_failure_message else null end,
      processed_at = now()
  where id = attempt_row.id;

  if target_status = 'succeeded' then
    next_due := greatest(coalesce(sub_row.next_charge_at, now()), now()) + interval '1 month';

    insert into public.payment_records (
      client_id, provider, status, amount, currency, note, created_at
    ) values (
      attempt_row.client_id,
      sub_row.provider,
      'active',
      attempt_row.amount,
      attempt_row.currency,
      'Automatic subscription payment confirmed by the connected processor.',
      now()
    );

    update public.billing_subscriptions
    set consecutive_failures = 0,
        last_success_at = now(),
        next_retry_at = null,
        next_charge_at = next_due
    where client_id = attempt_row.client_id;

    update public.clients
    set billing_status = 'active',
        billing_due_at = next_due,
        billing_overdue_since = null,
        billing_frozen_at = null,
        billing_updated_at = now(),
        updated_at = now()
    where id = attempt_row.client_id;

    perform public.record_billing_notification(
      attempt_row.client_id,
      'payment_succeeded',
      'billing-attempt:' || attempt_row.id::text || ':succeeded',
      jsonb_build_object('amount', attempt_row.amount, 'currency', attempt_row.currency, 'next_due_at', next_due)
    );

    update public.automation_escalations
    set status = 'resolved', resolved_at = now()
    where client_id = attempt_row.client_id
      and escalation_type in ('billing_processor_not_connected','billing_payment_failed','billing_retry_exhausted')
      and status in ('open','acknowledged');

  else
    overdue_at := coalesce((select billing_overdue_since from public.clients where id = attempt_row.client_id), now());

    update public.billing_subscriptions
    set consecutive_failures = consecutive_failures + 1,
        next_retry_at = case
          when consecutive_failures + 1 < max_retry_attempts
            then now() + make_interval(hours => retry_interval_hours)
          else null
        end
    where client_id = attempt_row.client_id;

    update public.clients
    set billing_status = case
          when billing_status::text = 'active' then 'past_due'::public.billing_status
          else billing_status
        end,
        billing_overdue_since = coalesce(billing_overdue_since, now()),
        billing_updated_at = now(),
        updated_at = now()
    where id = attempt_row.client_id;

    perform public.record_billing_notification(
      attempt_row.client_id,
      'payment_failed',
      'billing-attempt:' || attempt_row.id::text || ':failed',
      jsonb_build_object(
        'amount', attempt_row.amount,
        'currency', attempt_row.currency,
        'attempt_number', attempt_row.attempt_number,
        'failure_code', target_failure_code
      )
    );

    insert into public.automation_escalations (
      client_id, escalation_type, severity, title, summary, details
    )
    select
      attempt_row.client_id,
      case when sub_row.consecutive_failures + 1 >= sub_row.max_retry_attempts then 'billing_retry_exhausted' else 'billing_payment_failed' end,
      case when sub_row.consecutive_failures + 1 >= sub_row.max_retry_attempts then 'high' else 'medium' end,
      case when sub_row.consecutive_failures + 1 >= sub_row.max_retry_attempts then 'Automatic billing retries exhausted' else 'Automatic payment failed' end,
      case when sub_row.consecutive_failures + 1 >= sub_row.max_retry_attempts
        then 'The connected processor reported repeated payment failures. The grace-period policy will continue automatically.'
        else 'The connected processor reported a failed payment. A backend retry is scheduled.'
      end,
      jsonb_build_object('attempt_id', attempt_row.id, 'failure_code', target_failure_code, 'failure_message', target_failure_message)
    where not exists (
      select 1 from public.automation_escalations e
      where e.client_id = attempt_row.client_id
        and e.escalation_type = case when sub_row.consecutive_failures + 1 >= sub_row.max_retry_attempts then 'billing_retry_exhausted' else 'billing_payment_failed' end
        and e.status in ('open','acknowledged')
    );
  end if;

  insert into public.automation_audit_log (client_id, event_type, actor_type, details)
  values (
    attempt_row.client_id,
    'billing_processor_result_applied',
    'backend',
    jsonb_build_object('attempt_id', attempt_row.id, 'status', target_status, 'provider_attempt_id', target_provider_attempt_id)
  );

  return jsonb_build_object('ok', true, 'attempt_id', attempt_row.id, 'status', target_status);
end;
$$;

create or replace function public.advance_automatic_billing_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_row public.clients%rowtype;
  sub_row public.billing_subscriptions%rowtype;
  past_due_count integer := 0;
  review_count integer := 0;
  awaiting_owner_review_count integer := 0;
  reminder_key text;
begin
  -- Existing active clients become past due only when a connected processor has actually failed.
  for client_row in
    select c.*
    from public.clients c
    join public.billing_subscriptions s on s.client_id = c.id
    where c.billing_status::text in ('past_due','freeze_review')
      and s.automation_enabled = true
      and s.processor_connected = true
      and c.billing_overdue_since is not null
    for update of c skip locked
  loop
    select * into sub_row from public.billing_subscriptions where client_id = client_row.id;

    if client_row.billing_status::text = 'past_due' then
      reminder_key := 'billing:' || client_row.id::text || ':past-due-reminder:' ||
        floor(extract(epoch from (now() - client_row.billing_overdue_since)) / 86400 / 3)::text;

      perform public.record_billing_notification(
        client_row.id,
        'past_due_reminder',
        reminder_key,
        jsonb_build_object('overdue_since', client_row.billing_overdue_since, 'grace_days', sub_row.grace_days)
      );

      if client_row.billing_overdue_since + make_interval(days => sub_row.grace_days) <= now() then
        update public.clients
        set billing_status = 'freeze_review', billing_updated_at = now(), updated_at = now()
        where id = client_row.id;
        review_count := review_count + 1;
      else
        past_due_count := past_due_count + 1;
      end if;

    elsif client_row.billing_status::text = 'freeze_review' then
      -- The backend may escalate and remind, but only a human owner can freeze service.
      perform public.record_billing_notification(
        client_row.id,
        'freeze_review_owner_attention',
        'billing:' || client_row.id::text || ':freeze-review:' || to_char(now() at time zone 'UTC', 'YYYYMMDD'),
        jsonb_build_object(
          'overdue_since', client_row.billing_overdue_since,
          'retry_attempts', sub_row.consecutive_failures,
          'requires_owner_decision', true,
          'auto_freeze', false
        )
      );
      awaiting_owner_review_count := awaiting_owner_review_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'past_due_reviewed', past_due_count,
    'moved_to_freeze_review', review_count,
    'awaiting_owner_freeze_review', awaiting_owner_review_count,
    'automatically_frozen', 0,
    'ran_at', now()
  );
end;
$$;

create or replace function public.run_automatic_billing_orchestration()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  queue_result jsonb;
  lifecycle_result jsonb;
begin
  queue_result := public.queue_due_billing_attempts();
  lifecycle_result := public.advance_automatic_billing_lifecycle();

  insert into public.automation_audit_log (event_type, actor_type, details)
  values ('automatic_billing_orchestration_completed', 'backend', jsonb_build_object(
    'queue', queue_result,
    'lifecycle', lifecycle_result
  ));

  return jsonb_build_object('ok', true, 'queue', queue_result, 'lifecycle', lifecycle_result);
end;
$$;

revoke all on function public.record_billing_notification(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.queue_due_billing_attempts() from public, anon, authenticated;
revoke all on function public.apply_billing_processor_result(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.advance_automatic_billing_lifecycle() from public, anon, authenticated;
revoke all on function public.run_automatic_billing_orchestration() from public, anon, authenticated;

grant execute on function public.record_billing_notification(uuid, text, text, jsonb) to service_role;
grant execute on function public.queue_due_billing_attempts() to service_role;
grant execute on function public.apply_billing_processor_result(uuid, text, text, text, text) to service_role;
grant execute on function public.advance_automatic_billing_lifecycle() to service_role;
grant execute on function public.run_automatic_billing_orchestration() to service_role;

-- Replace only this named automation job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nxq-automatic-billing-hourly') then
    perform cron.unschedule('nxq-automatic-billing-hourly');
  end if;
end;
$$;

select cron.schedule(
  'nxq-automatic-billing-hourly',
  '15 * * * *',
  $$select public.run_automatic_billing_orchestration();$$
);
