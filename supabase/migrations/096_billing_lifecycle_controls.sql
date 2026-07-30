-- Guarded billing lifecycle controls for NXQ Business.
-- Keeps project stages separate from billing and never charges a real payment method.

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
  allowed_transition boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  select * into selected_client
  from public.clients
  where id = target_client_id
  for update;

  if not found then
    raise exception 'Client not found.';
  end if;

  allowed_transition := case
    when selected_client.billing_status = next_billing_status then true
    when selected_client.billing_status in ('not_configured', 'activation_pending') and next_billing_status = 'active' then true
    when selected_client.billing_status = 'active' and next_billing_status in ('past_due', 'cancelled') then true
    when selected_client.billing_status = 'past_due' and next_billing_status in ('active', 'freeze_review', 'cancelled') then true
    when selected_client.billing_status = 'freeze_review' and next_billing_status in ('active', 'frozen', 'cancelled') then true
    when selected_client.billing_status = 'frozen' and next_billing_status in ('active', 'cancelled') then true
    when selected_client.billing_status = 'cancelled' and next_billing_status = 'active' then true
    else false
  end;

  if not allowed_transition then
    raise exception 'Invalid billing transition from % to %.', selected_client.billing_status, next_billing_status;
  end if;

  if next_billing_status = 'frozen' and selected_client.billing_status <> 'freeze_review' then
    raise exception 'Billing must be in freeze review before it can be frozen.';
  end if;

  update public.clients
  set
    billing_status = next_billing_status,
    billing_provider = coalesce(next_billing_provider, billing_provider, 'manual'),
    billing_overdue_since = case
      when next_billing_status = 'past_due' then coalesce(billing_overdue_since, now())
      when next_billing_status in ('active', 'cancelled') then null
      else billing_overdue_since
    end,
    billing_frozen_at = case
      when next_billing_status = 'frozen' then coalesce(billing_frozen_at, now())
      when next_billing_status = 'active' then null
      else billing_frozen_at
    end,
    billing_updated_at = now(),
    updated_at = now()
  where id = target_client_id;

  insert into public.activity_logs (client_id, actor_type, action, details)
  values (
    target_client_id,
    'owner',
    'billing_' || next_billing_status::text,
    jsonb_build_object(
      'previous_billing_status', selected_client.billing_status,
      'billing_status', next_billing_status,
      'billing_provider', coalesce(next_billing_provider, selected_client.billing_provider, 'manual'),
      'note', billing_note,
      'source', 'set_client_billing_state_guarded_rpc'
    )
  );

  return jsonb_build_object(
    'success', true,
    'client_id', target_client_id,
    'previous_billing_status', selected_client.billing_status,
    'billing_status', next_billing_status,
    'message', selected_client.business_name || ' billing changed from ' || replace(selected_client.billing_status::text, '_', ' ') || ' to ' || replace(next_billing_status::text, '_', ' ') || '.'
  );
end;
$$;

revoke all on function public.set_client_billing_state(uuid, public.billing_status, text, text) from public;
revoke all on function public.set_client_billing_state(uuid, public.billing_status, text, text) from anon;
grant execute on function public.set_client_billing_state(uuid, public.billing_status, text, text) to authenticated;

create or replace function public.record_manual_payment_and_restore(
  target_client_id uuid,
  payment_amount numeric default null,
  payment_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_client public.clients%rowtype;
  saved_payment_id uuid;
  amount_value numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.owner_users where owner_users.auth_user_id = auth.uid()
  ) then
    raise exception 'Owner access required.';
  end if;

  select * into selected_client
  from public.clients
  where id = target_client_id
  for update;

  if not found then
    raise exception 'Client not found.';
  end if;

  if selected_client.billing_status not in ('past_due', 'freeze_review', 'frozen') then
    raise exception 'Payment restoration is only available for past due, freeze review, or frozen billing.';
  end if;

  amount_value := coalesce(payment_amount, selected_client.monthly_price, 0);

  if amount_value <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  insert into public.payment_records (
    client_id, provider, status, amount, currency, note, created_at
  ) values (
    selected_client.id,
    'manual',
    'active',
    amount_value,
    'USD',
    coalesce(nullif(trim(payment_note), ''), selected_client.business_name || ' manual payment recorded. No online charge was processed.'),
    now()
  ) returning id into saved_payment_id;

  -- The existing payment-record trigger restores billing_status to active and clears overdue/frozen timestamps.
  insert into public.activity_logs (client_id, actor_type, action, details)
  values (
    selected_client.id,
    'owner',
    'manual_payment_recorded_and_billing_restored',
    jsonb_build_object(
      'previous_billing_status', selected_client.billing_status,
      'payment_record_id', saved_payment_id,
      'amount', amount_value,
      'currency', 'USD',
      'payment_mode', 'manual',
      'real_charge_processed', false,
      'source', 'record_manual_payment_and_restore_rpc'
    )
  );

  return jsonb_build_object(
    'success', true,
    'client_id', selected_client.id,
    'payment_record_id', saved_payment_id,
    'amount', amount_value,
    'billing_status', 'active',
    'message', selected_client.business_name || ' manual payment was recorded and billing was restored to active. No online charge was processed.'
  );
end;
$$;

revoke all on function public.record_manual_payment_and_restore(uuid, numeric, text) from public;
revoke all on function public.record_manual_payment_and_restore(uuid, numeric, text) from anon;
grant execute on function public.record_manual_payment_and_restore(uuid, numeric, text) to authenticated;
