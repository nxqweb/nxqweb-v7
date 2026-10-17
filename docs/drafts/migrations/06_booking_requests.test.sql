-- Regression test for draft 06 (Booking v1 request-only). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('eeeeeeee-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','book-one@synthetic.invalid','',now(),'{}','{"business_name":"Book Salon One","product_family_slug":"business"}'),
 ('eeeeeeee-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','book-two@synthetic.invalid','',now(),'{}','{"business_name":"Book Salon Two","product_family_slug":"business"}'),
 ('eeeeeeee-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','book-three@synthetic.invalid','',now(),'{}','{"business_name":"Book No Project Three","product_family_slug":"business"}');

-- projects for clients one and two only (three has no website project yet)
insert into public.projects(client_id, project_name)
select c.id, 'Booking test site' from public.clients c where c.auth_user_id in ('eeeeeeee-0000-0000-0000-0000000000c1','eeeeeeee-0000-0000-0000-0000000000c2');

update public.clients set status = 'approved' where auth_user_id in ('eeeeeeee-0000-0000-0000-0000000000c1','eeeeeeee-0000-0000-0000-0000000000c2');

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
  o1 uuid := 'eeeeeeee-0000-0000-0000-0000000000c1';
  o2 uuid := 'eeeeeeee-0000-0000-0000-0000000000c2';
  o3 uuid := 'eeeeeeee-0000-0000-0000-0000000000c3';
  r jsonb;
  req jsonb;
  d date;
  monday_10 timestamptz;
  tz text := 'America/Los_Angeles';
  i integer;
  n integer;
  req_id uuid;
  ws uuid;
  key text;
begin
  -- fixtures must exist, or every later check would be vacuous
  if (select count(*) from public.clients where auth_user_id in (o1,o2,o3)) is distinct from 3 then raise exception 'client fixtures missing'; end if;
  if (select count(*) from public.projects p join public.clients c on c.id = p.client_id where c.auth_user_id in (o1,o2)) is distinct from 2 then raise exception 'project fixtures missing'; end if;

  -- a Monday at least a week away, 10:00 local in the business's time zone
  d := (now() at time zone tz)::date + 7;
  while extract(dow from d) <> 1 loop d := d + 1; end loop;
  monday_10 := (d + time '10:00') at time zone tz;

  -- ---- privileges
  if has_function_privilege('anon', 'public.get_my_booking_setup()', 'execute') or has_function_privilege('anon', 'public.save_my_booking_hours(jsonb)', 'execute') or has_function_privilege('anon', 'public.list_my_booking_requests(text,integer)', 'execute') or has_function_privilege('anon', 'public.update_my_booking_request(uuid,text,text)', 'execute') or has_function_privilege('anon', 'public.delete_my_booking_request(uuid)', 'execute') or has_function_privilege('anon', 'public.set_my_booking_public(boolean)', 'execute') then raise exception 'anon must not call owner functions'; end if;
  if has_function_privilege('anon', 'public.nxq_my_booking_workspace()', 'execute') or has_function_privilege('authenticated', 'public.nxq_my_booking_workspace()', 'execute') or has_function_privilege('authenticated', 'public.nxq_booking_setup_json(uuid)', 'execute') then raise exception 'internal helpers must not be callable by clients'; end if;
  if not has_function_privilege('anon', 'public.get_public_booking_page(text)', 'execute') or not has_function_privilege('anon', 'public.submit_public_booking_request(text,text,timestamptz,text,text,text,text,text,text)', 'execute') then raise exception 'the two public functions must be callable by anon'; end if;
  if has_table_privilege('anon', 'public.booking_appointment_requests', 'select') or has_table_privilege('anon', 'public.booking_appointment_requests', 'insert') then raise exception 'anon must have no direct table access'; end if;

  -- ---- signed out
  perform pg_temp.as_user(null);
  if not pg_temp.fails($q$select public.get_my_booking_setup()$q$, 'Client workspace not found') then raise exception 'signed-out setup read must be refused'; end if;
  if not pg_temp.fails($q$select public.ensure_my_booking_workspace()$q$, 'Client workspace not found') then raise exception 'signed-out ensure must be refused'; end if;

  -- ---- a client with no website project cannot start
  perform pg_temp.as_user(o3);
  if not pg_temp.fails($q$select public.ensure_my_booking_workspace()$q$, 'website project is not set up yet') then raise exception 'no-project client must be refused'; end if;

  -- ---- client one: setup
  perform pg_temp.as_user(o1);
  r := public.get_my_booking_setup();
  if (r->>'has_workspace')::boolean is not false then raise exception 'fresh client must have no workspace: %', r; end if;
  if not pg_temp.fails($q$select public.ensure_my_booking_workspace('Not/AZone')$q$, 'valid time zone') then raise exception 'bad time zone must be refused'; end if;
  r := public.ensure_my_booking_workspace('America/Los_Angeles');
  if r->>'status' <> 'setup' or (r->>'public_enabled')::boolean is not false or r->>'timezone' <> tz then raise exception 'new workspace wrong: %', r; end if;
  ws := (select w.id from public.booking_workspaces w join public.clients c on c.id = w.client_id where c.auth_user_id = o1);
  if (select launch_enabled from public.booking_workspaces where id = ws) then raise exception 'launch_enabled must stay false'; end if;
  perform public.ensure_my_booking_workspace('America/Chicago');
  if (select count(*) from public.booking_workspaces w join public.clients c on c.id = w.client_id where c.auth_user_id = o1) <> 1 or (select timezone from public.booking_workspaces where id = ws) <> tz then raise exception 'ensure must be idempotent and not change an existing workspace'; end if;

  -- the page cannot go public until everything is in place, and the message names the missing piece
  if not pg_temp.fails($q$select public.set_my_booking_public(true)$q$, 'Choose a page address first') then raise exception 'needs slug'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_settings(public_slug_value => 'Bad Slug!')$q$, 'page address must be') then raise exception 'bad slug refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_settings(public_slug_value => 'admin')$q$, 'reserved') then raise exception 'reserved slug refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_settings(display_name_value => 'Bad <b>')$q$, 'page name') then raise exception 'markup in name refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_settings(intro_value => repeat('x', 601))$q$, 'intro must be') then raise exception 'long intro refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_settings(timezone_value => 'Nope/Zone')$q$, 'valid time zone') then raise exception 'bad tz refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_settings(minimum_lead_minutes_value => -1)$q$, 'notice time') then raise exception 'bad lead refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_settings(maximum_advance_days_value => 0)$q$, 'ahead') then raise exception 'bad advance refused'; end if;
  r := public.save_my_booking_settings('  Book   Salon One ', 'Hair and nails, by request.', null, 120, 90, 'Please tell us 24 hours ahead.', 'salon-one');
  if r->>'display_name' <> 'Book Salon One' or r->>'public_slug' <> 'salon-one' then raise exception 'settings not saved/tidied: %', r; end if;
  if not pg_temp.fails($q$select public.set_my_booking_public(true)$q$, 'Add at least one service') then raise exception 'needs service'; end if;

  if not pg_temp.fails($q$select public.save_my_booking_service('Bad Key', 'Haircut', 60)$q$, 'service code') then raise exception 'bad service key refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_service('cut', 'x', 60)$q$, 'service name') then raise exception 'short service name refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_service('cut', 'Haircut', 2)$q$, 'between 5 minutes') then raise exception 'tiny duration refused'; end if;
  perform public.save_my_booking_service('cut', 'Haircut', 60);
  r := public.save_my_booking_service('color', 'Hair color', 120);
  if jsonb_array_length(r->'services') <> 2 then raise exception 'two services expected: %', r; end if;
  r := public.save_my_booking_service('cut', 'Haircut (short)', 45, true);
  if jsonb_array_length(r->'services') <> 2 or r->'services'->0->>'name' <> 'Haircut (short)' or (r->'services'->0->>'duration_minutes')::integer <> 45 then raise exception 'service update should replace, not duplicate: %', r; end if;
  perform public.save_my_booking_service('cut', 'Haircut', 60);
  if not pg_temp.fails($q$select public.set_my_booking_public(true)$q$, 'opening hours first') then raise exception 'needs hours'; end if;

  -- hours: bad input changes nothing
  if not pg_temp.fails($q$select public.save_my_booking_hours('{"a":1}'::jsonb)$q$, 'must be a list') then raise exception 'non-list refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_hours('[{"weekday":9,"start":"09:00","end":"17:00"}]'::jsonb)$q$, 'from 0 (Sunday) to 6') then raise exception 'bad weekday refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_hours('[{"weekday":1,"start":"17:00","end":"09:00"}]'::jsonb)$q$, 'end after it starts') then raise exception 'backwards hours refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_hours('[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"11:00","end":"15:00"}]'::jsonb)$q$, 'cannot overlap') then raise exception 'overlap refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_hours('[{"weekday":1,"start":"nope","end":"12:00"}]'::jsonb)$q$, 'day, a start and an end') then raise exception 'junk time refused'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_hours('[{"weekday":1,"start":"09:07","end":"17:00"}]'::jsonb)$q$, '5-minute mark') then raise exception 'opening times off the 5-minute grid must be refused (visitors could never book them)'; end if;
  if not pg_temp.fails(format('select public.save_my_booking_settings(intro_value => %L)', 'hello' || chr(7) || 'bell'), 'intro must be') then raise exception 'control characters in the intro must be refused'; end if;
  if (select count(*) from public.booking_availability_rules where workspace_id = ws) <> 0 then raise exception 'a refused hours save must change nothing'; end if;
  r := public.save_my_booking_hours('[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"13:00","end":"17:00"},{"weekday":2,"start":"09:00","end":"17:00"},{"weekday":3,"start":"09:00","end":"17:00"},{"weekday":4,"start":"09:00","end":"17:00"},{"weekday":5,"start":"09:00","end":"17:00"}]'::jsonb);
  if jsonb_array_length(r->'hours') <> 6 then raise exception 'six periods expected: %', r; end if;
  r := public.save_my_booking_hours('[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":2,"start":"09:00","end":"17:00"}]'::jsonb);
  if jsonb_array_length(r->'hours') <> 2 then raise exception 'save must replace the schedule, not add to it: %', r; end if;
  perform public.save_my_booking_hours('[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":2,"start":"09:00","end":"17:00"},{"weekday":3,"start":"09:00","end":"17:00"},{"weekday":4,"start":"09:00","end":"17:00"},{"weekday":5,"start":"09:00","end":"17:00"}]'::jsonb);

  -- before going public the page is invisible
  perform pg_temp.as_user(null);
  if public.get_public_booking_page('salon-one') is not null then raise exception 'a page that is not on must be invisible'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10, 'Pat Visitor', 'pat@example.com', 'key-not-open-1-xxxxxxxxxxxxxxxx'), 'not open right now') then raise exception 'a page that is not on must refuse requests'; end if;

  perform pg_temp.as_user(o1);
  r := public.set_my_booking_public(true);
  if (r->>'public_enabled')::boolean is not true or r->>'status' <> 'ready' then raise exception 'page should be on: %', r; end if;
  if (select launch_enabled from public.booking_workspaces where id = ws) then raise exception 'launch_enabled must still be false'; end if;

  -- ---- the public page
  perform pg_temp.as_user(null);
  r := public.get_public_booking_page('  SALON-ONE ');
  if r->>'display_name' <> 'Book Salon One' or jsonb_array_length(r->'services') <> 2 or jsonb_array_length(r->'hours') <> 5 then raise exception 'public page wrong: %', r; end if;
  if r::text ~* '(email|phone|client_id|project_id|workspace|"id")' then raise exception 'public page must not expose private fields: %', r; end if;
  if public.get_public_booking_page('nope-nope') is not null then raise exception 'unknown page must be null'; end if;

  -- ---- public requests: the happy path
  req := public.submit_public_booking_request('salon-one', 'cut', monday_10, '  Pat   Visitor ', 'Pat@Example.com', null, 'First visit.', 'key-happy-0001-xxxxxxxxxxxxxxxx', null);
  if (req->>'ok')::boolean is not true or req->>'request_code' !~ '^BOOK-[A-F0-9]{12}$' or req->>'status' <> 'requested' then raise exception 'happy path wrong: %', req; end if;
  if (select count(*) from public.booking_appointment_requests where workspace_id = ws) <> 1 then raise exception 'exactly one request expected'; end if;
  if (select contact_name || '|' || contact_email || '|' || timezone from public.booking_appointment_requests where workspace_id = ws) <> 'Pat Visitor|pat@example.com|America/Los_Angeles' then raise exception 'values must be tidied and the time zone copied from the business'; end if;
  if (select requested_end_at - requested_start_at from public.booking_appointment_requests where workspace_id = ws) <> interval '60 minutes' then raise exception 'end must be start plus the service length'; end if;

  -- the same key never makes a second request
  r := public.submit_public_booking_request('salon-one', 'cut', monday_10, 'Pat Visitor', 'pat@example.com', null, 'First visit.', 'key-happy-0001-xxxxxxxxxxxxxxxx', null);
  if r->>'request_code' <> req->>'request_code' or (select count(*) from public.booking_appointment_requests where workspace_id = ws) <> 1 then raise exception 'idempotency failed'; end if;

  -- a bot (hidden field filled) gets a fake success and nothing is stored
  r := public.submit_public_booking_request('salon-one', 'cut', monday_10, 'Bot Name', 'bot@example.com', null, null, 'key-bot-00001-xxxxxxxxxxxxxxxx', 'http://spam.example');
  if (r->>'ok')::boolean is not true or (select count(*) from public.booking_appointment_requests where workspace_id = ws) <> 1 then raise exception 'honeypot must store nothing'; end if;

  -- ---- public requests: everything that must be refused
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,null,null,null,%L)', 'salon-one', 'cut', monday_10, 'No Contact', 'key-nocontact-1-xxxxxxxxxxxxxxxx'), 'email or a phone') then raise exception 'no contact refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10, 'Bad Email', 'not-an-email', 'key-bademail-1-xxxxxxxxxxxxxxxx'), 'valid email') then raise exception 'bad email refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,null,%L,null,%L)', 'salon-one', 'cut', monday_10, 'Bad Phone', '12', 'key-badphone-1-xxxxxxxxxxxxxxxx'), 'valid phone') then raise exception 'bad phone refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10, 'x', 'a@example.com', 'key-shortname-1-xxxxxxxxxxxxxxxx'), 'your name') then raise exception 'short name refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10, 'Evil <script>', 'a@example.com', 'key-markup-001-xxxxxxxxxxxxxxxx'), 'your name') then raise exception 'markup in name refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,%L,%L)', 'salon-one', 'cut', monday_10, 'Pat', 'a@example.com', 'hi <b>there</b>', 'key-markup-002-xxxxxxxxxxxxxxxx'), 'no < or >') then raise exception 'markup in note refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,%L,%L)', 'salon-one', 'cut', monday_10, 'Pat', 'a@example.com', repeat('n', 1001), 'key-longnote-01-xxxxxxxxxxxxxxxx'), '1000 characters') then raise exception 'long note refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10, 'Pat', 'a@example.com', 'short'), 'reload the page') then raise exception 'short key refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'nope', monday_10, 'Pat', 'a@example.com', 'key-noservice-1-xxxxxxxxxxxxxxxx'), 'listed services') then raise exception 'unknown service refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', now() + interval '30 minutes', 'Pat', 'a@example.com', 'key-toosoon-001-xxxxxxxxxxxxxxxx'), 'too soon') then raise exception 'too soon refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', now() + interval '200 days', 'Pat', 'a@example.com', 'key-toofar-0001-xxxxxxxxxxxxxxxx'), 'too far ahead') then raise exception 'too far refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,null,%L,%L,null,null,%L)', 'salon-one', 'cut', 'Pat', 'a@example.com', 'key-notime-0001-xxxxxxxxxxxxxxxx'), 'choose a time') then raise exception 'null time refused'; end if;
  -- Saturday (closed), 5-minute mark, and a service that would run past closing
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '5 days', 'Pat', 'a@example.com', 'key-saturday-01-xxxxxxxxxxxxxxxx'), 'opening hours') then raise exception 'closed day refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '3 minutes', 'Pat', 'a@example.com', 'key-odd-minute-1-xxxxxxxxxxxxxxxx'), '5-minute mark') then raise exception 'odd minute refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '6 hours 30 minutes', 'Pat', 'a@example.com', 'key-too-late-001-xxxxxxxxxxxxxxxx'), 'opening hours') then raise exception 'running past closing refused (16:30 + 60 min)'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 - interval '2 hours', 'Pat', 'a@example.com', 'key-too-early-01-xxxxxxxxxxxxxxxx'), 'opening hours') then raise exception 'before opening refused'; end if;
  -- exactly at closing time works (16:00 + 60 min = 17:00)
  r := public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '6 hours', 'Late Pat', null, '(555) 010-2000', null, 'key-edge-fit-001-xxxxxxxxxxxxxxxx', null);
  if (r->>'ok')::boolean is not true then raise exception 'a request ending exactly at closing must be accepted: %', r; end if;

  -- an inactive service cannot be requested
  perform pg_temp.as_user(o1);
  perform public.save_my_booking_service('color', 'Hair color', 120, false);
  perform pg_temp.as_user(null);
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'color', monday_10, 'Pat', 'a@example.com', 'key-inactive-01-xxxxxxxxxxxxxxxx'), 'listed services') then raise exception 'inactive service refused'; end if;
  if jsonb_array_length(public.get_public_booking_page('salon-one')->'services') <> 1 then raise exception 'inactive service must be hidden from the public page'; end if;

  -- per-email cap: three open requests a day, the fourth is refused
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '1 day', 'Cap Test', 'cap@example.com', null, null, 'key-cap-000001-xxxxxxxxxxxxxxxx', null);
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '1 day 1 hour', 'Cap Test', 'cap@example.com', null, null, 'key-cap-000002-xxxxxxxxxxxxxxxx', null);
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '1 day 2 hours', 'Cap Test', 'cap@example.com', null, null, 'key-cap-000003-xxxxxxxxxxxxxxxx', null);
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '1 day 3 hours', 'Cap Test', 'cap@example.com', 'key-cap-000004-xxxxxxxxxxxxxxxx'), 'several open requests') then raise exception 'per-email cap refused'; end if;

  -- per-workspace hourly cap, tested at the exact edge: fill to 29 in the last hour, the 30th request is accepted, the 31st is refused
  perform set_config('request.jwt.claim.role', 'service_role', true);
  i := (select count(*) from public.booking_appointment_requests where workspace_id = ws and created_at > now() - interval '1 hour');
  if i >= 29 then raise exception 'test setup: already % recent requests', i; end if;
  insert into public.booking_appointment_requests (workspace_id, client_id, project_id, service_definition_id, idempotency_key, status, requested_start_at, requested_end_at, timezone, contact_name, contact_email)
  select ws, w.client_id, w.project_id, (select id from public.booking_service_definitions where workspace_id = ws and service_key = 'cut'), 'flood-key-' || g, 'requested', monday_10, monday_10 + interval '1 hour', tz, 'Flood ' || g, 'flood' || g || '@example.com'
  from public.booking_workspaces w, generate_series(1, 29 - i) g where w.id = ws;
  perform pg_temp.as_user(null);
  r := public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '2 days', 'Edge Thirty', 'edge30@example.com', null, null, 'key-edge-thirty-xxxxxxxxxxxxxxxx', null);
  if (r->>'ok')::boolean is not true then raise exception 'the 30th request in an hour must still be accepted: %', r; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '2 days 1 hour', 'Flood', 'late@example.com', 'key-flood-last-1-xxxxxxxxxxxxxxxx'), 'a lot of requests') then raise exception 'the 31st request in an hour must be refused'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  delete from public.booking_appointment_requests where idempotency_key like 'flood-key-%' or idempotency_key like 'key-edge-thirty-%';

  -- the daily email cap sees through plus-tags, dots and capital letters (Gmail-style), and counts every state
  perform pg_temp.as_user(null);
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '3 days', 'Dot Ted', 'dot.ted@gmail.com', null, null, 'key-gm-0000001-xxxxxxxxxxxxxxxx', null);
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '3 days 1 hour', 'Dot Ted', 'dotted+promo@gmail.com', null, null, 'key-gm-0000002-xxxxxxxxxxxxxxxx', null);
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '3 days 2 hours', 'Dot Ted', 'DOT.TED@GOOGLEMAIL.com', null, null, 'key-gm-0000003-xxxxxxxxxxxxxxxx', null);
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '3 days 3 hours', 'Dot Ted', 'd.o.t.t.e.d@gmail.com', 'key-gm-0000004-xxxxxxxxxxxxxxxx'), 'several open requests') then raise exception 'gmail variants must share one daily allowance'; end if;
  -- phone-only senders have a cap too, however the number is written
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '4 days', 'Phone Pat', null, '(555) 010-3000', null, 'key-ph-0000001-xxxxxxxxxxxxxxxx', null);
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '4 days 1 hour', 'Phone Pat', null, '555.010.3000', null, 'key-ph-0000002-xxxxxxxxxxxxxxxx', null);
  perform public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '4 days 2 hours', 'Phone Pat', null, '+1 555 010 3000', null, 'key-ph-0000003-xxxxxxxxxxxxxxxx', null);
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,null,%L,null,%L)', 'salon-one', 'cut', monday_10 + interval '4 days 3 hours', 'Phone Pat', '555-010-3000', 'key-ph-0000004-xxxxxxxxxxxxxxxx'), 'several open requests') then raise exception 'phone-only flooding must be capped'; end if;

  -- characters: control characters, zero-width characters, spreadsheet-formula names, bad emails and phones are refused; a new line in a note is fine
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,%L,%L)', 'salon-one', 'cut', monday_10 + interval '2 days 4 hours', 'Pat', 'a@example.com', 'bell' || chr(7) || 'char', 'key-ctl-0000001-xxxxxxxxxxxxxxxx'), 'no < or >') then raise exception 'control characters in a note must be refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,%L,%L)', 'salon-one', 'cut', monday_10 + interval '2 days 4 hours', 'Pat', 'a@example.com', 'zero' || chr(8203) || 'width', 'key-ctl-0000002-xxxxxxxxxxxxxxxx'), 'no < or >') then raise exception 'zero-width characters must be refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '2 days 4 hours', '=HYPERLINK("x")', 'a@example.com', 'key-ctl-0000003-xxxxxxxxxxxxxxxx'), 'your name') then raise exception 'a name starting with = must be refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '2 days 4 hours', 'Pat', 'a..b@example.com', 'key-ctl-0000004-xxxxxxxxxxxxxxxx'), 'valid email') then raise exception 'a double-dot email must be refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,null,%L,null,%L)', 'salon-one', 'cut', monday_10 + interval '2 days 4 hours', 'Pat', '555' || chr(9) || '0100000', 'key-ctl-0000005-xxxxxxxxxxxxxxxx'), 'valid phone') then raise exception 'a tab inside a phone number must be refused'; end if;
  r := public.submit_public_booking_request('salon-one', 'cut', monday_10 + interval '2 days 4 hours', 'Pat Newline', 'newline@example.com', null, 'line one' || chr(10) || 'line two', 'key-ctl-0000006-xxxxxxxxxxxxxxxx', null);
  if (r->>'ok')::boolean is not true then raise exception 'a new line in a note must be accepted: %', r; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '2 days 4 hours', 'Pat', 'a@example.com', 'short-key'), 'reload the page') then raise exception 'a short key must be refused'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,%L,%L)', 'salon-one', 'cut', monday_10 + interval '2 days 5 hours', 'Pat Newline', 'newline@example.com', 'a different note', 'key-ctl-0000006-xxxxxxxxxxxxxxxx'), 'reload the page') then raise exception 'the same key with different details must be refused, not answered with the old request'; end if;

  -- ---- the owner works with requests
  perform pg_temp.as_user(o1);
  r := public.list_my_booking_requests();
  if jsonb_array_length(r) < 5 then raise exception 'owner should see the requests: %', r; end if;
  if r->0->>'contact_name' is null or r->0->>'service_name' is null then raise exception 'rows need names and service: %', r->0; end if;
  req_id := (select (e->>'id')::uuid from jsonb_array_elements(public.list_my_booking_requests()) e where e->>'request_code' = req->>'request_code');
  if req_id is null then raise exception 'could not find the first request'; end if;
  if not pg_temp.fails(format('select public.update_my_booking_request(%L, %L)', req_id, 'confirmed'), 'new, in progress, declined or cancelled') then raise exception 'confirming must be refused (needs a provider)'; end if;
  if not pg_temp.fails(format('select public.update_my_booking_request(%L, %L, %L)', req_id, 'needs_review', 'bad <b>'), 'no < or >') then raise exception 'markup in owner note refused'; end if;
  r := public.update_my_booking_request(req_id, 'needs_review', 'Called, leaving a voicemail.');
  if r->>'status' <> 'needs_review' then raise exception 'status not updated: %', r; end if;
  if (select e->>'owner_note' from jsonb_array_elements(public.list_my_booking_requests('needs_review')) e where (e->>'id')::uuid = req_id) <> 'Called, leaving a voicemail.' then raise exception 'owner note not kept'; end if;
  if not pg_temp.fails($q$select public.list_my_booking_requests('confirmed')$q$, 'Unknown request filter') then raise exception 'bad filter refused'; end if;
  perform public.update_my_booking_request(req_id, 'declined');
  perform public.update_my_booking_request(req_id, 'requested');

  -- the 188 guard is still in force underneath: even a direct update to confirmed is refused
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if not pg_temp.fails(format('update public.booking_appointment_requests set status = %L where id = %L', 'confirmed', req_id), 'Confirmed Booking state requires') then raise exception 'the 188 guard must still block confirmed'; end if;
  perform pg_temp.as_user(o1);

  -- ---- client two cannot touch client one
  perform pg_temp.as_user(o2);
  r := public.ensure_my_booking_workspace('America/New_York');
  if (r->>'has_workspace')::boolean is not true or jsonb_array_length(public.list_my_booking_requests()) <> 0 then raise exception 'client two must start with an empty list'; end if;
  if not pg_temp.fails(format('select public.update_my_booking_request(%L, %L)', req_id, 'declined'), 'Request not found') then raise exception 'client two must not change client one request'; end if;
  if not pg_temp.fails(format('select public.delete_my_booking_request(%L)', req_id), 'Request not found') then raise exception 'client two must not delete client one request'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_settings(public_slug_value => 'salon-one')$q$, 'already taken') then raise exception 'a taken slug must be refused'; end if;
  if (select status from public.booking_appointment_requests where id = req_id) <> 'requested' then raise exception 'client one request must be untouched'; end if;

  -- ---- client two's own saves never touch client one (services, hours), and standing / disabled rules
  perform pg_temp.as_user(o2);
  perform public.save_my_booking_service('cut', 'Two Haircut', 15);
  perform public.save_my_booking_hours('[{"weekday":6,"start":"10:00","end":"12:00"}]'::jsonb);
  perform pg_temp.as_user(o1);
  if (select name from public.booking_service_definitions where workspace_id = ws and service_key = 'cut') <> 'Haircut' then raise exception 'client two must not rename client one service'; end if;
  if (select count(*) from public.booking_availability_rules where workspace_id = ws) <> 5 then raise exception 'client two must not change client one hours'; end if;

  -- a client the owner froze cannot keep a public page: the page disappears, requests are refused, and it cannot be switched back on
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.clients set billing_status = 'frozen' where auth_user_id = o1;
  perform pg_temp.as_user(null);
  if public.get_public_booking_page('salon-one') is not null then raise exception 'a frozen account must have no public booking page'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10 + interval '6 days', 'Pat', 'frozen@example.com', 'key-frozen-001-xxxxxxxxxxxxxxxx'), 'not open right now') then raise exception 'a frozen account must refuse requests'; end if;
  perform pg_temp.as_user(o1);
  if not pg_temp.fails($q$select public.set_my_booking_public(true)$q$, 'not available for your account') then raise exception 'a frozen account must not switch a page on'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.clients set billing_status = 'active' where auth_user_id = o1;
  perform pg_temp.as_user(null);
  if public.get_public_booking_page('salon-one') is null then raise exception 'the page must come back when the account is back in good standing'; end if;

  -- a workspace the platform disabled cannot be re-enabled by the client
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.booking_workspaces set status = 'disabled', public_enabled = false where id = ws;
  perform pg_temp.as_user(o1);
  if not pg_temp.fails($q$select public.set_my_booking_public(true)$q$, 'not available for your account') then raise exception 'a disabled workspace must not be re-enabled by the client'; end if;
  perform pg_temp.as_user(null);
  if public.get_public_booking_page('salon-one') is not null then raise exception 'a disabled workspace must have no public page'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.booking_workspaces set status = 'ready', public_enabled = true where id = ws;
  perform pg_temp.as_user(o1);

  -- ---- delete (privacy) and switching off
  perform pg_temp.as_user(o1);
  r := public.delete_my_booking_request(req_id);
  if (r->>'ok')::boolean is not true or exists (select 1 from public.booking_appointment_requests where id = req_id) then raise exception 'delete must remove the request and its contact details'; end if;
  if not pg_temp.fails(format('select public.delete_my_booking_request(%L)', req_id), 'Request not found') then raise exception 'deleting twice reports not found'; end if;

  r := public.set_my_booking_public(false);
  if (r->>'public_enabled')::boolean is not false or r->>'status' <> 'paused' then raise exception 'switching off must pause: %', r; end if;
  perform pg_temp.as_user(null);
  if public.get_public_booking_page('salon-one') is not null then raise exception 'a switched-off page must disappear'; end if;
  if not pg_temp.fails(format('select public.submit_public_booking_request(%L,%L,%L,%L,%L,null,null,%L)', 'salon-one', 'cut', monday_10, 'Pat', 'a@example.com', 'key-after-off-01-xxxxxxxxxxxxxxxx'), 'not open right now') then raise exception 'a switched-off page must refuse requests'; end if;

  -- clearing all opening hours while on switches the page off by itself
  perform pg_temp.as_user(o1);
  perform public.set_my_booking_public(true);
  r := public.save_my_booking_hours('[]'::jsonb);
  if (r->>'public_enabled')::boolean is not false then raise exception 'no hours means the page must switch off: %', r; end if;
end $$;

-- an opening period with a missing field is refused in plain words (not a raw NOT NULL error) and changes nothing
do $$
declare o1 uuid := 'eeeeeeee-0000-0000-0000-0000000000c1'; before_count integer; after_count integer;
begin
  perform pg_temp.as_user(o1);
  select count(*) into before_count from public.booking_availability_rules;
  if not pg_temp.fails($q$select public.save_my_booking_hours('[{"weekday":1,"start":null,"end":"17:00"}]'::jsonb)$q$, 'a day, a start and an end') then raise exception 'a null start must be refused in plain words'; end if;
  if not pg_temp.fails($q$select public.save_my_booking_hours('[{"weekday":null,"start":"09:00","end":"17:00"}]'::jsonb)$q$, 'a day, a start and an end') then raise exception 'a null weekday must be refused in plain words'; end if;
  select count(*) into after_count from public.booking_availability_rules;
  if before_count <> after_count then raise exception 'a refused save must change nothing'; end if;
end $$;

-- retention purge: service role only, 30-day floor, deletes only what is older than the retention, never more than asked
do $$
declare
  total integer; old_id uuid; recent_id uuid; r jsonb;
begin
  select count(*) into total from public.booking_appointment_requests;
  if total < 2 then raise exception 'purge test needs at least 2 requests, found %', total; end if;
  select id into old_id from public.booking_appointment_requests order by created_at limit 1;
  select id into recent_id from public.booking_appointment_requests where id <> old_id order by created_at limit 1;
  update public.booking_appointment_requests set created_at = now() - interval '100 days' where id = old_id;
  update public.booking_appointment_requests set created_at = now() - interval '89 days' where id = recent_id;
  if has_function_privilege('anon', 'public.purge_old_booking_requests(integer)', 'execute') or has_function_privilege('authenticated', 'public.purge_old_booking_requests(integer)', 'execute') then raise exception 'purge must not be callable by API roles'; end if;
  if not has_function_privilege('service_role', 'public.purge_old_booking_requests(integer)', 'execute') then raise exception 'the service role must be able to purge'; end if;
  if not pg_temp.fails('select public.purge_old_booking_requests(7)', 'between 30 and 3650') then raise exception 'a retention under 30 days must be refused'; end if;
  if not pg_temp.fails('select public.purge_old_booking_requests(null)', 'between 30 and 3650') then raise exception 'a null retention must be refused'; end if;
  if (select count(*) from public.booking_appointment_requests) <> total then raise exception 'refused calls must delete nothing'; end if;
  r := public.purge_old_booking_requests(90);
  if (r->>'deleted')::int <> 1 then raise exception 'exactly the 100-day-old request must go: %', r; end if;
  if exists (select 1 from public.booking_appointment_requests where id = old_id) then raise exception 'the old request must be gone'; end if;
  if not exists (select 1 from public.booking_appointment_requests where id = recent_id) then raise exception 'the 89-day-old request must stay'; end if;
  r := public.purge_old_booking_requests(90);
  if (r->>'deleted')::int <> 0 then raise exception 'a second run must find nothing: %', r; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
