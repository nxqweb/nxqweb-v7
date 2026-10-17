-- Sidecar test for draft 07 (referral credit on invoices). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('abababab-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','credit-one@synthetic.invalid','',now(),'{}','{"business_name":"Credit One","product_family_slug":"business","product_tier_key":"starter"}'),
 ('abababab-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','credit-two@synthetic.invalid','',now(),'{}','{"business_name":"Credit Two","product_family_slug":"business","product_tier_key":"starter"}');

-- one has $45 of available credit, two has none
insert into public.nxq_referral_credit_ledger(client_id,entry_type,status,amount,remaining_amount,idempotency_key,description,available_at)
select c.id,'earned','available',45,45,'test-credit-one','test credit',now() from public.clients c where c.auth_user_id = 'abababab-0000-0000-0000-0000000000a1';

create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin
  execute sql;
  return false;
exception when others then
  return sqlerrm like '%' || expected || '%';
end $f$;

do $$
declare
  one uuid; two uuid;
  r jsonb;
  avail numeric;
begin
  select id into one from public.clients where auth_user_id = 'abababab-0000-0000-0000-0000000000a1';
  select id into two from public.clients where auth_user_id = 'abababab-0000-0000-0000-0000000000a2';
  if one is null or two is null then raise exception 'client fixtures missing'; end if;

  -- privileges: service role only
  if has_function_privilege('anon', 'public.nxq_reserve_referral_credit_for_invoice(uuid,text,text,numeric)', 'execute') or has_function_privilege('authenticated', 'public.nxq_reserve_referral_credit_for_invoice(uuid,text,text,numeric)', 'execute')
     or has_function_privilege('anon', 'public.nxq_release_referral_credit_for_invoice(text,text,text)', 'execute') or has_function_privilege('authenticated', 'public.nxq_release_referral_credit_for_invoice(text,text,text)', 'execute') then raise exception 'only the service role may call these'; end if;
  if not has_function_privilege('service_role', 'public.nxq_reserve_referral_credit_for_invoice(uuid,text,text,numeric)', 'execute') or not has_function_privilege('service_role', 'public.nxq_release_referral_credit_for_invoice(text,text,text)', 'execute') then raise exception 'service role must be able to call these'; end if;

  -- program is OFF by default: nothing is used up
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_off', 50);
  if (r->>'credit_applied')::numeric is distinct from 0 or r->>'reason' is distinct from 'program_off' then raise exception 'program off must apply nothing: %', r; end if;
  if exists (select 1 from public.nxq_invoice_credit_applications where provider_invoice_id = 'in_off') then raise exception 'program off must not write an application'; end if;

  update public.nxq_growth_program_settings set referral_program_enabled = true where singleton = true;

  -- on: $45 credit against a $50 invoice is capped at $40 by the $10 protected minimum
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_one', 50);
  if (r->>'credit_applied')::numeric is distinct from 40 or (r->>'amount_due')::numeric is distinct from 10 then raise exception 'cap: %', r; end if;
  select coalesce(sum(remaining_amount),0) into avail from public.nxq_referral_credit_ledger where client_id = one and status = 'available';
  if avail is distinct from 5 then raise exception 'credit left should be 5, was %', avail; end if;

  -- asking again for the same invoice is idempotent: no second deduction
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_one', 50);
  if (r->>'credit_applied')::numeric is distinct from 40 then raise exception 'idempotent reply: %', r; end if;
  select coalesce(sum(remaining_amount),0) into avail from public.nxq_referral_credit_ledger where client_id = one and status = 'available';
  if avail is distinct from 5 then raise exception 'second ask must not take more credit, left %', avail; end if;

  -- a client with no credit gets zero and no error
  r := public.nxq_reserve_referral_credit_for_invoice(two, 'stripe', 'in_two', 50);
  if (r->>'credit_applied')::numeric is distinct from 0 then raise exception 'no credit: %', r; end if;

  -- an invoice under the protected minimum is refused kindly (credit 0), never an error
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_tiny', 9);
  if (r->>'credit_applied')::numeric is distinct from 0 or r->>'reason' is distinct from 'below_protected_minimum' then raise exception 'tiny invoice: %', r; end if;

  -- release: the $40 comes back and the invoice can be tried again
  r := public.nxq_release_referral_credit_for_invoice('stripe', 'in_one', 'stripe refused the line');
  if (r->>'released')::numeric is distinct from 40 then raise exception 'release: %', r; end if;
  select coalesce(sum(remaining_amount),0) into avail from public.nxq_referral_credit_ledger where client_id = one and status = 'available';
  if avail is distinct from 45 then raise exception 'credit must be back to 45, was %', avail; end if;
  if exists (select 1 from public.nxq_invoice_credit_applications where provider_key = 'stripe' and provider_invoice_id = 'in_one') then raise exception 'the application must be renamed so a retry can happen'; end if;
  if (select count(*) from public.nxq_invoice_credit_applications where provider_invoice_id like 'in_one:released:%') is distinct from 1 then raise exception 'the old application must be kept for the audit trail'; end if;
  if not exists (select 1 from public.activity_logs where client_id = one and action = 'referral_credit_released') then raise exception 'release must be logged'; end if;

  -- retry after release works and takes the credit again
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_one', 50);
  if (r->>'credit_applied')::numeric is distinct from 40 then raise exception 'retry after release: %', r; end if;
  select coalesce(sum(remaining_amount),0) into avail from public.nxq_referral_credit_ledger where client_id = one and status = 'available';
  if avail is distinct from 5 then raise exception 'after the retry 5 should be left, was %', avail; end if;

  -- releasing something that never existed is a harmless no-op
  r := public.nxq_release_referral_credit_for_invoice('stripe', 'in_never', 'x');
  if (r->>'released')::numeric is distinct from 0 then raise exception 'unknown release: %', r; end if;

  -- turning the program off again stops new credits immediately
  update public.nxq_growth_program_settings set referral_program_enabled = false where singleton = true;
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_after_off', 50);
  if (r->>'credit_applied')::numeric is distinct from 0 then raise exception 'program switched off again: %', r; end if;

  -- signed-out and normal users are refused
  perform set_config('request.jwt.claim.role', 'anon', true);
  if not pg_temp.fails($q$select public.nxq_reserve_referral_credit_for_invoice(null, 'stripe', 'x', 50)$q$, 'Service-role access required') then raise exception 'anon must be refused'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
