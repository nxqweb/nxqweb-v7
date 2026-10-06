-- Sidecar test for 05. Rolled back. Proves the anonymous role has no privilege (table or column level) on the seven tables, and that
-- logged-in (authenticated) and service-role access to them is untouched.
begin;
do $$ declare t text; p text; tables text[] := array['activity_logs','client_intakes','client_messages','clients','owner_ai_messages','owner_approval_requests','projects']; begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then raise exception 'table public.% does not exist (test would be vacuous)', t; end if;
    foreach p in array array['select','insert','update','delete','truncate','references','trigger'] loop
      if has_table_privilege('anon', 'public.' || t, p) then raise exception 'anon still has % on public.%', upper(p), t; end if;
    end loop;
    if has_any_column_privilege('anon', 'public.' || t, 'select,insert,update,references') then raise exception 'anon still has a column privilege on public.%', t; end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') then raise exception 'service_role lost select on public.%', t; end if;
  end loop;
  -- authenticated access that the app relies on is untouched
  if not has_table_privilege('authenticated', 'public.clients', 'select') then raise exception 'authenticated lost select on public.clients'; end if;
  if not has_table_privilege('authenticated', 'public.projects', 'select') then raise exception 'authenticated lost select on public.projects'; end if;
  -- and no policy ever named the anon role on these tables (so nothing depended on the grant)
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = any(tables) and ('anon' = any(roles) or 'public' = any(roles))) then
    raise exception 'a policy on one of these tables names anon/public, revoke would change behaviour';
  end if;
end $$;
select 'DRAFT_TEST_OK';
rollback;
