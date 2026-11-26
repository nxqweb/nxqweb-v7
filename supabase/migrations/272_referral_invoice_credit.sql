-- Migration 272: safe plumbing for taking referral credit off a real Stripe invoice (owner chose "Option A": a negative line on each new draft invoice).
-- Two service-role-only functions around the existing nxq_apply_referral_credit (migration 229), which is left unchanged:
--   nxq_reserve_referral_credit_for_invoice(client, provider, invoice id, subtotal)
--       Does nothing (credit 0) unless the referral program is switched on. Otherwise uses up credit for that ONE invoice (idempotent per invoice,
--       the $10 protected minimum is still enforced by the 229 function) and returns how much was used.
--   nxq_release_referral_credit_for_invoice(provider, invoice id, reason)
--       Gives the credit back when Stripe definitely refused the invoice line, so a client is never left without credit they were not shown.
--       The audit trail is kept: nothing is deleted, rows are renamed and a new 'adjustment' credit row restores the amount.
-- The Edge function that calls these only runs when billing and referral credits are explicitly enabled, and only against Stripe test mode first.

create or replace function public.nxq_reserve_referral_credit_for_invoice(
  target_client_id uuid, target_provider_key text, target_provider_invoice_id text, target_invoice_subtotal numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  program_on boolean;
  result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  if target_client_id is null or nullif(btrim(coalesce(target_provider_key, '')), '') is null or nullif(btrim(coalesce(target_provider_invoice_id, '')), '') is null then
    raise exception 'Client, provider and invoice are required.';
  end if;
  if exists (select 1 from public.clients where id = target_client_id and coalesce(qa_only, false)) then
    return jsonb_build_object('ok', true, 'credit_applied', 0, 'reason', 'qa_only_client');
  end if;
  select referral_program_enabled into program_on from public.nxq_growth_program_settings where singleton = true;
  if not coalesce(program_on, false) then
    return jsonb_build_object('ok', true, 'credit_applied', 0, 'reason', 'program_off');
  end if;
  if target_invoice_subtotal is null or target_invoice_subtotal < 10 then
    return jsonb_build_object('ok', true, 'credit_applied', 0, 'reason', 'below_protected_minimum');
  end if;
  result := public.nxq_apply_referral_credit(target_client_id, target_provider_key, target_provider_invoice_id, target_invoice_subtotal);
  return jsonb_build_object('ok', true, 'credit_applied', coalesce((result ->> 'credit_applied')::numeric, 0), 'amount_due', coalesce((result ->> 'amount_due')::numeric, target_invoice_subtotal));
end;
$$;

create or replace function public.nxq_release_referral_credit_for_invoice(
  target_provider_key text, target_provider_invoice_id text, target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  application public.nxq_invoice_credit_applications%rowtype;
  stamp text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  restored numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access required.'; end if;
  select * into application from public.nxq_invoice_credit_applications
   where provider_key = target_provider_key and provider_invoice_id = target_provider_invoice_id for update;
  if not found then return jsonb_build_object('ok', true, 'released', 0, 'reason', 'no_application'); end if;
  restored := application.credit_applied;
  if restored > 0 then
    -- the 'applied' ledger row keeps its history but stops blocking a later retry for the same invoice
    update public.nxq_referral_credit_ledger
       set status = 'reversed', idempotency_key = idempotency_key || ':released:' || stamp
     where idempotency_key = 'invoice:' || target_provider_key || ':' || target_provider_invoice_id;
    insert into public.nxq_referral_credit_ledger(client_id, entry_type, status, amount, remaining_amount, provider_invoice_id, idempotency_key, description, available_at, metadata)
    values (application.client_id, 'adjustment', 'available', restored, restored, left(target_provider_invoice_id, 180),
            'release:' || target_provider_key || ':' || target_provider_invoice_id || ':' || stamp,
            'Credit restored because the invoice line could not be added', now(),
            jsonb_build_object('reason', left(coalesce(target_reason, 'unspecified'), 200)));
  end if;
  update public.nxq_invoice_credit_applications
     set provider_invoice_id = left(provider_invoice_id, 150) || ':released:' || stamp
   where id = application.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (application.client_id, 'system', 'referral_credit_released',
          jsonb_build_object('provider_invoice_id', target_provider_invoice_id, 'restored', restored, 'reason', left(coalesce(target_reason, 'unspecified'), 200)));
  return jsonb_build_object('ok', true, 'released', restored);
end;
$$;

revoke all on function public.nxq_reserve_referral_credit_for_invoice(uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.nxq_release_referral_credit_for_invoice(text, text, text) from public, anon, authenticated;
grant execute on function public.nxq_reserve_referral_credit_for_invoice(uuid, text, text, numeric) to service_role;
grant execute on function public.nxq_release_referral_credit_for_invoice(text, text, text) to service_role;
