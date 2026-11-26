-- Sidecar test for 13 (Stripe checkout links). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000013a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','co-owner@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-0000000013c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','co-one@synthetic.invalid','',now(),'{}','{"business_name":"Checkout One"}'),
 ('ffffffff-0000-0000-0000-0000000013c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','co-two@synthetic.invalid','',now(),'{}','{"business_name":"Checkout Two"}'),
 ('ffffffff-0000-0000-0000-0000000013c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','co-qa@synthetic.invalid','',now(),'{}','{"business_name":"Checkout QA"}'),
 ('ffffffff-0000-0000-0000-0000000013c4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','co-free@synthetic.invalid','',now(),'{}','{"business_name":"Checkout Free"}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-0000000013a1');

do $$
declare
  ow uuid := 'ffffffff-0000-0000-0000-0000000013a1';
  stranger uuid := 'ffffffff-0000-0000-0000-0000000013c1';
  c1 uuid; c2 uuid; cqa uuid; cfree uuid;
  r jsonb; r2 jsonb; a1 uuid; n integer;
begin
  select id into c1 from public.clients where auth_user_id = 'ffffffff-0000-0000-0000-0000000013c1';
  select id into c2 from public.clients where auth_user_id = 'ffffffff-0000-0000-0000-0000000013c2';
  select id into cqa from public.clients where auth_user_id = 'ffffffff-0000-0000-0000-0000000013c3';
  select id into cfree from public.clients where auth_user_id = 'ffffffff-0000-0000-0000-0000000013c4';
  if c1 is null or c2 is null or cqa is null or cfree is null then raise exception 'client fixtures missing'; end if;
  update public.clients set monthly_price = 50, status = 'active' where id in (c1, c2);
  update public.clients set monthly_price = 0, billing_status = 'not_configured', billing_provider = null, billing_due_at = null, billing_overdue_since = null, billing_frozen_at = null, qa_only = true where id = cqa; -- QA-only clients must have no billing state at all (migration 181)
  update public.clients set monthly_price = 5 where id = cfree;

  -- privileges: only the service role may call the functions or write the table
  if has_function_privilege('anon', 'public.nxq_checkout_reserve(uuid,uuid)', 'execute') or has_function_privilege('authenticated', 'public.nxq_checkout_reserve(uuid,uuid)', 'execute') then raise exception 'reserve must be service-role only'; end if;
  if has_function_privilege('authenticated', 'public.nxq_checkout_record_customer(uuid,text)', 'execute') or has_function_privilege('authenticated', 'public.nxq_checkout_mark_created(uuid,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.nxq_checkout_mark_failed(uuid,text)', 'execute') or has_function_privilege('authenticated', 'public.nxq_checkout_mark_completed(text,text,text,text)', 'execute') then raise exception 'writers must be service-role only'; end if;
  if not has_function_privilege('service_role', 'public.nxq_checkout_reserve(uuid,uuid)', 'execute') then raise exception 'service role must be able to reserve'; end if;
  if has_table_privilege('anon', 'public.billing_checkout_attempts', 'select') or has_table_privilege('authenticated', 'public.billing_checkout_attempts', 'insert')
     or has_table_privilege('authenticated', 'public.billing_checkout_attempts', 'update') or has_table_privilege('authenticated', 'public.billing_checkout_attempts', 'delete') then raise exception 'attempts table must not be writable or readable by app users'; end if;

  -- who may be billed
  r := public.nxq_checkout_reserve(c1, stranger);
  if (r->>'ok')::boolean or r->>'reason' is distinct from 'owner_required' then raise exception 'a non-owner must be refused, got %', r; end if;
  r := public.nxq_checkout_reserve(gen_random_uuid(), ow);
  if r->>'reason' is distinct from 'client_not_found' then raise exception 'unknown client must be refused, got %', r; end if;
  r := public.nxq_checkout_reserve(cqa, ow);
  if r->>'reason' is distinct from 'client_not_billable' then raise exception 'QA-only client must never be billed, got %', r; end if;
  r := public.nxq_checkout_reserve(cfree, ow);
  if r->>'reason' is distinct from 'no_plan_price' then raise exception 'a price under $10 must be refused, got %', r; end if;
  update public.clients set status = 'archived' where id = c2;
  r := public.nxq_checkout_reserve(c2, ow);
  if r->>'reason' is distinct from 'client_not_billable' then raise exception 'archived client must never be billed, got %', r; end if;
  update public.clients set status = 'active' where id = c2;

  -- a good reservation: amount comes from the database
  r := public.nxq_checkout_reserve(c1, ow);
  if not (r->>'ok')::boolean or (r->>'amount_cents')::int <> 5000 or r->>'business_name' is distinct from 'Checkout One' or r->'existing_customer_id' <> 'null'::jsonb then raise exception 'good reserve wrong: %', r; end if;
  a1 := (r->>'attempt_id')::uuid;

  -- asking again reuses the SAME attempt (so Stripe idempotency keys repeat)
  r2 := public.nxq_checkout_reserve(c1, ow);
  if (r2->>'attempt_id')::uuid <> a1 then raise exception 'a repeat request must reuse the open attempt'; end if;
  select count(*) into n from public.billing_checkout_attempts where client_id = c1;
  if n <> 1 then raise exception 'exactly one attempt expected, saw %', n; end if;
  -- the database refuses two open attempts for one client even if something tries to insert one directly
  begin
    insert into public.billing_checkout_attempts(client_id, requested_by, plan_name, amount_cents) values (c1, ow, 'x', 5000);
    raise exception 'second open attempt was accepted';
  exception when unique_violation then null; end;

  -- linking the customer
  r := public.nxq_checkout_record_customer(a1, 'cus_Abcdefgh12345');
  if not (r->>'ok')::boolean then raise exception 'link failed: %', r; end if;
  if not exists (select 1 from public.billing_provider_customer_links where client_id = c1 and provider_customer_id = 'cus_Abcdefgh12345' and status = 'active') then raise exception 'customer was not linked'; end if;
  r := public.nxq_checkout_record_customer(a1, 'cus_Abcdefgh12345');
  if not (r->>'ok')::boolean then raise exception 'linking the same customer twice must be fine'; end if;
  r := public.nxq_checkout_record_customer(a1, 'bad id');
  if r->>'reason' is distinct from 'customer_id_invalid' then raise exception 'bad customer id accepted'; end if;
  r := public.nxq_checkout_record_customer(a1, 'cus_Zzzzzzzz99999');
  if r->>'reason' is distinct from 'client_has_other_customer' then raise exception 'a second active customer for one client accepted: %', r; end if;
  -- the same Stripe customer can never be linked to another client
  r := public.nxq_checkout_reserve(c2, ow);
  r2 := public.nxq_checkout_record_customer((r->>'attempt_id')::uuid, 'cus_Abcdefgh12345');
  if r2->>'reason' is distinct from 'customer_linked_elsewhere' then raise exception 'customer linked to two clients: %', r2; end if;

  -- the reservation now reports the linked customer
  r := public.nxq_checkout_reserve(c1, ow);
  if r->>'existing_customer_id' is distinct from 'cus_Abcdefgh12345' then raise exception 'existing customer not reported: %', r; end if;

  -- session recorded
  r := public.nxq_checkout_mark_created(a1, 'not_a_session', now());
  if r->>'reason' is distinct from 'session_id_invalid' then raise exception 'bad session id accepted'; end if;
  r := public.nxq_checkout_mark_created(a1, 'cs_test_a1B2c3D4e5', now() + interval '23 hours');
  if not (r->>'ok')::boolean then raise exception 'mark_created failed: %', r; end if;
  r := public.nxq_checkout_mark_created(a1, 'cs_test_OTHER1234', now());
  if r->>'reason' is distinct from 'attempt_has_other_session' then raise exception 'an attempt took a second session'; end if;
  r := public.nxq_checkout_reserve(c1, ow);
  if (r->>'attempt_id')::uuid <> a1 then raise exception 'a created attempt must still be reused'; end if;

  -- completion: wrong customer is refused, right customer is recorded once, repeat is harmless
  r := public.nxq_checkout_mark_completed('cs_test_unknown999', 'cus_Abcdefgh12345', 'sub_123456789', 'evt_1');
  if r->>'reason' is distinct from 'unknown_session' then raise exception 'unknown session accepted'; end if;
  r := public.nxq_checkout_mark_completed('cs_test_a1B2c3D4e5', 'cus_Wrongcustomer1', 'sub_123456789', 'evt_1');
  if r->>'reason' is distinct from 'customer_not_linked_to_client' then raise exception 'wrong customer accepted: %', r; end if;
  r := public.nxq_checkout_mark_completed('cs_test_a1B2c3D4e5', 'cus_Abcdefgh12345', 'sub_123456789', 'evt_1');
  if not (r->>'ok')::boolean or (r->>'already_applied') is not null then raise exception 'completion failed: %', r; end if;
  r := public.nxq_checkout_mark_completed('cs_test_a1B2c3D4e5', 'cus_Abcdefgh12345', 'sub_123456789', 'evt_1');
  if not (r->>'ok')::boolean or (r->>'already_applied')::boolean is not true then raise exception 'repeat completion must be a no-op: %', r; end if;
  select count(*) into n from public.automation_audit_log where client_id = c1 and event_type = 'checkout_completed';
  if n <> 1 then raise exception 'completion must be audited exactly once, saw %', n; end if;
  r := public.nxq_checkout_reserve(c1, ow);
  if r->>'reason' is distinct from 'already_subscribed' then raise exception 'a subscribed client must not get a second checkout: %', r; end if;

  -- a failed attempt frees the client for a new one; a changed price closes the old attempt
  r := public.nxq_checkout_reserve(c2, ow);
  perform public.nxq_checkout_mark_failed((r->>'attempt_id')::uuid, 'stripe_status_402');
  if (select status from public.billing_checkout_attempts where id = (r->>'attempt_id')::uuid) <> 'failed' then raise exception 'attempt not marked failed'; end if;
  r2 := public.nxq_checkout_reserve(c2, ow);
  if (r2->>'attempt_id') = (r->>'attempt_id') then raise exception 'a failed attempt must not be reused'; end if;
  update public.clients set monthly_price = 60 where id = c2;
  r := public.nxq_checkout_reserve(c2, ow);
  if (r->>'amount_cents')::int <> 6000 or (r->>'attempt_id') = (r2->>'attempt_id') then raise exception 'a price change must start a fresh attempt: %', r; end if;
  if (select status from public.billing_checkout_attempts where id = (r2->>'attempt_id')::uuid) <> 'expired' then raise exception 'old-price attempt should be closed'; end if;
  -- an old open attempt (link expired) is closed and replaced
  update public.billing_checkout_attempts set created_at = now() - interval '21 hours' where id = (r->>'attempt_id')::uuid;
  r2 := public.nxq_checkout_reserve(c2, ow);
  if (r2->>'attempt_id') = (r->>'attempt_id') then raise exception 'an expired attempt must be replaced'; end if;
  -- amounts outside the range are refused by the table itself
  begin
    insert into public.billing_checkout_attempts(client_id, requested_by, plan_name, amount_cents, status) values (cfree, ow, 'x', 999, 'failed');
    raise exception 'amount under $10 accepted by the table';
  exception when check_violation then null; end;

  -- the owner can read the attempts, other signed-in users cannot
  perform set_config('request.jwt.claim.sub', ow::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', ow::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.billing_checkout_attempts;
  reset role;
  if n < 2 then raise exception 'owner should read attempts, saw %', n; end if;
  perform set_config('request.jwt.claim.sub', stranger::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', stranger::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.billing_checkout_attempts;
  reset role;
  if n <> 0 then raise exception 'a client must not read checkout attempts, saw %', n; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
