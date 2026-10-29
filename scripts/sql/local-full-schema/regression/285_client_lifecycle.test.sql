-- Regression test for migration 285 (client lifecycle: pause, cancel, free first month). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','life-owner@synthetic.invalid','',now(),'{}','{}'),
 ('ffffffff-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','life-one@synthetic.invalid','',now(),'{}','{"business_name":"Life Candles One","product_family_slug":"business"}'),
 ('ffffffff-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','life-two@synthetic.invalid','',now(),'{}','{"business_name":"Life Candles Two","product_family_slug":"business"}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-0000000000a1');

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claim.role', case when uid is null then 'anon' else 'authenticated' end, true);
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(uid::text, ''), 'role', case when uid is null then 'anon' else 'authenticated' end)::text, true);
end $f$;

create or replace function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $f$
begin
  execute sql;
  return false;
exception when others then
  return sqlerrm like '%' || expected || '%';
end $f$;

do $$
declare
  ow uuid := 'ffffffff-0000-0000-0000-0000000000a1';
  u1 uuid := 'ffffffff-0000-0000-0000-0000000000c1';
  u2 uuid := 'ffffffff-0000-0000-0000-0000000000c2';
  c1 uuid; c2 uuid; c3 uuid; sf uuid; r jsonb; n integer;
begin
  select id into c1 from public.clients where auth_user_id = u1;
  select id into c2 from public.clients where auth_user_id = u2;
  if c1 is null or c2 is null then raise exception 'client fixtures missing'; end if;
  insert into public.commerce_storefronts(client_id, store_name, store_slug, status) values (c1, 'Life One', 'life-one', 'active') returning id into sf;

  -- privileges
  if has_function_privilege('anon', 'public.owner_pause_client(uuid,text)', 'execute') or has_function_privilege('anon', 'public.owner_cancel_client(uuid,text)', 'execute') or has_function_privilege('anon', 'public.owner_client_lifecycle_overview()', 'execute') then raise exception 'anon must not call owner functions'; end if;
  if has_function_privilege('anon', 'public.nxq_client_taking_submissions(uuid)', 'execute') or has_function_privilege('authenticated', 'public.nxq_block_submissions_when_not_taking()', 'execute') then raise exception 'internal helpers must not be callable'; end if;
  if not has_function_privilege('anon', 'public.get_public_store_status(text)', 'execute') then raise exception 'store status must be public'; end if;

  -- an approved client starts the free month once, automatically; a normal update later does not restart it
  if (select first_month_started_at from public.clients where id = c1) is not null then raise exception 'no month before approval'; end if;
  update public.clients set status = 'approved' where id = c1;
  if (select first_month_started_at is null or first_month_ends_at - first_month_started_at <> interval '30 days' from public.clients where id = c1) then raise exception 'approval must start a 30 day month'; end if;
  update public.clients set first_month_started_at = now() - interval '5 days', first_month_ends_at = now() + interval '25 days' where id = c1;
  update public.clients set status = 'active' where id = c1;
  update public.clients set status = 'approved' where id = c1;
  if (select first_month_started_at > now() - interval '4 days' from public.clients where id = c1) then raise exception 'month must not restart'; end if;

  -- open: submissions work
  insert into public.client_leads(client_id, contact_name) values (c1, 'Open Lead');
  if (public.get_public_store_status('life-one')->>'accepting')::boolean is not true then raise exception 'open store must accept'; end if;
  if public.get_public_store_status('no-such-store') is not null then raise exception 'unknown store must return nothing'; end if;

  -- owner checks
  perform pg_temp.as_user(u1);
  if not pg_temp.fails(format($q$select public.owner_pause_client(%L, 'a long enough reason')$q$, c1), 'Owner access required') then raise exception 'client must not pause'; end if;
  if not pg_temp.fails($q$select public.owner_client_lifecycle_overview()$q$, 'Owner access required') then raise exception 'client must not read overview'; end if;
  perform pg_temp.as_user(ow);
  if not pg_temp.fails(format($q$select public.owner_pause_client(%L, 'short')$q$, c1), 'at least 8') then raise exception 'short reason refused'; end if;

  -- pause
  r := public.owner_pause_client(c1, 'Candle maker is on holiday');
  if (r->>'success')::boolean is not true then raise exception 'pause failed: %', r; end if;
  perform pg_temp.as_user(null);
  if (public.get_public_store_status('life-one')->>'accepting')::boolean is not false then raise exception 'paused store must say not accepting'; end if;
  if not pg_temp.fails(format($q$insert into public.client_leads(client_id, contact_name) values (%L, 'Paused Lead')$q$, c1), 'not taking new inquiries') then raise exception 'paused lead must be refused'; end if;
  if not pg_temp.fails(format($q$insert into public.commerce_customer_requests(client_id, request_type, customer_name, customer_email, product_name, description) values (%L, 'custom_order', 'A', 'a@b.co', 'Candle', 'Something nice')$q$, c1), 'not taking new requests') then raise exception 'paused request must be refused'; end if;
  if not pg_temp.fails(format($q$insert into public.commerce_orders(client_id, storefront_id, order_number) values (%L, %L, 'LF-1')$q$, c1, sf), 'not taking new orders') then raise exception 'paused order must be refused'; end if;
  -- the other client is untouched
  insert into public.client_leads(client_id, contact_name) values (c2, 'Other Lead');
  select count(*) into n from public.activity_logs where client_id = c1 and action = 'client_paused';
  if n <> 1 then raise exception 'pause must be logged'; end if;

  -- resume
  perform pg_temp.as_user(ow);
  r := public.owner_resume_client(c1);
  insert into public.client_leads(client_id, contact_name) values (c1, 'Back Lead');
  insert into public.commerce_orders(client_id, storefront_id, order_number) values (c1, sf, 'LF-2');
  if (public.owner_resume_client(c1)->>'already_applied')::boolean is not true then raise exception 'resume twice must be a no-op'; end if;

  -- overview before cancel
  r := public.owner_client_lifecycle_overview();
  if jsonb_array_length(r->'first_month') < 1 then raise exception 'first month must be listed: %', r; end if;
  if jsonb_array_length(r->'needs_take_down') <> 0 then raise exception 'nothing to take down yet'; end if;

  -- cancel
  if not pg_temp.fails(format($q$select public.owner_mark_site_taken_down(%L)$q$, c1), 'Only a cancelled client') then raise exception 'take down needs cancel first'; end if;
  r := public.owner_cancel_client(c1, 'Client asked to cancel by email');
  if (r->>'success')::boolean is not true then raise exception 'cancel failed: %', r; end if;
  if (public.owner_cancel_client(c1, 'Client asked to cancel by email')->>'already_applied')::boolean is not true then raise exception 'cancel twice must be a no-op'; end if;
  if not pg_temp.fails(format($q$select public.owner_resume_client(%L)$q$, c1), 'cancelled client cannot be resumed') then raise exception 'cancelled cannot resume'; end if;
  if not pg_temp.fails(format($q$select public.owner_pause_client(%L, 'pausing after cancel')$q$, c1), 'already cancelled') then raise exception 'cancelled cannot pause'; end if;
  perform pg_temp.as_user(null);
  if not pg_temp.fails(format($q$insert into public.client_leads(client_id, contact_name) values (%L, 'Late Lead')$q$, c1), 'not taking new inquiries') then raise exception 'cancelled lead must be refused'; end if;
  perform pg_temp.as_user(ow);
  if jsonb_array_length(public.owner_client_lifecycle_overview()->'needs_take_down') <> 1 then raise exception 'cancelled client needs a take-down item'; end if;
  perform public.owner_mark_site_taken_down(c1);
  if jsonb_array_length(public.owner_client_lifecycle_overview()->'needs_take_down') <> 0 then raise exception 'take-down item must clear'; end if;

  -- first month actions on the other client
  if not pg_temp.fails(format($q$select public.owner_note_first_invoice(%L)$q$, c2), 'no free first month') then raise exception 'no month to close'; end if;
  if not pg_temp.fails(format($q$select public.owner_set_first_month(%L, current_date + 90)$q$, c2), 'within the last year') then raise exception 'far future date refused'; end if;
  perform public.owner_set_first_month(c2, current_date - 20);
  r := (select e from jsonb_array_elements(public.owner_client_lifecycle_overview()->'first_month') e where e->>'client_id' = c2::text);
  if r is null or (r->>'first_month_days_left')::integer not between 9 and 11 then raise exception 'days left wrong: %', r; end if;
  perform public.owner_note_first_invoice(c2);
  if exists (select 1 from jsonb_array_elements(public.owner_client_lifecycle_overview()->'first_month') e where e->>'client_id' = c2::text) then raise exception 'invoiced month must leave the list'; end if;

  -- QA-only clients never show up (and never get an automatic month)
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
   ('ffffffff-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','life-qa@synthetic.invalid','',now(),'{}','{}');
  insert into public.clients (id,auth_user_id,business_name,contact_email,business_type,status,monthly_price,billing_status,billing_provider,product_family_id,product_tier_id,qa_only)
  select gen_random_uuid(),'ffffffff-0000-0000-0000-0000000000c3','Life QA','life-qa@synthetic.invalid','Synthetic','lead',0,'not_configured',null,product_family_id,product_tier_id,true from public.clients where id = c1
  returning id into c3;
  update public.clients set status = 'approved' where id = c3;
  if (select first_month_started_at from public.clients where id = c3) is not null then raise exception 'QA clients must not get an automatic month'; end if;
  update public.clients set first_month_started_at = now(), first_month_ends_at = now() + interval '30 days' where id = c3;
  if exists (select 1 from jsonb_array_elements(public.owner_client_lifecycle_overview()->'first_month') e where e->>'client_id' = c3::text) then raise exception 'QA clients must be hidden'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
