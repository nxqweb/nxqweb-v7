-- Regression test for migration 278 (website Q&A assistant, no AI; was draft 11). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','assist-1@synthetic.invalid','',now(),'{}','{"business_name":"Assist One Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','assist-2@synthetic.invalid','',now(),'{}','{"business_name":"Assist Two Co","product_family_slug":"business","product_tier_key":"starter"}');

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
  u1 uuid := 'ffffffff-0000-0000-0000-0000000000a1';
  u2 uuid := 'ffffffff-0000-0000-0000-0000000000a2';
  c1 uuid; c2 uuid; p1 uuid; p2 uuid; f1 uuid; f2 uuid;
  key1 text; key2 text; key_paused text; f3 uuid;
  r jsonb; e1 uuid; e2 uuid; e_other uuid; i integer; q record; kept integer;
begin
  select id into c1 from public.clients where auth_user_id = u1;
  select id into c2 from public.clients where auth_user_id = u2;
  if c1 is null or c2 is null then raise exception 'client fixtures missing (test would be vacuous)'; end if;
  insert into public.projects(client_id, project_name) values (c1, 'Assist One site') returning id into p1;
  insert into public.projects(client_id, project_name) values (c2, 'Assist Two site') returning id into p2;
  insert into public.business_lead_forms(client_id, project_id, form_name, allowed_origins) values (c1, p1, 'Primary contact form', array['https://one.example.test']) returning id, form_key into f1, key1;
  insert into public.business_lead_forms(client_id, project_id, form_name, allowed_origins) values (c2, p2, 'Primary contact form', array['https://two.example.test']) returning id, form_key into f2, key2;
  insert into public.business_lead_forms(client_id, project_id, form_name, status) values (c1, p1, 'Old form', 'paused') returning id, form_key into f3, key_paused;

  -- tables and service functions are closed to every API role
  if has_table_privilege('authenticated', 'public.client_assistant_entries', 'select') or has_table_privilege('anon', 'public.client_assistant_settings', 'select')
     or has_table_privilege('authenticated', 'public.client_assistant_unanswered', 'insert') then raise exception 'assistant tables must have no API grants'; end if;
  if has_function_privilege('anon', 'public.get_my_assistant()', 'execute') then raise exception 'client functions must not be public'; end if;
  if has_function_privilege('authenticated', 'public.site_assistant_lookup(text)', 'execute') or has_function_privilege('anon', 'public.site_assistant_record_unanswered(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.nxq_assistant_client()', 'execute') then raise exception 'service-only and internal functions must not be callable by clients or visitors'; end if;
  if not has_function_privilege('service_role', 'public.site_assistant_lookup(text)', 'execute') then raise exception 'service role must be able to look up'; end if;

  -- signed out is refused
  perform pg_temp.as_user(null);
  if not pg_temp.fails('select public.get_my_assistant()', 'Client workspace not found') then raise exception 'signed-out must be refused'; end if;

  -- a fresh client: off, nothing in it
  perform pg_temp.as_user(u1);
  r := public.get_my_assistant();
  if (r #>> '{settings,enabled}')::boolean is not false or jsonb_array_length(r->'entries') <> 0 or jsonb_array_length(r->'unanswered') <> 0 then raise exception 'a fresh assistant must be off and empty'; end if;
  if not pg_temp.fails('select public.save_my_assistant_settings(true, null, null)', 'Add at least one answer') then raise exception 'cannot turn on with no answers'; end if;

  -- entries: validation
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'hi', '[]', 'Yes we are open'), 'question must be 3 to 160') then raise exception 'short question must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', repeat('q', 161), '[]', 'Yes'), 'question must be 3 to 160') then raise exception 'long question must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours?', '[]', ''), 'answer must be 2 to 600') then raise exception 'empty answer must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours?', '[]', repeat('a', 601)), 'answer must be 2 to 600') then raise exception 'long answer must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours?', '[]', '<b>9 to 5</b>'), 'plain text') then raise exception 'HTML in an answer must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours?', '[]', 'See https://example.com now'), 'web links') then raise exception 'links in an answer must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours?', '[]', 'see www.example.com'), 'web links') then raise exception 'www links in an answer must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours' || chr(7), '[]', 'Nine to five'), 'plain text') then raise exception 'control characters must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours?', '["a1","b2","c3","d4","e5","f6"]', 'Nine to five'), 'at most 5') then raise exception 'six other wordings must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours?', '{"a":1}', 'Nine to five'), 'must be a list') then raise exception 'non-list wordings must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'Hours?', '[5]', 'Nine to five'), 'plain text, 160') then raise exception 'non-text wordings must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, null)', 'Hours?', '[]', 'Nine to five'), 'Choose on or off') then raise exception 'null on/off must be refused'; end if;

  -- entries: save, trim, wordings
  r := public.save_my_assistant_entry(null, '  What are your hours?  ', '[" When are you open "," ","What time do you close"]'::jsonb, '  Monday to Friday, 8 to 5.  ', true);
  e1 := (r->>'id')::uuid;
  if (select question from public.client_assistant_entries where id = e1) <> 'What are your hours?' or (select answer from public.client_assistant_entries where id = e1) <> 'Monday to Friday, 8 to 5.' then raise exception 'text must be trimmed'; end if;
  if (select alt_phrasings from public.client_assistant_entries where id = e1) <> '["When are you open","What time do you close"]'::jsonb then raise exception 'wordings must be trimmed and blanks dropped'; end if;
  e2 := (public.save_my_assistant_entry(null, 'Do you remove stumps?', '[]'::jsonb, 'Yes, stump grinding is one of our services.', true)->>'id')::uuid;
  if (select sort_order from public.client_assistant_entries where id = e2) <= (select sort_order from public.client_assistant_entries where id = e1) then raise exception 'new answers go to the end'; end if;

  -- another client's answer can never be edited or removed, and their data never shows up
  perform pg_temp.as_user(u2);
  e_other := (public.save_my_assistant_entry(null, 'Do you deliver?', '[]'::jsonb, 'Yes, within 20 miles.', true)->>'id')::uuid;
  if jsonb_array_length(public.get_my_assistant()->'entries') <> 1 then raise exception 'a client must see only their own answers'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(%L, %L, %L::jsonb, %L, true)', e1, 'Hijack?', '[]', 'Hijacked'), 'Answer not found') then raise exception 'cannot edit another client answer'; end if;
  if not pg_temp.fails(format('select public.delete_my_assistant_entry(%L)', e1), 'Answer not found') then raise exception 'cannot delete another client answer'; end if;
  perform pg_temp.as_user(u1);
  if (select answer from public.client_assistant_entries where id = e1) <> 'Monday to Friday, 8 to 5.' then raise exception 'the other client must not have changed it'; end if;

  -- settings: validation, on/off, defaults
  if not pg_temp.fails(format('select public.save_my_assistant_settings(true, %L, null)', repeat('g', 201)), 'greeting must be plain text') then raise exception 'long greeting must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_settings(true, null, %L)', repeat('f', 301)), '"not sure" message') then raise exception 'long fallback must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_assistant_settings(true, %L, null)', 'Visit https://example.com'), 'web links') then raise exception 'links in the greeting must be refused'; end if;
  if not pg_temp.fails('select public.save_my_assistant_settings(null, null, null)', 'Choose on or off') then raise exception 'null on/off must be refused'; end if;

  -- the public lookup gives nothing while it is off
  perform pg_temp.as_user(null);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if public.site_assistant_lookup(key1) is not null then raise exception 'lookup must give nothing while the assistant is off'; end if;
  if public.site_assistant_record_unanswered(key1, 'what about parking') is not false then raise exception 'nothing may be recorded while the assistant is off'; end if;

  perform pg_temp.as_user(u1);
  perform public.save_my_assistant_settings(true, null, null);
  perform pg_temp.as_user(null);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  r := public.site_assistant_lookup(key1);
  if r is null or jsonb_array_length(r->'entries') <> 2 then raise exception 'lookup must return both answers once on'; end if;
  if r->>'greeting' is null or r->>'fallback_text' is null then raise exception 'defaults must fill the greeting and the not-sure message'; end if;
  if r ? 'contact_email' or r::text ilike '%assist-1@synthetic.invalid%' or (r->'entries'->0) ? 'client_id' then raise exception 'lookup must not leak contact details or ids per entry'; end if;
  if (r->>'client_id')::uuid <> c1 then raise exception 'lookup must be for the right client'; end if;
  if public.site_assistant_lookup(key2) is not null then raise exception 'a client who has not turned it on has no public assistant'; end if;
  if public.site_assistant_lookup(key_paused) is not null then raise exception 'a paused form has no public assistant'; end if;
  if public.site_assistant_lookup('FORM-does-not-exist') is not null or public.site_assistant_lookup(null) is not null then raise exception 'unknown keys give nothing'; end if;
  if r::text ilike '%Do you deliver%' then raise exception 'lookup must never return another client answers'; end if;

  -- a disabled answer is not public, and removing the last enabled answer switches the assistant off
  perform pg_temp.as_user(u1);
  perform public.save_my_assistant_entry(e2, 'Do you remove stumps?', '[]'::jsonb, 'Yes, stump grinding is one of our services.', false);
  perform pg_temp.as_user(null);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if jsonb_array_length(public.site_assistant_lookup(key1)->'entries') <> 1 then raise exception 'a disabled answer must not be public'; end if;
  perform pg_temp.as_user(u1);
  perform public.save_my_assistant_entry(e1, 'What are your hours?', '[]'::jsonb, 'Monday to Friday, 8 to 5.', false);
  if (public.get_my_assistant() #>> '{settings,enabled}')::boolean is not false then raise exception 'with no enabled answer the assistant must switch itself off'; end if;
  perform public.save_my_assistant_entry(e1, 'What are your hours?', '[]'::jsonb, 'Monday to Friday, 8 to 5.', true);
  perform public.save_my_assistant_settings(true, 'Hello there', 'Please call us.');
  perform pg_temp.as_user(null);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  r := public.site_assistant_lookup(key1);
  if r->>'greeting' <> 'Hello there' or r->>'fallback_text' <> 'Please call us.' then raise exception 'custom greeting and not-sure message must be used'; end if;

  -- unanswered questions: counted, deduplicated, and never personal details
  if public.site_assistant_record_unanswered(key1, '  What about   PARKING? ') is not true then raise exception 'a normal question must be recorded'; end if;
  perform public.site_assistant_record_unanswered(key1, 'what about parking?');
  if (select times_asked from public.client_assistant_unanswered where client_id = c1 and question = 'what about parking?') <> 2 then raise exception 'the same wording must be counted, not duplicated'; end if;
  if public.site_assistant_record_unanswered(key1, 'email me at jane@example.com') is not false then raise exception 'an email address must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'write to jane@example') is not false then raise exception 'an email address without a dot must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'call 555-123-4567 please') is not false then raise exception 'a phone number must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'call 555 - 123 - 4567') is not false then raise exception 'a phone number with wide separators must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'call 555 / 123 / 4567') is not false then raise exception 'a phone number with slashes must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'my number is 5 5 5 1 2 3 4 5 6 7') is not false then raise exception 'a phone number with spaces must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'see http://evil.example for details') is not false then raise exception 'a web link must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'see www.evil.example') is not false then raise exception 'a www link must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'go to evil.com/pay now') is not false then raise exception 'a bare web address must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'use bit.ly/abc') is not false then raise exception 'a short link must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'hxxp://evil.example') is not false then raise exception 'an obfuscated link must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'mailto: jane') is not false then raise exception 'a mailto link must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'a //evil.example link') is not false then raise exception 'a double-slash link must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, '<script>x</script>') is not false then raise exception 'markup must not be stored'; end if;
  if public.site_assistant_record_unanswered(key1, 'hi') is not false or public.site_assistant_record_unanswered(key1, repeat('x', 201)) is not false or public.site_assistant_record_unanswered(key1, null) is not false then raise exception 'too short, too long and empty must not be stored'; end if;
  if public.site_assistant_record_unanswered(key_paused, 'what about parking') is not false or public.site_assistant_record_unanswered('FORM-nope', 'what about parking') is not false then raise exception 'unknown or paused forms record nothing'; end if;
  if public.site_assistant_record_unanswered(key1, 'do you work in 2026') is not true then raise exception 'ordinary numbers (years) must still be stored'; end if;
  if exists (select 1 from public.client_assistant_unanswered where question ~ '@|[0-9]{7}|http|www|<|evil|bit\.ly|mailto') then raise exception 'no personal details or links may be stored'; end if;

  -- the list is capped at 100 wordings per client; when full, the least-asked go first so one-off junk cannot push out questions visitors keep asking
  for i in 1..120 loop perform public.site_assistant_record_unanswered(key1, 'question number ' || lpad(i::text, 3, 'a')); end loop;
  select count(*) into kept from public.client_assistant_unanswered where client_id = c1;
  if kept <> 100 then raise exception 'at most 100 wordings per client must be kept, found %', kept; end if;
  if not exists (select 1 from public.client_assistant_unanswered where client_id = c1 and question = 'what about parking?') then raise exception 'a question asked twice must survive a flood of one-off questions'; end if;
  if not exists (select 1 from public.client_assistant_unanswered where client_id = c1 and question = 'question number 120') then raise exception 'the most recent one-off question must be kept'; end if;
  if exists (select 1 from public.client_assistant_unanswered where client_id = c1 and question = 'question number aa1') then raise exception 'the oldest one-off questions must be the ones dropped'; end if;
  if (select count(*) from public.client_assistant_unanswered where client_id = c2) <> 0 then raise exception 'another client must not receive these questions'; end if;

  -- the client sees them and can dismiss them; never another client's
  perform pg_temp.as_user(u1);
  r := public.get_my_assistant();
  if jsonb_array_length(r->'unanswered') <> 100 then raise exception 'the client must see the unanswered list'; end if;
  select id, question into q from public.client_assistant_unanswered where client_id = c1 order by times_asked desc limit 1;
  perform pg_temp.as_user(u2);
  if (public.dismiss_my_assistant_question(q.id)->>'removed')::boolean is not false then raise exception 'another client cannot dismiss it'; end if;
  perform pg_temp.as_user(u1);
  if (public.dismiss_my_assistant_question(q.id)->>'removed')::boolean is not true then raise exception 'the owner can dismiss it'; end if;

  -- answers cap: 50 per client
  perform pg_temp.as_user(u2);
  for i in 2..50 loop perform public.save_my_assistant_entry(null, 'Question number ' || i, '[]'::jsonb, 'Answer number ' || i, true); end loop;
  if not pg_temp.fails(format('select public.save_my_assistant_entry(null, %L, %L::jsonb, %L, true)', 'One too many', '[]', 'Nope'), 'up to 50 answers') then raise exception 'answer cap must hold'; end if;

  -- deleting removes it; deleting the last enabled answer switches the assistant off
  perform pg_temp.as_user(u1);
  perform public.delete_my_assistant_entry(e2);
  if exists (select 1 from public.client_assistant_entries where id = e2) then raise exception 'answer must be removed'; end if;
  perform public.delete_my_assistant_entry(e1);
  if (public.get_my_assistant() #>> '{settings,enabled}')::boolean is not false then raise exception 'deleting every answer must switch the assistant off'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
