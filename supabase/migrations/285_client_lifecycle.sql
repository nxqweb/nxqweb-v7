-- 285: client lifecycle: Pause, Cancel and the free first month. Written 2026-10-28 on the owner's decisions (answers recorded in docs/NXQ_RUNTIME_HANDOFF.md):
--   * PAUSE: stops new submissions (store orders, custom-order requests, website inquiries, booking requests); the site stays visible; nothing is deleted; one button resumes.
--   * CANCEL: the owner approves a cancellation: the client is marked cancelled, new submissions stop (same gate), billing moves to 'cancelled' when the existing billing rules allow it,
--     and the owner gets a "take this site down" to-do. NO outside service is called: the owner unpublishes the site by hand and presses "I took it down".
--   * FREE FIRST MONTH: 30 days from the day the owner approves the client's website (automatic, once, never for QA-only clients). The owner gets a list of first months that are
--     running, ending soon or over, and presses "I started invoicing" when done. A date can also be set by hand per client. Existing clients are NOT given a first month (no backfill).
--
-- Why a database gate (found 2026-10-28): the Commerce store's public order and request functions never looked at the client's billing state, so a frozen or cancelled client's store
-- kept taking orders. Leads and Booking were already gated by billing. The gate below is a BEFORE INSERT trigger on the four tables public visitors write to, so it cannot be bypassed
-- by a function that forgets to check, and no existing function had to be rewritten. The Booking "page is open" check also learns about pause and cancel.
--
-- Adds (no new tables; additive columns on public.clients, which signed-in users cannot write since migration 183):
--  * columns: paused_at, paused_reason, cancelled_at, site_taken_down_at, first_month_started_at, first_month_ends_at, first_invoice_noted_at
--  * internal: nxq_client_taking_submissions(uuid), nxq_block_submissions_when_not_taking() trigger function, nxq_start_first_month() trigger function, nxq_lifecycle_row(clients)
--  * public (anon + signed in): get_public_store_status(store_slug) -> {"accepting": true|false}, nothing else
--  * owner only (checked inside): owner_pause_client, owner_resume_client, owner_cancel_client, owner_mark_site_taken_down, owner_set_first_month, owner_note_first_invoice,
--    owner_client_lifecycle_overview

alter table public.clients
  add column if not exists paused_at timestamptz,
  add column if not exists paused_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists site_taken_down_at timestamptz,
  add column if not exists first_month_started_at timestamptz,
  add column if not exists first_month_ends_at timestamptz,
  add column if not exists first_invoice_noted_at timestamptz;

comment on column public.clients.paused_at is 'Set by the owner (owner_pause_client / owner_cancel_client). While set, public visitors cannot send new orders, requests, inquiries or booking requests. The site stays visible.';
comment on column public.clients.cancelled_at is 'Set when the owner approves a cancellation (owner_cancel_client). The owner then takes the site down by hand and records it in site_taken_down_at.';
comment on column public.clients.first_month_started_at is 'Start of the free first month: set once when the website is approved, or by the owner. first_month_ends_at is 30 days later.';

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- The gate: may public visitors send this client new things? (Missing client = yes, so a stray row can never lock anything.)
create or replace function public.nxq_client_taking_submissions(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select c.paused_at is null
       and c.cancelled_at is null
       and coalesce(c.billing_status::text, '') not in ('frozen', 'cancelled')
       and c.status::text not in ('denied', 'archived')
    from public.clients c where c.id = client_uuid
  ), true)
$$;
revoke all on function public.nxq_client_taking_submissions(uuid) from public, anon, authenticated;

create or replace function public.nxq_block_submissions_when_not_taking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.nxq_client_taking_submissions(new.client_id) then
    raise exception 'This business is not taking new % right now.', coalesce(tg_argv[0], 'requests');
  end if;
  return new;
end;
$$;
revoke all on function public.nxq_block_submissions_when_not_taking() from public, anon, authenticated;

drop trigger if exists nxq_block_orders_when_not_taking on public.commerce_orders;
create trigger nxq_block_orders_when_not_taking before insert on public.commerce_orders
  for each row execute function public.nxq_block_submissions_when_not_taking('orders');
drop trigger if exists nxq_block_requests_when_not_taking on public.commerce_customer_requests;
create trigger nxq_block_requests_when_not_taking before insert on public.commerce_customer_requests
  for each row execute function public.nxq_block_submissions_when_not_taking('requests');
drop trigger if exists nxq_block_inquiries_when_not_taking on public.client_leads;
create trigger nxq_block_inquiries_when_not_taking before insert on public.client_leads
  for each row execute function public.nxq_block_submissions_when_not_taking('inquiries');
drop trigger if exists nxq_block_booking_when_not_taking on public.booking_appointment_requests;
create trigger nxq_block_booking_when_not_taking before insert on public.booking_appointment_requests
  for each row execute function public.nxq_block_submissions_when_not_taking('booking requests');

-- Booking's own "is this page open" check (migration 283) also learns about pause and cancel, so a paused client's public page says "not open" instead of failing at the last step.
create or replace function public.nxq_booking_client_ok(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clients c
    where c.id = client_uuid and c.status::text in ('approved', 'active', 'overdue')
      and coalesce(c.billing_status::text, '') not in ('frozen', 'cancelled')
      and c.paused_at is null and c.cancelled_at is null
  )
$$;

-- What a shopper's browser asks before showing the checkout: only a yes or no, never anything private.
create or replace function public.get_public_store_status(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('accepting', public.nxq_client_taking_submissions(s.client_id))
  from public.commerce_storefronts s
  where s.store_slug = lower(btrim(coalesce(store_slug_value, ''))) and s.status = 'active'
  limit 1
$$;
revoke all on function public.get_public_store_status(text) from public;
grant execute on function public.get_public_store_status(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Free first month: started once, automatically, when a (non-QA) client's status becomes 'approved'.
create or replace function public.nxq_start_first_month()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'approved' and old.status::text is distinct from 'approved'
     and new.first_month_started_at is null and coalesce(new.qa_only, false) = false then
    new.first_month_started_at := now();
    new.first_month_ends_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;
revoke all on function public.nxq_start_first_month() from public, anon, authenticated;
drop trigger if exists nxq_start_first_month on public.clients;
create trigger nxq_start_first_month before update of status on public.clients
  for each row execute function public.nxq_start_first_month();

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Owner actions. Each checks the caller is an owner, locks the client row, and writes the same two audit records the billing functions write.
create or replace function public.nxq_lifecycle_row(c public.clients)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'client_id', c.id, 'business_name', c.business_name, 'status', c.status::text, 'billing_status', c.billing_status::text,
    'paused_at', c.paused_at, 'paused_reason', c.paused_reason, 'cancelled_at', c.cancelled_at, 'site_taken_down_at', c.site_taken_down_at,
    'first_month_started_at', c.first_month_started_at, 'first_month_ends_at', c.first_month_ends_at, 'first_invoice_noted_at', c.first_invoice_noted_at,
    'first_month_days_left', case when c.first_month_ends_at is null then null else ceil(extract(epoch from (c.first_month_ends_at - now())) / 86400.0)::integer end
  )
$$;
revoke all on function public.nxq_lifecycle_row(public.clients) from public, anon, authenticated;

create or replace function public.owner_pause_client(target_client_id uuid, reason_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.clients%rowtype;
  reason_clean text := nullif(btrim(coalesce(reason_value, '')), '');
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  if reason_clean is null or length(reason_clean) < 8 then raise exception 'Write a reason of at least 8 characters.'; end if;
  if length(reason_clean) > 500 then raise exception 'The reason must be 500 characters or fewer.'; end if;
  select * into selected from public.clients where id = target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if selected.cancelled_at is not null then raise exception 'This client is already cancelled.'; end if;
  update public.clients set paused_at = coalesce(paused_at, now()), paused_reason = reason_clean, updated_at = now() where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.id, 'owner', 'client_paused', jsonb_build_object('reason', reason_clean, 'owner_auth_user_id', auth.uid()));
  insert into public.automation_audit_log(client_id, event_type, actor_type, details)
  values (selected.id, 'owner_client_paused', 'owner', jsonb_build_object('reason', reason_clean, 'owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'client_id', selected.id, 'message', selected.business_name || ' is paused: new orders, requests, inquiries and booking requests are not accepted. The site stays visible.');
end;
$$;

create or replace function public.owner_resume_client(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected public.clients%rowtype;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  select * into selected from public.clients where id = target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if selected.cancelled_at is not null then raise exception 'A cancelled client cannot be resumed here.'; end if;
  if selected.paused_at is null then return jsonb_build_object('success', true, 'already_applied', true, 'client_id', selected.id, 'message', selected.business_name || ' was not paused.'); end if;
  update public.clients set paused_at = null, paused_reason = null, updated_at = now() where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.id, 'owner', 'client_resumed', jsonb_build_object('owner_auth_user_id', auth.uid()));
  insert into public.automation_audit_log(client_id, event_type, actor_type, details)
  values (selected.id, 'owner_client_resumed', 'owner', jsonb_build_object('owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'client_id', selected.id, 'message', selected.business_name || ' is open again for new orders, requests, inquiries and booking requests.');
end;
$$;

create or replace function public.owner_cancel_client(target_client_id uuid, note_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.clients%rowtype;
  note_clean text := nullif(btrim(coalesce(note_value, '')), '');
  billing_moved boolean := false;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  if note_clean is null or length(note_clean) < 8 then raise exception 'Write a note of at least 8 characters.'; end if;
  if length(note_clean) > 500 then raise exception 'The note must be 500 characters or fewer.'; end if;
  select * into selected from public.clients where id = target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if selected.cancelled_at is not null then
    return jsonb_build_object('success', true, 'already_applied', true, 'client_id', selected.id, 'message', selected.business_name || ' was already cancelled.');
  end if;
  update public.clients set
    cancelled_at = now(), paused_at = coalesce(paused_at, now()), paused_reason = left('Cancelled: ' || note_clean, 500), updated_at = now()
  where id = selected.id;
  -- Billing follows the existing rules (an allowed move only; a client whose billing was never switched on has nothing to cancel).
  if selected.billing_status::text in ('active', 'past_due', 'freeze_review', 'frozen') and not coalesce(selected.qa_only, false) then
    perform public.owner_set_client_billing_state(selected.id, 'cancelled'::public.billing_status, null, note_clean);
    billing_moved := true;
  end if;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.id, 'owner', 'client_cancelled', jsonb_build_object('note', note_clean, 'billing_moved', billing_moved, 'owner_auth_user_id', auth.uid()));
  insert into public.automation_audit_log(client_id, event_type, actor_type, details)
  values (selected.id, 'owner_client_cancelled', 'owner', jsonb_build_object('note', note_clean, 'billing_moved', billing_moved, 'owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'client_id', selected.id, 'billing_moved', billing_moved,
    'message', selected.business_name || ' is cancelled: new submissions are stopped. Take the site down by hand, then press "I took it down".');
end;
$$;

create or replace function public.owner_mark_site_taken_down(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected public.clients%rowtype;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  select * into selected from public.clients where id = target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if selected.cancelled_at is null then raise exception 'Only a cancelled client can be marked as taken down.'; end if;
  update public.clients set site_taken_down_at = coalesce(site_taken_down_at, now()), updated_at = now() where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.id, 'owner', 'site_taken_down', jsonb_build_object('owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'client_id', selected.id, 'message', 'Recorded: the site for ' || selected.business_name || ' is taken down.');
end;
$$;

create or replace function public.owner_set_first_month(target_client_id uuid, start_value date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected public.clients%rowtype;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  if start_value is null or start_value < current_date - 365 or start_value > current_date + 30 then raise exception 'Choose a start date within the last year or the next 30 days.'; end if;
  select * into selected from public.clients where id = target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if coalesce(selected.qa_only, false) then raise exception 'QA-only clients have no free month.'; end if;
  update public.clients set first_month_started_at = start_value::timestamptz, first_month_ends_at = start_value::timestamptz + interval '30 days', first_invoice_noted_at = null, updated_at = now() where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.id, 'owner', 'first_month_set', jsonb_build_object('start', start_value, 'owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'client_id', selected.id, 'message', 'The free month for ' || selected.business_name || ' runs 30 days from ' || start_value::text || '.');
end;
$$;

create or replace function public.owner_note_first_invoice(target_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected public.clients%rowtype;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  select * into selected from public.clients where id = target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if selected.first_month_started_at is null then raise exception 'This client has no free first month to close.'; end if;
  update public.clients set first_invoice_noted_at = coalesce(first_invoice_noted_at, now()), updated_at = now() where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.id, 'owner', 'first_invoice_noted', jsonb_build_object('owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'client_id', selected.id, 'message', 'Recorded: you started invoicing ' || selected.business_name || '.');
end;
$$;

-- One read for the owner page: three short lists (QA-only clients are never shown), at most 200 each.
create or replace function public.owner_client_lifecycle_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  return jsonb_build_object(
    'needs_take_down', coalesce((select jsonb_agg(public.nxq_lifecycle_row(x) order by x.cancelled_at) from (
        select c.* from public.clients c where coalesce(c.qa_only, false) = false and c.cancelled_at is not null and c.site_taken_down_at is null order by c.cancelled_at limit 200) x), '[]'::jsonb),
    'paused', coalesce((select jsonb_agg(public.nxq_lifecycle_row(x) order by x.paused_at) from (
        select c.* from public.clients c where coalesce(c.qa_only, false) = false and c.paused_at is not null and c.cancelled_at is null order by c.paused_at limit 200) x), '[]'::jsonb),
    'first_month', coalesce((select jsonb_agg(public.nxq_lifecycle_row(x) order by x.first_month_ends_at) from (
        select c.* from public.clients c where coalesce(c.qa_only, false) = false and c.first_month_started_at is not null and c.first_invoice_noted_at is null and c.cancelled_at is null order by c.first_month_ends_at limit 200) x), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.owner_pause_client(uuid, text) from public, anon;
revoke all on function public.owner_resume_client(uuid) from public, anon;
revoke all on function public.owner_cancel_client(uuid, text) from public, anon;
revoke all on function public.owner_mark_site_taken_down(uuid) from public, anon;
revoke all on function public.owner_set_first_month(uuid, date) from public, anon;
revoke all on function public.owner_note_first_invoice(uuid) from public, anon;
revoke all on function public.owner_client_lifecycle_overview() from public, anon;
grant execute on function public.owner_pause_client(uuid, text) to authenticated;
grant execute on function public.owner_resume_client(uuid) to authenticated;
grant execute on function public.owner_cancel_client(uuid, text) to authenticated;
grant execute on function public.owner_mark_site_taken_down(uuid) to authenticated;
grant execute on function public.owner_set_first_month(uuid, date) to authenticated;
grant execute on function public.owner_note_first_invoice(uuid) to authenticated;
grant execute on function public.owner_client_lifecycle_overview() to authenticated;
