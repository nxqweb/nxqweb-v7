-- DRAFT (not applied). Database side of "NXQX creates a hosted Stripe checkout link for a client" (billing model A1, owner chose it 2026-11-26).
-- Pairs with the draft Edge function docs/drafts/functions/create-client-checkout-link. Nothing here talks to Stripe or charges anyone: it only RECORDS
-- attempts, decides the amount and who may be billed, and links the Stripe customer to the client so the existing webhook accepts that customer's events.
--
-- Rules the database enforces (so a bug or a stolen function call cannot get around them):
--  * Only the service role can call these functions (the Edge function checks the signed-in owner first and passes the owner's id; it is verified again here).
--  * The amount comes from clients.monthly_price, never from the caller, and must be at least $10 (the protected minimum).
--  * QA-only clients and denied, archived or dormant clients can never be billed. A client that already finished a checkout cannot get a second one.
--  * One OPEN attempt per client. Asking again reuses it (so Stripe's idempotency keys repeat and no duplicate customer or session is created).
--  * A Stripe customer can be linked to only one client, and a client to only one active customer.
-- Would become the next real migration number on approval (301 or later; 05_ten_run_check is waiting for 301 too, so number on approval).

create table if not exists public.billing_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null,
  plan_name text not null,
  amount_cents integer not null check (amount_cents between 1000 and 1000000),
  status text not null default 'reserved' check (status in ('reserved', 'created', 'completed', 'failed', 'expired')),
  stripe_customer_id text,
  stripe_session_id text unique,
  stripe_subscription_id text,
  stripe_event_id text,
  failure_reason text check (failure_reason is null or length(failure_reason) <= 120),
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one open attempt per client.
create unique index if not exists billing_checkout_attempts_one_open_idx
  on public.billing_checkout_attempts(client_id) where status in ('reserved', 'created');
-- At most one completed checkout per client (a second subscription would be a double charge).
create unique index if not exists billing_checkout_attempts_one_completed_idx
  on public.billing_checkout_attempts(client_id) where status = 'completed';

alter table public.billing_checkout_attempts enable row level security;
revoke all on table public.billing_checkout_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.billing_checkout_attempts to service_role;
drop policy if exists owner_read_billing_checkout_attempts on public.billing_checkout_attempts;
create policy owner_read_billing_checkout_attempts on public.billing_checkout_attempts
  for select to authenticated using (exists (select 1 from public.owner_users where auth_user_id = auth.uid()));
grant select on public.billing_checkout_attempts to authenticated;

create or replace function public.nxq_checkout_reserve(target_client_id uuid, requested_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.clients%rowtype;
  cents integer;
  plan text;
  attempt public.billing_checkout_attempts%rowtype;
  customer text;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = requested_by) then
    return jsonb_build_object('ok', false, 'reason', 'owner_required');
  end if;
  select * into selected from public.clients where id = target_client_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'client_not_found'); end if;
  if selected.qa_only or selected.status::text in ('denied', 'archived', 'dormant') then
    return jsonb_build_object('ok', false, 'reason', 'client_not_billable');
  end if;
  if exists (select 1 from public.billing_checkout_attempts where client_id = selected.id and status = 'completed') then
    return jsonb_build_object('ok', false, 'reason', 'already_subscribed');
  end if;
  cents := round(coalesce(selected.monthly_price, 0) * 100)::integer;
  if cents < 1000 or cents > 1000000 then return jsonb_build_object('ok', false, 'reason', 'no_plan_price'); end if;

  select coalesce(
    (select t.name from public.product_family_tiers t where t.id = selected.product_tier_id),
    (select p.name from public.packages p where p.id = selected.package_id),
    'Website plan') into plan;

  -- An old open attempt (the link has expired) or one made for a different price is closed so a fresh one can start.
  update public.billing_checkout_attempts
     set status = 'expired', failure_reason = case when amount_cents <> cents then 'price_changed' else 'link_expired' end, updated_at = now()
   where client_id = selected.id and status in ('reserved', 'created') and (created_at <= now() - interval '20 hours' or amount_cents <> cents);

  select * into attempt from public.billing_checkout_attempts where client_id = selected.id and status in ('reserved', 'created');
  if not found then
    insert into public.billing_checkout_attempts(client_id, requested_by, plan_name, amount_cents)
    values (selected.id, requested_by, plan, cents) returning * into attempt;
    insert into public.automation_audit_log(client_id, event_type, actor_type, details)
    values (selected.id, 'checkout_attempt_reserved', 'owner', jsonb_build_object('attempt_id', attempt.id, 'amount_cents', cents));
  end if;

  select provider_customer_id into customer from public.billing_provider_customer_links
   where provider_key = 'stripe' and client_id = selected.id and status = 'active';

  return jsonb_build_object('ok', true, 'attempt_id', attempt.id, 'client_id', selected.id, 'business_name', selected.business_name,
    'contact_email', selected.contact_email, 'plan_name', attempt.plan_name, 'amount_cents', attempt.amount_cents, 'existing_customer_id', customer);
end;
$$;

create or replace function public.nxq_checkout_record_customer(target_attempt_id uuid, target_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt public.billing_checkout_attempts%rowtype;
  customer_value text := btrim(coalesce(target_customer_id, ''));
  customer_link public.billing_provider_customer_links%rowtype;
  client_link public.billing_provider_customer_links%rowtype;
begin
  if customer_value !~ '^cus_[A-Za-z0-9]{8,64}$' then return jsonb_build_object('ok', false, 'reason', 'customer_id_invalid'); end if;
  select * into attempt from public.billing_checkout_attempts where id = target_attempt_id for update;
  if not found or attempt.status not in ('reserved', 'created') then return jsonb_build_object('ok', false, 'reason', 'attempt_not_open'); end if;

  select * into customer_link from public.billing_provider_customer_links where provider_key = 'stripe' and provider_customer_id = customer_value;
  if found and customer_link.client_id <> attempt.client_id then return jsonb_build_object('ok', false, 'reason', 'customer_linked_elsewhere'); end if;
  select * into client_link from public.billing_provider_customer_links where provider_key = 'stripe' and client_id = attempt.client_id;
  if found and client_link.status = 'active' and client_link.provider_customer_id <> customer_value then
    return jsonb_build_object('ok', false, 'reason', 'client_has_other_customer');
  end if;

  if found and client_link.provider_customer_id = customer_value and client_link.status = 'active' then
    null; -- already linked, nothing to change
  elsif found then
    update public.billing_provider_customer_links
       set provider_customer_id = customer_value, status = 'active', verified_at = null, updated_at = now(),
           metadata = metadata || jsonb_build_object('relinked_by_checkout', true)
     where id = client_link.id;
  else
    insert into public.billing_provider_customer_links(provider_key, provider_customer_id, client_id, status, metadata)
    values ('stripe', customer_value, attempt.client_id, 'active', jsonb_build_object('created_by_checkout', true));
  end if;

  update public.billing_checkout_attempts set stripe_customer_id = customer_value, updated_at = now() where id = attempt.id;
  insert into public.automation_audit_log(client_id, event_type, actor_type, details)
  values (attempt.client_id, 'checkout_customer_linked', 'backend', jsonb_build_object('attempt_id', attempt.id, 'customer_hint', right(customer_value, 4)));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.nxq_checkout_mark_created(target_attempt_id uuid, target_session_id text, target_expires_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare attempt public.billing_checkout_attempts%rowtype;
begin
  if coalesce(target_session_id, '') !~ '^cs_(test|live)_[A-Za-z0-9_]{4,255}$' then return jsonb_build_object('ok', false, 'reason', 'session_id_invalid'); end if;
  select * into attempt from public.billing_checkout_attempts where id = target_attempt_id for update;
  if not found or attempt.status not in ('reserved', 'created') then return jsonb_build_object('ok', false, 'reason', 'attempt_not_open'); end if;
  if attempt.stripe_session_id is not null and attempt.stripe_session_id <> target_session_id then return jsonb_build_object('ok', false, 'reason', 'attempt_has_other_session'); end if;
  update public.billing_checkout_attempts
     set status = 'created', stripe_session_id = target_session_id, expires_at = target_expires_at, updated_at = now()
   where id = attempt.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.nxq_checkout_mark_failed(target_attempt_id uuid, target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing_checkout_attempts
     set status = 'failed', failure_reason = left(btrim(coalesce(target_reason, 'failed')), 120), updated_at = now()
   where id = target_attempt_id and status in ('reserved', 'created');
  return jsonb_build_object('ok', true);
end;
$$;

-- Called by the Stripe webhook when a checkout.session.completed event arrives. Money events still go through the existing webhook paths; this only records
-- that the client finished checkout. Safe to repeat (Stripe retries): the second call with the same session changes nothing.
create or replace function public.nxq_checkout_mark_completed(target_session_id text, target_customer_id text, target_subscription_id text, target_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt public.billing_checkout_attempts%rowtype;
begin
  select * into attempt from public.billing_checkout_attempts where stripe_session_id = target_session_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown_session'); end if;
  if attempt.status = 'completed' then return jsonb_build_object('ok', true, 'already_applied', true, 'client_id', attempt.client_id); end if;
  -- The paying customer must be the customer linked to this client; anything else is refused and left for the owner to look at.
  if not exists (select 1 from public.billing_provider_customer_links
                  where provider_key = 'stripe' and client_id = attempt.client_id and provider_customer_id = target_customer_id and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_linked_to_client');
  end if;
  update public.billing_checkout_attempts
     set status = 'completed', stripe_customer_id = target_customer_id, stripe_subscription_id = left(target_subscription_id, 120),
         stripe_event_id = left(target_event_id, 180), completed_at = now(), updated_at = now()
   where id = attempt.id;
  insert into public.automation_audit_log(client_id, event_type, actor_type, details)
  values (attempt.client_id, 'checkout_completed', 'backend', jsonb_build_object('attempt_id', attempt.id, 'amount_cents', attempt.amount_cents));
  return jsonb_build_object('ok', true, 'client_id', attempt.client_id);
end;
$$;

revoke all on function public.nxq_checkout_reserve(uuid, uuid) from public, anon, authenticated;
revoke all on function public.nxq_checkout_record_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.nxq_checkout_mark_created(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.nxq_checkout_mark_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.nxq_checkout_mark_completed(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nxq_checkout_reserve(uuid, uuid) to service_role;
grant execute on function public.nxq_checkout_record_customer(uuid, text) to service_role;
grant execute on function public.nxq_checkout_mark_created(uuid, text, timestamptz) to service_role;
grant execute on function public.nxq_checkout_mark_failed(uuid, text) to service_role;
grant execute on function public.nxq_checkout_mark_completed(text, text, text, text) to service_role;
