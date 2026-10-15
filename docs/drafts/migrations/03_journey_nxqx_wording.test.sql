-- Sidecar test for draft 03 (journey NXQX wording). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','journey@synthetic.invalid','',now(),'{}','{"business_name":"Journey Wording Co","product_family_slug":"business","product_tier_key":"starter"}');

do $$
declare def text; c uuid; r jsonb; flat text;
begin
  def := pg_get_functiondef('public.current_client_launch_journey()'::regprocedure);
  if def is null then raise exception 'function definition missing'; end if;
  if def ~* 'websitedesignercontact' then raise exception 'the lost support address must be gone from the function'; end if;
  if def not like '%mailto:NXQweb@protonmail.com%' then raise exception 'the support link must point at NXQweb@protonmail.com'; end if;
  if def !~ 'NXQX needs a little more information' then raise exception 'new wording missing: NXQX needs a little more information'; end if;
  if def !~ 'Contact NXQX-Web with questions' then raise exception 'new wording missing: Contact NXQX-Web with questions'; end if;
  if def ~ '''NXQ needs' or def ~ '''NXQ review' or def ~ 'Contact NXQ Web' then raise exception 'old NXQ wording is still in the function'; end if;
  if def not like '%NXQ WEB WEBSITE SETUP REPORT%' then raise exception 'the legacy setup-report marker must be kept (existing records depend on it)'; end if;

  -- run it for a real fixture client and make sure no visible text uses the old brand word on its own
  select id into c from public.clients where auth_user_id = 'eeeeeeee-0000-0000-0000-000000000001';
  if c is null then raise exception 'client fixture missing (test would be vacuous)'; end if;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','eeeeeeee-0000-0000-0000-000000000001','role','authenticated')::text, true);
  r := public.current_client_launch_journey();
  if r is null then raise exception 'journey returned nothing for a fixture client'; end if;
  flat := r::text;
  if flat ~ '\mNXQ\M' then raise exception 'the journey output still shows the old standalone NXQ name: %', substr(flat, greatest(position('NXQ' in flat)-40,1), 120); end if;

  if has_function_privilege('anon','public.current_client_launch_journey()','execute') then raise exception 'anon must not execute the journey'; end if;
  if not has_function_privilege('authenticated','public.current_client_launch_journey()','execute') then raise exception 'authenticated must execute the journey'; end if;
  if not has_function_privilege('service_role','public.current_client_launch_journey()','execute') then raise exception 'service_role must execute the journey'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK' as result;
