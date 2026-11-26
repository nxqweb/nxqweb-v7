-- Regression test for docs/OWNER_STYLE_BACKFILL.md (the owner-run SQL that fills in the missing website style for clients who submitted before the one-line fix).
-- Rolled back. Proves, on a real database: the old two-line report is back-filled; the onboarding check STOPS listing desired_style afterwards (that is what clears the portal message) and queues the build plan;
-- clients that already have a style, or have no report, are untouched; and a second run changes nothing. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','old@synthetic.invalid','',now(),'{}','{"business_name":"Old Format Co"}'),
 ('cccccccc-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','has@synthetic.invalid','',now(),'{}','{"business_name":"Has Style Co"}'),
 ('cccccccc-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','none@synthetic.invalid','',now(),'{}','{"business_name":"No Report Co"}'),
 ('cccccccc-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oneline@synthetic.invalid','',now(),'{}','{"business_name":"One Line Co"}');

-- four approved clients with everything filled in EXCEPT (for the first, third and fourth) the style
update public.clients set status = 'approved', contact_name = 'Pat Owner', contact_phone = '(555) 123-4567', business_type = 'Tree service', service_area = 'Sacramento';
update public.clients set notes = E'NXQ WEB WEBSITE SETUP REPORT\n\nBusiness phone: (555) 123-4567\n\nServices / products:\nTree removal\n\nStyle direction:\nWarm, simple, cream and gold.\n\nBrand difference / positioning:\nFamily run\n' where business_name = 'Old Format Co';
update public.clients set notes = E'NXQ WEB WEBSITE SETUP REPORT\n\nStyle direction:\nSomething the report says\n\nBrand difference / positioning:\nx\n' where business_name = 'Has Style Co';
update public.clients set notes = E'NXQ WEB WEBSITE SETUP REPORT\n\nBusiness phone: (555) 123-4567\n\nStyle direction: Clean and bold.\n\nBrand difference / positioning:\nx\n' where business_name = 'One Line Co';
insert into public.client_intakes(client_id, business_name, contact_name, contact_email, contact_phone, business_type, services, service_area, goals, desired_style)
select c.id, c.business_name, 'Pat Owner', c.business_name || '@synthetic.invalid', '(555) 123-4567', 'Tree service', 'Tree removal', 'Sacramento', 'Home, Services, Contact',
       case c.business_name when 'Has Style Co' then 'Dark and dramatic' else null end
  from public.clients c where c.business_name in ('Old Format Co', 'Has Style Co', 'No Report Co', 'One Line Co');

-- BEFORE: the onboarding check says the style is missing for the old-format client (and only that)
do $$ declare ev jsonb; begin
  ev := public.evaluate_client_onboarding((select id from public.clients where business_name = 'Old Format Co'));
  if ev->'missing_fields' <> '["desired_style"]'::jsonb then raise exception 'before the backfill expected only desired_style missing, got %', ev; end if;
  if ev->>'status' <> 'needs_information' then raise exception 'before the backfill expected needs_information, got %', ev->>'status'; end if;
end $$;

-- the preview query, exactly as in the doc: it must list the two clients that can be filled and no one else
do $$ declare names text; begin
  select string_agg(business_name, ',' order by business_name) into names from (
    select c.business_name
    from public.client_intakes ci
    join public.clients c on c.id = ci.client_id
    where nullif(btrim(coalesce(ci.desired_style, '')), '') is null
      and c.notes like 'NXQ WEB WEBSITE SETUP REPORT%'
      and coalesce(public.extract_setup_report_section(c.notes, 'Style direction'), public.extract_setup_report_value(c.notes, 'Style direction')) is not null
  ) p;
  if names is distinct from 'Old Format Co,One Line Co' then raise exception 'preview listed %, expected Old Format Co,One Line Co', names; end if;
end $$;

-- the apply statement, exactly as in the doc
update public.client_intakes ci
   set desired_style = x.style
  from (
    select distinct on (i.client_id) i.id as intake_id,
           coalesce(public.extract_setup_report_section(c.notes, 'Style direction'), public.extract_setup_report_value(c.notes, 'Style direction')) as style
      from public.client_intakes i
      join public.clients c on c.id = i.client_id
     where c.notes like 'NXQ WEB WEBSITE SETUP REPORT%'
     order by i.client_id, i.created_at desc
  ) x
 where ci.id = x.intake_id
   and nullif(btrim(coalesce(ci.desired_style, '')), '') is null
   and x.style is not null;

do $$ declare ev jsonb; begin
  if (select desired_style from public.client_intakes where business_name = 'Old Format Co') <> 'Warm, simple, cream and gold.' then raise exception 'the old two-line style was not filled in correctly'; end if;
  if (select desired_style from public.client_intakes where business_name = 'One Line Co') <> 'Clean and bold.' then raise exception 'the one-line style was not filled in'; end if;
  if (select desired_style from public.client_intakes where business_name = 'Has Style Co') <> 'Dark and dramatic' then raise exception 'an existing style was overwritten'; end if;
  if (select desired_style from public.client_intakes where business_name = 'No Report Co') is not null then raise exception 'a client with no report was changed'; end if;
  -- AFTER: the onboarding check no longer asks for the style, which is what clears the message in the client's portal
  ev := public.evaluate_client_onboarding((select id from public.clients where business_name = 'Old Format Co'));
  if ev->'missing_fields' <> '[]'::jsonb then raise exception 'after the backfill the check still lists %', ev->'missing_fields'; end if;
  -- finding from this test: with nothing missing the same check goes on to QUEUE the client's website build plan, so the backfill moves the project forward
  if ev->>'status' <> 'build_plan_queued' then raise exception 'after the backfill expected build_plan_queued, got %', ev->>'status'; end if;
  -- the client with no report still has nothing to fill in and is still asked
  ev := public.evaluate_client_onboarding((select id from public.clients where business_name = 'No Report Co'));
  if ev->'missing_fields' <> '["desired_style"]'::jsonb then raise exception 'the client with no report should still be asked for a style, got %', ev; end if;
end $$;

-- a second run changes nothing
do $$ declare n int; begin
  update public.client_intakes ci
     set desired_style = x.style
    from (
      select distinct on (i.client_id) i.id as intake_id,
             coalesce(public.extract_setup_report_section(c.notes, 'Style direction'), public.extract_setup_report_value(c.notes, 'Style direction')) as style
        from public.client_intakes i
        join public.clients c on c.id = i.client_id
       where c.notes like 'NXQ WEB WEBSITE SETUP REPORT%'
       order by i.client_id, i.created_at desc
    ) x
   where ci.id = x.intake_id
     and nullif(btrim(coalesce(ci.desired_style, '')), '') is null
     and x.style is not null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the backfill is not idempotent: second run changed % rows', n; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
