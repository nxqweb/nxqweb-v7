-- Regression test for migration 264. Rolled back. Proves a signed-in client can still read their own request (all normal columns) but not last_error, `select *` is refused,
-- INSERT/service-role access is unchanged, and no column other than last_error lost client visibility.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zeta@synthetic.invalid','',now(),'{}','{"business_name":"Zeta Tree Care","product_family_slug":"business","product_tier_key":"growth"}');
create temp table fx as select id as client_id from public.clients where auth_user_id = 'eeeeeeee-0000-0000-0000-000000000001';
grant all on fx to public;
insert into public.data_subject_requests(client_id, request_type, status, requested_by_auth_user_id, last_error)
  select client_id, 'export', 'failed', 'eeeeeeee-0000-0000-0000-000000000001', 'INTERNAL: worker stack trace and secret-ish detail' from fx;

-- privilege shape
do $$ declare col text; begin
  if has_column_privilege('authenticated', 'public.data_subject_requests', 'last_error', 'select') then raise exception 'authenticated can still select last_error'; end if;
  if has_table_privilege('authenticated', 'public.data_subject_requests', 'select') then raise exception 'authenticated still has table-level select'; end if;
  foreach col in array array['id','nxq_account_id','client_id','request_code','request_type','status','requested_by_auth_user_id','scope','result','requested_at','due_at','completed_at','created_at','updated_at'] loop
    if not has_column_privilege('authenticated', 'public.data_subject_requests', col, 'select') then raise exception 'authenticated lost select on column %', col; end if;
  end loop;
  -- every column except last_error is in the grant (catches a column the grant list forgot)
  if exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='data_subject_requests' and c.column_name <> 'last_error'
             and not has_column_privilege('authenticated', 'public.data_subject_requests', c.column_name, 'select')) then raise exception 'a non-error column is not readable by authenticated'; end if;
  if not has_column_privilege('service_role', 'public.data_subject_requests', 'last_error', 'select') then raise exception 'service_role lost last_error'; end if;
  if not has_table_privilege('authenticated', 'public.data_subject_requests', 'insert') then raise exception 'authenticated lost insert'; end if;
  if has_table_privilege('anon', 'public.data_subject_requests', 'select') then raise exception 'anon has select'; end if;
end $$;

-- real behaviour as the signed-in client
select set_config('request.jwt.claim.sub','eeeeeeee-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims','{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$ declare n int; r record; begin
  select count(*) into n from public.data_subject_requests;
  if n <> 0 and n <> 1 then raise exception 'unexpected row count %', n; end if;
  -- the explicit column list the portal page uses works and returns the client's own request
  select id, request_code, request_type, status, requested_at, due_at, result into r from public.data_subject_requests where request_type = 'export' limit 1;
  if r.id is null then raise exception 'client could not read their own request with the page column list'; end if;
  if r.status <> 'failed' then raise exception 'status not readable or wrong: %', r.status; end if;
  -- last_error is refused with permission denied
  begin perform last_error from public.data_subject_requests; raise exception 'NO_ERROR';
  exception when insufficient_privilege then null; when others then if sqlerrm = 'NO_ERROR' then raise exception 'client could read last_error'; else raise; end if; end;
  -- and so is select *
  begin perform * from public.data_subject_requests; raise exception 'NO_ERROR';
  exception when insufficient_privilege then null; when others then if sqlerrm = 'NO_ERROR' then raise exception 'select * was allowed'; else raise; end if; end;
end $$;
reset role;

select 'DRAFT_TEST_OK';
rollback;
