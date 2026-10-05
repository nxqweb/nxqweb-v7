-- Sidecar test for 02. Runs in a rolled-back transaction with pgcrypto only in the extensions schema.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
drop function if exists extensions.digest(text, text);
drop function if exists extensions.digest(bytea, text);
alter extension pgcrypto set schema extensions;

insert into public.nxq_sales_prospects(business_name, contact_email, state_region, email_validation_status, status)
  values ('Fixture Roofing', 'Owner@Fixture-Roofing.invalid', 'TX', 'valid', 'contacted'),
         ('Other Co', 'info@other-co.invalid', 'TX', 'valid', 'contacted');
insert into public.nxq_sales_contact_permissions(prospect_id, channel, status, basis)
  select id, 'email', 'allowed', 'public_business_email' from public.nxq_sales_prospects;
insert into public.nxq_sales_outreach_drafts(prospect_id, channel, sequence_step, subject, body, status)
  select id, 'email', 1, 'A website idea', 'Hello there, this is a fixture draft body.', 'approved' from public.nxq_sales_prospects;
insert into public.nxq_sales_delivery_jobs(draft_id, prospect_id, idempotency_key, scheduled_for, status)
  select d.id, d.prospect_id, 'fixture-' || d.prospect_id, now(), 'queued' from public.nxq_sales_outreach_drafts d;

do $$ declare a uuid; b uuid; r jsonb; n int; begin
  select id into a from public.nxq_sales_prospects where business_name = 'Fixture Roofing';
  select id into b from public.nxq_sales_prospects where business_name = 'Other Co';

  -- privileges: only service_role may execute either function
  if has_function_privilege('anon', 'public.nxq_sales_register_opt_out(uuid,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.nxq_sales_register_opt_out(uuid,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.nxq_sales_record_inbound_reply(text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nxq_sales_record_inbound_reply(text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.nxq_sales_register_opt_out(uuid,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.nxq_sales_record_inbound_reply(text,text,text,text)', 'execute')
  then raise exception 'unexpected execute privileges'; end if;

  -- unsubscribe reply with different letter case and padding
  r := public.nxq_sales_record_inbound_reply('evt-1', '  OWNER@fixture-roofing.INVALID ', 'Please unsubscribe me', 'unsubscribe');
  if r->>'matched' <> 'true' or r->>'suppressed' <> 'true' then raise exception 'unsubscribe not applied: %', r; end if;
  if (select status from public.nxq_sales_prospects where id = a) <> 'do_not_contact' then raise exception 'prospect not do_not_contact'; end if;
  if exists (select 1 from public.nxq_sales_contact_permissions where prospect_id = a and status <> 'revoked') then raise exception 'permission not revoked'; end if;
  if not exists (select 1 from public.nxq_sales_suppressions where prospect_id = a and scope = 'email' and reason = 'opt_out' and permanent) then raise exception 'no suppression'; end if;
  if (select status from public.nxq_sales_delivery_jobs where prospect_id = a) <> 'cancelled' then raise exception 'job not cancelled'; end if;
  if (select status from public.nxq_sales_outreach_drafts where prospect_id = a) <> 'cancelled' then raise exception 'draft not cancelled'; end if;
  if not exists (select 1 from public.nxq_sales_outreach_events where prospect_id = a and event_type = 'opt_out_recorded') then raise exception 'no event'; end if;
  if (select classification from public.nxq_sales_reply_events where provider_event_id = 'evt-1') <> 'unsubscribe' then raise exception 'wrong classification'; end if;

  -- the other prospect is untouched
  if (select status from public.nxq_sales_prospects where id = b) <> 'contacted' or (select status from public.nxq_sales_delivery_jobs where prospect_id = b) <> 'queued'
  then raise exception 'unrelated prospect was changed'; end if;

  -- duplicate provider event is a no-op
  r := public.nxq_sales_record_inbound_reply('evt-1', 'owner@fixture-roofing.invalid', 'Please unsubscribe me', 'unsubscribe');
  select count(*) into n from public.nxq_sales_reply_events where provider_event_id = 'evt-1';
  if r->>'duplicate' <> 'true' or n <> 1 then raise exception 'duplicate not idempotent: %', r; end if;

  -- opt-out function itself is idempotent
  perform public.nxq_sales_register_opt_out(a, 'opt_out', '{}'::jsonb);
  select count(*) into n from public.nxq_sales_suppressions where prospect_id = a;
  if n <> 1 then raise exception 'duplicate suppression rows'; end if;

  -- auto reply and ordinary reply
  r := public.nxq_sales_record_inbound_reply('evt-2', 'info@other-co.invalid', 'I am out of office', 'auto_reply');
  if (select classification from public.nxq_sales_reply_events where provider_event_id = 'evt-2') <> 'out_of_office'
     or (select status from public.nxq_sales_prospects where id = b) <> 'contacted' then raise exception 'auto reply mishandled'; end if;
  r := public.nxq_sales_record_inbound_reply('evt-3', 'info@other-co.invalid', 'Sounds interesting, send the plan', 'other');
  if (select classification from public.nxq_sales_reply_events where provider_event_id = 'evt-3') <> 'unknown'
     or not (select requires_owner_review from public.nxq_sales_reply_events where provider_event_id = 'evt-3')
     or (select status from public.nxq_sales_prospects where id = b) <> 'replied' then raise exception 'ordinary reply mishandled'; end if;

  -- complaint suppresses with reason complaint
  r := public.nxq_sales_record_inbound_reply('evt-4', 'info@other-co.invalid', 'This is spam', 'complaint');
  if not exists (select 1 from public.nxq_sales_suppressions where prospect_id = b and reason = 'complaint') then raise exception 'complaint not suppressed'; end if;

  -- unknown sender and blank sender reveal nothing
  r := public.nxq_sales_record_inbound_reply('evt-5', 'nobody@nowhere.invalid', 'hi', 'other');
  if r->>'matched' <> 'false' then raise exception 'unknown sender matched'; end if;
  r := public.nxq_sales_record_inbound_reply('evt-6', '   ', 'hi', 'other');
  if r->>'matched' <> 'false' then raise exception 'blank sender matched'; end if;
  r := public.nxq_sales_register_opt_out(gen_random_uuid(), 'opt_out', '{}'::jsonb);
  if r->>'matched' <> 'false' then raise exception 'unknown prospect matched'; end if;
  if exists (select 1 from public.nxq_sales_reply_events where provider_event_id in ('evt-5', 'evt-6')) then raise exception 'rows stored for unknown senders'; end if;

  -- bad input
  begin perform public.nxq_sales_register_opt_out(a, 'bogus', '{}'::jsonb); raise exception 'bad reason accepted';
  exception when raise_exception then if sqlerrm = 'bad reason accepted' then raise; end if; end;
  begin perform public.nxq_sales_record_inbound_reply('evt-7', 'x@y.invalid', 't', 'bogus'); raise exception 'bad intent accepted';
  exception when raise_exception then if sqlerrm = 'bad intent accepted' then raise; end if; end;
end $$;

-- non-service roles are refused even if they could reach the function
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$ begin
  begin perform public.nxq_sales_register_opt_out(gen_random_uuid(), 'opt_out', '{}'::jsonb); raise exception 'non-service call accepted';
  exception when raise_exception then if sqlerrm = 'non-service call accepted' then raise; end if; end;
end $$;

select 'DRAFT_TEST_OK';
rollback;
