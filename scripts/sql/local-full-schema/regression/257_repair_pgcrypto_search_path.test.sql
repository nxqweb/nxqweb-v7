-- Sidecar test. Runs inside a transaction that is rolled back. Simulates the Supabase layout
-- (pgcrypto only in the "extensions" schema) and proves the repair is needed and sufficient.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

-- 1. The repair sets the pinned path on all seven functions.
do $$ declare missing text; begin
  select string_agg(fn, ', ') into missing from unnest(array[
    'nxq_flag_referral_payment_reversal','nxq_queue_sales_delivery','nxq_record_sales_delivery_event',
    'nxq_reserve_sales_delivery','owner_create_fictional_sales_source_run','owner_record_sales_reply',
    'submit_public_commerce_customer_request']) fn
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn and p.proconfig::text like '%search_path=public, extensions%');
  if missing is not null then raise exception 'not repaired: %', missing; end if;
end $$;

-- 2. Move pgcrypto to the extensions schema only (harness stand-ins first removed) like Supabase.
drop function if exists extensions.digest(text, text);
drop function if exists extensions.digest(bytea, text);
alter extension pgcrypto set schema extensions;

-- 3. Fixture: a prospect, an approved draft and a delivery job.
insert into public.nxq_sales_prospects(business_name, contact_email, state_region, email_validation_status)
  values ('Fixture Roofing', 'owner@fixture-roofing.invalid', 'TX', 'valid');
insert into public.nxq_sales_outreach_drafts(prospect_id, channel, sequence_step, subject, body, status)
  select id, 'email', 1, 'A website idea', 'Hello there, this is a fixture draft body.', 'approved' from public.nxq_sales_prospects;
insert into public.nxq_sales_delivery_jobs(draft_id, prospect_id, idempotency_key, scheduled_for, status)
  select d.id, d.prospect_id, 'fixture-key-1', now(), 'sending' from public.nxq_sales_outreach_drafts d;

-- 4. Negative control: with the ORIGINAL search_path the function fails on a hard bounce (digest not found).
alter function public.nxq_record_sales_delivery_event(uuid, text, text, text) set search_path = public;
do $$ declare j uuid; ok boolean := false; begin
  select id into j from public.nxq_sales_delivery_jobs limit 1;
  begin perform public.nxq_record_sales_delivery_event(j, 'hard_bounce', 'msg1', null);
  exception when undefined_function then ok := true; end;
  if not ok then raise exception 'negative control failed: original search_path unexpectedly worked'; end if;
end $$;

-- 5. With the repaired search_path the same call succeeds and writes a permanent suppression.
alter function public.nxq_record_sales_delivery_event(uuid, text, text, text) set search_path = public, extensions;
do $$ declare j uuid; r jsonb; begin
  select id into j from public.nxq_sales_delivery_jobs limit 1;
  r := public.nxq_record_sales_delivery_event(j, 'hard_bounce', 'msg1', null);
  if (r->>'suppressed') <> 'true' then raise exception 'repaired call did not suppress: %', r; end if;
  if not exists (select 1 from public.nxq_sales_suppressions where scope = 'email' and permanent and reason = 'hard_bounce') then
    raise exception 'suppression row missing'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
