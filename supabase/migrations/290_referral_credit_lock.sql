-- 290: promoted from draft 08 on 2026-11-13 (owner chose Option A in chat); NOT applied until the owner approves the guarded run.
-- Fixes a known bug from the handoff list: the referral-credit function had no lock per client.
-- Two invoices for the SAME client handled at the same moment could each read the same available credit
-- before either used it, and the second could record more credit than was really left.
-- Change: one statement. The function takes a per-client transaction lock before it reads the balance, so
-- a second invoice for that client waits until the first has finished and then sees what is really left.
-- Different clients do not wait for each other. Function text otherwise identical to the definition in
-- force (migration 229); create or replace keeps the existing grants (service role only).
-- The referral program is switched OFF today, so nothing is affected until it is turned on.

CREATE OR REPLACE FUNCTION public.nxq_apply_referral_credit(target_client_id uuid, target_provider_key text, target_provider_invoice_id text, target_invoice_subtotal numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare floor_amount numeric; cap numeric; available numeric; apply_amount numeric; remaining numeric; row_record record;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role access required.'; end if;
  -- One client's credit is used by one invoice at a time (held until this transaction ends).
  perform pg_advisory_xact_lock(hashtextextended('nxq-referral-credit:'||target_client_id::text,0));
  if target_invoice_subtotal<10 then raise exception 'Invoice subtotal is below the protected minimum.'; end if;
  if exists(select 1 from public.nxq_invoice_credit_applications where provider_key=target_provider_key and provider_invoice_id=target_provider_invoice_id) then
    return (select to_jsonb(x) from public.nxq_invoice_credit_applications x where provider_key=target_provider_key and provider_invoice_id=target_provider_invoice_id);
  end if;
  select minimum_invoice_payment into floor_amount from public.nxq_growth_program_settings where singleton=true;
  cap:=greatest(target_invoice_subtotal-floor_amount,0);
  select coalesce(sum(remaining_amount),0) into available from public.nxq_referral_credit_ledger where client_id=target_client_id and status='available' and remaining_amount>0;
  apply_amount:=least(cap,available); remaining:=apply_amount;
  for row_record in select id,remaining_amount from public.nxq_referral_credit_ledger where client_id=target_client_id and status='available' and remaining_amount>0 order by available_at,created_at for update
  loop
    exit when remaining<=0;
    update public.nxq_referral_credit_ledger set remaining_amount=greatest(remaining_amount-least(remaining,row_record.remaining_amount),0),status=case when remaining_amount-least(remaining,row_record.remaining_amount)<=0 then 'applied' else 'available' end where id=row_record.id;
    remaining:=remaining-least(remaining,row_record.remaining_amount);
  end loop;
  insert into public.nxq_invoice_credit_applications(client_id,provider_key,provider_invoice_id,invoice_subtotal,credit_applied,amount_due) values(target_client_id,left(target_provider_key,80),left(target_provider_invoice_id,180),target_invoice_subtotal,apply_amount,target_invoice_subtotal-apply_amount);
  if apply_amount>0 then insert into public.nxq_referral_credit_ledger(client_id,entry_type,status,amount,remaining_amount,provider_invoice_id,idempotency_key,description) values(target_client_id,'applied','applied',-apply_amount,0,left(target_provider_invoice_id,180),'invoice:'||target_provider_key||':'||target_provider_invoice_id,'Referral credits applied to invoice'); end if;
  return jsonb_build_object('ok',true,'invoice_subtotal',target_invoice_subtotal,'credit_applied',apply_amount,'amount_due',target_invoice_subtotal-apply_amount,'minimum_payment',floor_amount,'cash_value',false);
end; $function$;
