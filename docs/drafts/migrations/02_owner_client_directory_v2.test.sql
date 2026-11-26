-- Sidecar test for 02. Rolled back. Proves v2 returns the identifiers, searches by them, keeps v1 unchanged,
-- stays owner-only, and does not widen privileges.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@synthetic.invalid','',now(),'{}','{"business_name":"Owner Co"}'),
 ('aaaaaaaa-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','alpha@synthetic.invalid','',now(),'{}','{"business_name":"Alpha Roofing","product_family_slug":"business","product_tier_key":"growth"}'),
 ('aaaaaaaa-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','beta@synthetic.invalid','',now(),'{}','{"business_name":"Beta Tree Care","product_family_slug":"business","product_tier_key":"growth"}');
insert into public.owner_users(auth_user_id) values ('aaaaaaaa-0000-0000-0000-000000000001');
create temp table results(k text, v text);
grant all on results to public;

-- privileges: anon cannot execute; authenticated can (the function checks owner itself)
do $$ begin
  if has_function_privilege('anon', 'public.owner_client_directory_page_v2(integer,timestamptz,uuid,text,text)', 'execute') then raise exception 'anon can execute v2'; end if;
  if not has_function_privilege('authenticated', 'public.owner_client_directory_page_v2(integer,timestamptz,uuid,text,text)', 'execute') then raise exception 'authenticated cannot execute v2'; end if;
end $$;

-- as the owner
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$ declare n int; code text; nid text; found_ct int; v1 int; v2 int; extra jsonb; a jsonb; b jsonb; begin
  -- identifiers present and well formed for every client
  select count(*) into n from public.owner_client_directory_page_v2(100, null, null, null, null);
  if n < 3 then raise exception 'expected at least 3 clients, got %', n; end if;
  declare bad record; begin
    select d.business_name, d.client_code, d.nxq_id into bad from public.owner_client_directory_page_v2(100, null, null, null, null) d
      where d.client_code is null or d.nxq_id is null or d.client_code !~ '^WEB-[0-9A-F]{12}$' or d.nxq_id !~ '^NXQ-[0-9A-F]{16}$' limit 1;
    if found then raise exception 'malformed or missing identifier: % | % | %', bad.business_name, bad.client_code, bad.nxq_id; end if;
  end;

  -- search by client_code (lower-case), by nxq_id (partial) and by business name
  select client_code, nxq_id into code, nid from public.owner_client_directory_page_v2(100, null, null, 'Alpha Roofing', null);
  select count(*) into found_ct from public.owner_client_directory_page_v2(10, null, null, lower(code), null);
  if found_ct <> 1 then raise exception 'search by client_code found % rows', found_ct; end if;
  select count(*) into found_ct from public.owner_client_directory_page_v2(10, null, null, substr(nid, 1, 10), null);
  if found_ct < 1 then raise exception 'search by nxq_id prefix found nothing'; end if;
  select count(*) into found_ct from public.owner_client_directory_page_v2(10, null, null, 'beta tree', null);
  if found_ct <> 1 then raise exception 'search by name regressed'; end if;
  select count(*) into found_ct from public.owner_client_directory_page_v2(10, null, null, 'zzz-no-such-id', null);
  if found_ct <> 0 then raise exception 'unexpected search match'; end if;

  -- v1 is unchanged and v2 agrees with it on every original column
  select count(*) into v1 from public.owner_client_directory_page(100, null, null, null, null);
  select count(*) into v2 from public.owner_client_directory_page_v2(100, null, null, null, null);
  if v1 <> v2 then raise exception 'v1 and v2 row counts differ (% vs %)', v1, v2; end if;
  if exists (
    select 1 from (select to_jsonb(x) j from public.owner_client_directory_page(100, null, null, null, null) x) o
    full join (select to_jsonb(y) - 'client_code' - 'nxq_id' j from public.owner_client_directory_page_v2(100, null, null, null, null) y) w on o.j = w.j
    where o.j is null or w.j is null) then raise exception 'v2 differs from v1 on original columns'; end if;

  -- pagination: page of 1 then the next page via the cursor
  declare c1 record; c2 record; begin
    select * into c1 from public.owner_client_directory_page_v2(1, null, null, null, null);
    select * into c2 from public.owner_client_directory_page_v2(1, c1.created_at, c1.id, null, null);
    if c2.id is null or c2.id = c1.id then raise exception 'cursor pagination failed'; end if;
  end;

  -- validation rules carried over
  begin perform * from public.owner_client_directory_page_v2(10, now(), null, null, null); raise exception 'incomplete cursor accepted';
  exception when raise_exception then if sqlerrm = 'incomplete cursor accepted' then raise; end if; end;
  begin perform * from public.owner_client_directory_page_v2(10, null, null, repeat('x', 161), null); raise exception 'long search accepted';
  exception when raise_exception then if sqlerrm = 'long search accepted' then raise; end if; end;
end $$;
reset role;

-- as an ordinary client: refused
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform * from public.owner_client_directory_page_v2(10, null, null, null, null); raise exception 'non-owner accepted';
  exception when raise_exception then if sqlerrm = 'non-owner accepted' then raise; end if; if sqlerrm <> 'Owner access required.' then raise exception 'wrong error: %', sqlerrm; end if; end;
end $$;
reset role;

select 'DRAFT_TEST_OK';
rollback;
