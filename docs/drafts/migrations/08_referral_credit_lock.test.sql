-- Sidecar test for 08 (per-client lock on referral credit). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
-- A single session cannot stage a real race; this pins that the lock is taken and that results are unchanged.
-- The two-session race itself was run by hand on 2026-11-13 (see the README row for this draft).
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lock-one@synthetic.invalid','',now(),'{}','{"business_name":"Lock One","product_family_slug":"business","product_tier_key":"starter"}');

insert into public.nxq_referral_credit_ledger(client_id,entry_type,status,amount,remaining_amount,idempotency_key,description,available_at)
select c.id,'earned','available',45,45,'test-lock-credit-one','test credit',now() from public.clients c where c.auth_user_id = 'ffffffff-0000-0000-0000-0000000008a1';

do $$
declare
  one uuid; r jsonb; held integer; left_over numeric;
begin
  select id into one from public.clients where auth_user_id = 'ffffffff-0000-0000-0000-0000000008a1';
  if one is null then raise exception 'client fixture missing (test would be vacuous)'; end if;
  update public.nxq_growth_program_settings set referral_program_enabled = true where singleton = true;

  select count(*) into held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
  if held <> 0 then raise exception 'unexpected advisory lock before the call'; end if;

  -- $45 credit against a $50 invoice: capped at $40 by the $10 protected minimum (unchanged behaviour)
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_lock_one', 50);
  if (r->>'credit_applied')::numeric is distinct from 40 then raise exception 'first invoice should use 40: %', r; end if;

  -- the per-client lock is now held by this transaction
  select count(*) into held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted;
  if held < 1 then raise exception 'the per-client credit lock was not taken'; end if;

  -- a second invoice sees only what is really left ($5), and a repeat of the first changes nothing
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_lock_two', 50);
  if (r->>'credit_applied')::numeric is distinct from 5 then raise exception 'second invoice should use the remaining 5: %', r; end if;
  r := public.nxq_reserve_referral_credit_for_invoice(one, 'stripe', 'in_lock_one', 50);
  if (r->>'credit_applied')::numeric is distinct from 40 then raise exception 'repeat of the first invoice must be unchanged: %', r; end if;
  select coalesce(sum(remaining_amount),0) into left_over from public.nxq_referral_credit_ledger where client_id = one and status = 'available';
  if left_over <> 0 then raise exception 'all 45 should be used, % left', left_over; end if;
  if (select sum(credit_applied) from public.nxq_invoice_credit_applications where client_id = one) <> 45 then raise exception 'recorded credit must equal the 45 that existed'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
