-- Owner-only link / unlink / list of a Stripe customer for an NXQX client (promoted from draft 04 on 2026-10-06, owner approved).
-- Today billing_provider_customer_links can only be written by the service role, so linking a Stripe customer to a
-- client needs hand-written SQL. The Stripe webhook (ingest-stripe-webhook) only accepts events from customers that have an
-- ACTIVE link here, and the billing readiness check counts active links, so this is the missing owner step in
-- docs/STRIPE_LAUNCH_RUNBOOK.md ("Link a test Stripe Customer ID to a non-QA NXQ staging client").
-- No payment, price or key is touched: this only records which Stripe customer belongs to which client.

create or replace function public.owner_link_stripe_customer(target_client_id uuid, target_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_client public.clients%rowtype;
  customer_value text := btrim(coalesce(target_customer_id, ''));
  client_link public.billing_provider_customer_links%rowtype;
  customer_link public.billing_provider_customer_links%rowtype;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  if customer_value !~ '^cus_[A-Za-z0-9]{8,64}$' then
    raise exception 'A Stripe customer ID looks like cus_ followed by letters and numbers.';
  end if;

  select * into selected_client from public.clients where id = target_client_id for update;
  if not found then raise exception 'Client not found.'; end if;
  if selected_client.qa_only then raise exception 'QA-only clients are permanently non-billable.'; end if;
  if selected_client.status::text in ('denied', 'archived', 'dormant') then
    raise exception 'A % client cannot be linked to a billing customer.', selected_client.status;
  end if;

  select * into customer_link from public.billing_provider_customer_links
  where provider_key = 'stripe' and provider_customer_id = customer_value;
  if found and customer_link.client_id <> selected_client.id then
    raise exception 'That Stripe customer is already linked to a different client.';
  end if;

  select * into client_link from public.billing_provider_customer_links
  where provider_key = 'stripe' and client_id = selected_client.id;
  if found and client_link.status = 'active' and client_link.provider_customer_id = customer_value then
    return jsonb_build_object('success', true, 'already_applied', true, 'client_id', selected_client.id,
      'message', selected_client.business_name || ' is already linked to that Stripe customer.');
  end if;
  if found and client_link.status = 'active' then
    raise exception 'This client already has a different active Stripe customer. Disable that link first.';
  end if;

  if found then
    update public.billing_provider_customer_links
    set provider_customer_id = customer_value, status = 'active', verified_at = null, updated_at = now(),
        metadata = metadata || jsonb_build_object('relinked_by_owner', true)
    where id = client_link.id;
  else
    insert into public.billing_provider_customer_links(provider_key, provider_customer_id, client_id, status, metadata)
    values ('stripe', customer_value, selected_client.id, 'active', jsonb_build_object('linked_by_owner', true));
  end if;

  insert into public.automation_audit_log(client_id, event_type, actor_type, details)
  values (selected_client.id, 'owner_stripe_customer_linked', 'owner', jsonb_build_object(
    'customer_hint', right(customer_value, 4), 'owner_auth_user_id', auth.uid(), 'source', 'owner_link_stripe_customer'));

  return jsonb_build_object('success', true, 'client_id', selected_client.id,
    'message', selected_client.business_name || ' is now linked to that Stripe customer.');
end;
$$;

create or replace function public.owner_disable_stripe_customer_link(target_client_id uuid, disable_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  note_value text := nullif(btrim(coalesce(disable_note, '')), '');
  updated_count integer;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  update public.billing_provider_customer_links
  set status = 'disabled', updated_at = now(),
      metadata = metadata || jsonb_build_object('disabled_by_owner', true)
  where provider_key = 'stripe' and client_id = target_client_id and status = 'active';
  get diagnostics updated_count = row_count;
  if updated_count = 0 then raise exception 'This client has no active Stripe customer link.'; end if;

  insert into public.automation_audit_log(client_id, event_type, actor_type, details)
  values (target_client_id, 'owner_stripe_customer_unlinked', 'owner', jsonb_build_object(
    'note', note_value, 'owner_auth_user_id', auth.uid(), 'source', 'owner_disable_stripe_customer_link'));
  return jsonb_build_object('success', true, 'client_id', target_client_id);
end;
$$;

create or replace function public.owner_list_stripe_customer_links()
returns table (client_id uuid, business_name text, provider_customer_id text, status text, created_at timestamptz, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then
    raise exception 'Owner access required.';
  end if;
  return query
  select l.client_id, c.business_name::text, l.provider_customer_id, l.status, l.created_at, l.updated_at
  from public.billing_provider_customer_links l
  join public.clients c on c.id = l.client_id
  where l.provider_key = 'stripe'
  order by l.updated_at desc
  limit 200;
end;
$$;

revoke all on function public.owner_link_stripe_customer(uuid, text) from public, anon;
revoke all on function public.owner_disable_stripe_customer_link(uuid, text) from public, anon;
revoke all on function public.owner_list_stripe_customer_links() from public, anon;
grant execute on function public.owner_link_stripe_customer(uuid, text) to authenticated;
grant execute on function public.owner_disable_stripe_customer_link(uuid, text) to authenticated;
grant execute on function public.owner_list_stripe_customer_links() to authenticated;

comment on function public.owner_link_stripe_customer(uuid, text) is
  'Owner-only: records which Stripe customer belongs to a non-QA client. Never accepts keys or prices; one active link per client and per customer.';
