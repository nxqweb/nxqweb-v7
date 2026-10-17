-- Regression test for draft 05 (Reviews collector). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('eeeeeeee-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reviews-one@synthetic.invalid','',now(),'{}','{"business_name":"Reviews Shop One","product_family_slug":"business"}'),
 ('eeeeeeee-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reviews-two@synthetic.invalid','',now(),'{}','{"business_name":"Reviews Shop Two","product_family_slug":"business"}');

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
  o1 uuid := 'eeeeeeee-0000-0000-0000-0000000000b1';
  o2 uuid := 'eeeeeeee-0000-0000-0000-0000000000b2';
  r jsonb;
  bad text;
begin
  if (select count(*) from public.clients where auth_user_id in (o1,o2)) is distinct from 2 then raise exception 'client fixtures missing'; end if;

  -- privileges: owner-only functions, no direct table access for anyone
  if has_function_privilege('anon', 'public.get_my_review_settings()', 'execute') or has_function_privilege('anon', 'public.save_my_review_settings(text,text)', 'execute') then raise exception 'anon must not call the review functions'; end if;
  if not has_function_privilege('authenticated', 'public.get_my_review_settings()', 'execute') or not has_function_privilege('authenticated', 'public.save_my_review_settings(text,text)', 'execute') then raise exception 'signed-in clients must be able to call the review functions'; end if;
  if has_table_privilege('anon', 'public.client_review_settings', 'select') or has_table_privilege('authenticated', 'public.client_review_settings', 'select') or has_table_privilege('authenticated', 'public.client_review_settings', 'insert') then raise exception 'the table must have no direct grants'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.client_review_settings'::regclass) then raise exception 'row level security must be on'; end if;

  -- signed out
  perform pg_temp.as_user(null);
  if not pg_temp.fails($q$select public.get_my_review_settings()$q$, 'Client workspace not found') then raise exception 'signed-out read must be refused'; end if;
  if not pg_temp.fails($q$select public.save_my_review_settings('https://g.page/r/abc/review')$q$, 'Client workspace not found') then raise exception 'signed-out save must be refused'; end if;

  -- nothing saved yet
  perform pg_temp.as_user(o1);
  r := public.get_my_review_settings();
  if (r->>'has_settings')::boolean is not false or r->>'review_url' is not null then raise exception 'new client must have no settings: %', r; end if;

  -- a good save, with the business name tidied
  r := public.save_my_review_settings('  https://g.page/r/CabcDEF/review  ', '  Light   of the World  ');
  if r->>'review_url' <> 'https://g.page/r/CabcDEF/review' or r->>'business_name' <> 'Light of the World' or (r->>'has_settings')::boolean is not true then raise exception 'save did not tidy the values: %', r; end if;

  -- a second save replaces, never duplicates
  r := public.save_my_review_settings('https://www.yelp.com/biz/light-of-the-world', null);
  if r->>'review_url' <> 'https://www.yelp.com/biz/light-of-the-world' or r->>'business_name' is not null then raise exception 'replace failed: %', r; end if;
  if (select count(*) from public.client_review_settings where client_id = (select id from public.clients where auth_user_id = o1)) <> 1 then raise exception 'must stay one row per client'; end if;

  -- bad links are refused with a plain message
  foreach bad in array array['http://insecure.example.com/review', 'ftp://x.example.com', 'javascript:alert(1)', 'https://', 'https://localhost/x', 'https://exa mple.com/x', 'https://user:pass@example.com/x', 'https://example.com/<script>', 'https://example.com/"x', 'www.example.com/review', 'not a link', 'https://-.com', 'https://a..com/x', 'https://.example.com', 'https://-bad.example.com/x']
  loop
    if not (pg_temp.fails(format('select public.save_my_review_settings(%L)', bad), 'Enter a review link') or pg_temp.fails(format('select public.save_my_review_settings(%L)', bad), 'web address')) then raise exception 'bad link must be refused: %', bad; end if;
  end loop;
  if not pg_temp.fails(format('select public.save_my_review_settings(%L)', 'https://example.com/' || repeat('a', 500)), '500 characters') then raise exception 'overlong link must be refused'; end if;
  if not pg_temp.fails($q$select public.save_my_review_settings('https://g.page/r/abc/review', 'Bad <b>name</b>')$q$, 'no < or >') then raise exception 'markup in the name must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_review_settings(%L, %L)', 'https://g.page/r/abc/review', repeat('n', 81)), '80 characters') then raise exception 'overlong name must be refused'; end if;
  -- a refused save must not have changed anything
  if public.get_my_review_settings()->>'review_url' <> 'https://www.yelp.com/biz/light-of-the-world' then raise exception 'a refused save changed the stored link'; end if;

  -- clients cannot see each other's settings
  perform pg_temp.as_user(o2);
  if (public.get_my_review_settings()->>'has_settings')::boolean is not false then raise exception 'client two must not see client one settings'; end if;
  perform public.save_my_review_settings('https://www.facebook.com/lightoftheworld/reviews', 'Two');
  perform pg_temp.as_user(o1);
  if public.get_my_review_settings()->>'review_url' <> 'https://www.yelp.com/biz/light-of-the-world' then raise exception 'client two overwrote client one'; end if;

  -- an empty link removes the settings
  r := public.save_my_review_settings('   ', 'ignored');
  if (r->>'has_settings')::boolean is not false then raise exception 'empty link must remove settings: %', r; end if;
  perform pg_temp.as_user(o2);
  if (public.get_my_review_settings()->>'has_settings')::boolean is not true then raise exception 'removing one client settings must not touch another'; end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
