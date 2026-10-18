-- Test for draft 10 (website photos at setup). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','photo-one@synthetic.invalid','',now(),'{}','{"business_name":"Photo One Co","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','photo-two@synthetic.invalid','',now(),'{}','{"business_name":"Photo Two Co","product_family_slug":"business","product_tier_key":"starter"}');

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

-- one function call as the signed-in client; returns true when it is REFUSED with the expected words
create or replace function pg_temp.upload_refused(uid uuid, path text, mime text, bucket text default 'client-files', expected text default 'Upload denied by account, tier, or billing state') returns boolean language plpgsql as $f$
begin
  perform pg_temp.as_user(uid);
  execute 'set local role authenticated';
  begin
    perform public.nxq_authorize_storage_upload(bucket, path, 1000::bigint, mime);
    execute 'reset role';
    return false;
  exception when others then
    execute 'reset role';
    return sqlerrm like '%' || expected || '%';
  end;
end $f$;

do $$
declare
  u1 uuid := 'ffffffff-0000-0000-0000-0000000000a1';
  u2 uuid := 'ffffffff-0000-0000-0000-0000000000a2';
  c1 uuid; c2 uuid;
  r jsonb; n int; i int; st text; before_limit bigint; policy_limit bigint;
  f_img uuid; f_pdf uuid; f_other uuid; f_work uuid[] := '{}'; fid uuid;
begin
  select id into c1 from public.clients where auth_user_id = u1;
  select id into c2 from public.clients where auth_user_id = u2;
  if c1 is null or c2 is null then raise exception 'client fixtures missing (test would be vacuous)'; end if;

  -- ===== (0) storage policy is created for PAID clients in setup, never for unpaid ones =====
  if exists (select 1 from public.nxq_client_resource_policies where client_id = c1 and resource_key = 'storage_bytes') then raise exception 'an unpaid new client must have no storage policy yet'; end if;
  update public.clients set billing_status = 'active', billing_provider = 'manual' where id = c1;
  if not exists (select 1 from public.nxq_client_resource_policies where client_id = c1 and resource_key = 'storage_bytes') then raise exception 'flipping billing to active must create the storage policy for a client in setup'; end if;
  if exists (select 1 from public.nxq_client_resource_policies where client_id = c2 and resource_key = 'storage_bytes') then raise exception 'the other, unpaid client must still have none'; end if;
  update public.clients set billing_status = 'not_configured' where id = c1;
  delete from public.nxq_client_resource_policies where client_id = c1;

  -- ===== (1) upload authorization =====
  -- a brand-new, unpaid client (status lead, billing not configured) still cannot upload anything
  if not pg_temp.upload_refused(u1, c1::text || '/photo.jpg', 'image/jpeg') then raise exception 'an UNPAID client must not upload photos'; end if;

  -- paid, still in setup: images to client-files are allowed
  update public.clients set billing_status = 'active', billing_provider = 'manual' where id = c1;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  r := public.nxq_authorize_storage_upload('client-files', c1::text || '/photo-a.jpg', 1000::bigint, 'image/jpeg');
  reset role;
  if (r->>'ok')::boolean is not true then raise exception 'a paid client in setup must be able to upload a JPG, got %', r; end if;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  r := public.nxq_authorize_storage_upload('client-files', c1::text || '/photo-b.png', 1000::bigint, 'IMAGE/PNG');
  reset role;
  if (r->>'ok')::boolean is not true then raise exception 'mime case must not matter for an allowed image'; end if;

  -- a paid client submitting their own setup (status changes under THEIR login, not an owner or service) must not be blocked by the policy trigger
  perform pg_temp.as_user(u1);
  update public.clients set status = 'intake_received' where id = c1;
  update public.clients set status = 'lead' where id = c1;
  perform set_config('request.jwt.claim.role', 'service_role', true);

  -- every setup status works, and past_due (the grace state) still counts as paid
  foreach st in array array['intake_received','needs_owner_review'] loop
    update public.clients set status = st::public.client_status where id = c1;
    perform pg_temp.as_user(u1);
    set local role authenticated;
    r := public.nxq_authorize_storage_upload('client-files', c1::text || '/status-' || st || '.jpg', 1000::bigint, 'image/jpeg');
    reset role;
    if (r->>'ok')::boolean is not true then raise exception 'status % must allow a paid client to upload a photo', st; end if;
  end loop;
  update public.clients set status = 'lead', billing_status = 'past_due' where id = c1;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  r := public.nxq_authorize_storage_upload('client-files', c1::text || '/pastdue.jpg', 1000::bigint, 'image/jpeg');
  reset role;
  if (r->>'ok')::boolean is not true then raise exception 'past_due must still allow photo uploads'; end if;
  update public.clients set billing_status = 'active' where id = c1;

  -- planted-bug controls: each of these must still be refused
  if not pg_temp.upload_refused(u1, c1::text || '/contract.pdf', 'application/pdf') then raise exception 'a PDF must still need an approved account'; end if;
  if not pg_temp.upload_refused(u1, c1::text || '/sheet.csv', 'text/csv') then raise exception 'a CSV must still need an approved account'; end if;
  if not pg_temp.upload_refused(u1, c1::text || '/x.svg', 'image/svg+xml') then raise exception 'SVG must not be allowed pre-approval'; end if;
  if not pg_temp.upload_refused(u1, c1::text || '/x.gif', 'image/gif') then raise exception 'GIF must not be allowed pre-approval'; end if;
  if not pg_temp.upload_refused(u1, c1::text || '/x.jpg', 'image/jpeg', 'commerce-product-media') then raise exception 'other buckets must still need an approved account'; end if;
  if not pg_temp.upload_refused(u1, c2::text || '/x.jpg', 'image/jpeg', 'client-files', 'outside this client workspace') then raise exception 'another client''s folder must be refused'; end if;
  if not pg_temp.upload_refused(u1, c1::text || '/../x.jpg', 'image/jpeg', 'client-files', 'outside this client workspace') then raise exception 'path tricks must be refused'; end if;

  -- denied / frozen / archived clients never upload, even when billing says active
  update public.clients set status = 'denied' where id = c1;
  if not pg_temp.upload_refused(u1, c1::text || '/photo-c.jpg', 'image/jpeg') then raise exception 'a denied client must not upload'; end if;
  update public.clients set status = 'frozen' where id = c1;
  if not pg_temp.upload_refused(u1, c1::text || '/photo-d.jpg', 'image/jpeg') then raise exception 'a frozen client must not upload'; end if;
  update public.clients set status = 'lead' where id = c1;
  update public.clients set pipeline_stopped_at = now() where id = c1;
  if not pg_temp.upload_refused(u1, c1::text || '/photo-e.jpg', 'image/jpeg') then raise exception 'a stopped pipeline must not upload'; end if;
  update public.clients set pipeline_stopped_at = null where id = c1;

  -- billing that is not active again closes it
  update public.clients set billing_status = 'not_configured' where id = c1;
  if not pg_temp.upload_refused(u1, c1::text || '/photo-f.jpg', 'image/jpeg') then raise exception 'unpaid again means no uploads'; end if;
  update public.clients set billing_status = 'active' where id = c1;

  -- regression: an approved client still uploads other file types exactly as before
  perform set_config('request.jwt.claim.role', 'service_role', true); -- approval is an owner/service action
  update public.clients set status = 'approved' where id = c1;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  r := public.nxq_authorize_storage_upload('client-files', c1::text || '/contract.pdf', 1000::bigint, 'application/pdf');
  reset role;
  if (r->>'ok')::boolean is not true then raise exception 'an approved client must still upload a PDF'; end if;
  update public.clients set status = 'lead' where id = c1;

  -- ===== (1c) a billing-only change on an APPROVED client behaves exactly as before this draft =====
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.clients set status = 'approved', billing_status = 'active' where id = c1;
  update public.nxq_client_resource_policies set monthly_limit = 123456 where client_id = c1 and resource_key = 'storage_bytes';
  update public.clients set billing_status = 'past_due' where id = c1;
  select monthly_limit into policy_limit from public.nxq_client_resource_policies where client_id = c1 and resource_key = 'storage_bytes';
  if policy_limit is distinct from 123456 then raise exception 'a billing-only change must not overwrite a hand-tuned limit, got %', policy_limit; end if;
  -- even if re-seeding WOULD fail (no economic policy for the tier), freezing or cancelling a non-payer must still work
  create temp table saved_economic_policy on commit drop as select * from public.nxq_tier_economic_policies where product_family_slug = 'business' and tier_key = 'starter';
  delete from public.nxq_tier_economic_policies where product_family_slug = 'business' and tier_key = 'starter';
  update public.clients set billing_status = 'cancelled' where id = c1;
  if (select billing_status::text from public.clients where id = c1) <> 'cancelled' then raise exception 'a billing change on an approved client must never be blocked by policy seeding'; end if;
  -- a paid client IN SETUP whose seeding cannot work does not have their own flow broken either (they just cannot upload yet)
  update public.clients set status = 'lead', billing_status = 'not_configured' where id = c1;
  delete from public.nxq_client_resource_policies where client_id = c1;
  update public.clients set billing_status = 'active' where id = c1;
  if exists (select 1 from public.nxq_client_resource_policies where client_id = c1 and resource_key = 'storage_bytes') then raise exception 'without an economic policy no storage policy can exist'; end if;
  if (select billing_status::text from public.clients where id = c1) <> 'active' then raise exception 'a seeding failure must not block the billing change'; end if;
  if not pg_temp.upload_refused(u1, c1::text || '/photo-g.jpg', 'image/jpeg', 'client-files', 'No server-side resource policy') then raise exception 'without a policy the upload is refused for the right reason'; end if;
  perform pg_temp.as_user(u1);
  update public.clients set status = 'intake_received' where id = c1;
  update public.clients set status = 'lead' where id = c1;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.nxq_tier_economic_policies select * from saved_economic_policy;
  update public.clients set billing_status = 'not_configured' where id = c1;
  update public.clients set billing_status = 'active' where id = c1;
  if not exists (select 1 from public.nxq_client_resource_policies where client_id = c1 and resource_key = 'storage_bytes') then raise exception 'with the economic policy back, going active must seed the storage policy again'; end if;

  -- ===== (2) photo roles =====
  insert into public.client_files (client_id, storage_path, file_name, file_type, file_size) values (c1, c1::text || '/photo-a.jpg', 'photo-a.jpg', 'image/jpeg', 1000) returning id into f_img;
  insert into public.client_files (client_id, storage_path, file_name, file_type, file_size) values (c1, c1::text || '/contract.pdf', 'contract.pdf', 'application/pdf', 1000) returning id into f_pdf;
  insert into public.client_files (client_id, storage_path, file_name, file_type, file_size) values (c2, c2::text || '/theirs.jpg', 'theirs.jpg', 'image/jpeg', 1000) returning id into f_other;

  -- the table is closed to every API role; the build read is not public
  if has_table_privilege('authenticated', 'public.client_site_photos', 'select') or has_table_privilege('anon', 'public.client_site_photos', 'select')
     or has_table_privilege('authenticated', 'public.client_site_photos', 'insert') then raise exception 'the photos table must have no API grants'; end if;
  if has_function_privilege('authenticated', 'public.get_site_photos_for_build(uuid)', 'execute') or has_function_privilege('anon', 'public.list_my_site_photos()', 'execute') then
    raise exception 'the build read must be service-role only and the client functions must not be public';
  end if;

  perform pg_temp.as_user(null);
  set local role anon;
  if not pg_temp.fails('select public.list_my_site_photos()', 'permission denied') then raise exception 'anon must be refused'; end if;
  reset role;

  update public.clients set billing_status = 'not_configured' where id = c1;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 1)', f_img, 'work', 'x', ''), 'need an active plan') then raise exception 'tagging photos must need an active plan'; end if;
  reset role;
  update public.clients set billing_status = 'active' where id = c1;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  r := public.save_my_site_photo(f_img, 'work', '  A tree after trimming  ', 'Trimmed oak', 1);
  if (r->>'ok')::boolean is not true then raise exception 'saving a photo must work'; end if;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 0)', f_img, 'banner', '', ''), 'Choose where the photo goes') then raise exception 'a bad role must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 0)', f_pdf, 'work', '', ''), 'Only JPG, PNG or WebP') then raise exception 'a PDF must not be taggable as a photo'; end if;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 0)', f_other, 'work', '', ''), 'not found in your files') then raise exception 'another client''s file must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 0)', f_img, 'work', 'a <b>bold</b> claim', ''), 'cannot contain the characters') then raise exception 'markup in the description must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 0)', f_img, 'work', '', 'x > y'), 'cannot contain the characters') then raise exception 'markup in the caption must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 1000)', f_img, 'work', '', ''), 'between 0 and 999') then raise exception 'a huge order number must be refused'; end if;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 0)', gen_random_uuid(), 'work', '', ''), 'not found in your files') then raise exception 'an unknown file must be refused'; end if;
  reset role;

  -- trimmed, saved once (upsert), owned by the right client
  select count(*) into n from public.client_site_photos where client_id = c1;
  if n <> 1 then raise exception 'one photo expected, got %', n; end if;
  if (select alt_text from public.client_site_photos where client_file_id = f_img) <> 'A tree after trimming' then raise exception 'alt text must be trimmed'; end if;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  perform public.save_my_site_photo(f_img, 'site', 'Shop front', '', 3);
  reset role;
  if (select role || ':' || sort_order from public.client_site_photos where client_file_id = f_img) <> 'site:3' or (select count(*) from public.client_site_photos) <> 1 then raise exception 'saving again must update in place'; end if;

  -- limits: 12 work photos, 24 in total
  for i in 1..12 loop
    insert into public.client_files (client_id, storage_path, file_name, file_type, file_size) values (c1, c1::text || '/w' || i || '.png', 'w' || i || '.png', 'image/png', 1000) returning id into fid;
    f_work := f_work || fid;
    perform pg_temp.as_user(u1);
    set local role authenticated;
    perform public.save_my_site_photo(fid, 'work', 'w' || i, '', i);
    reset role;
  end loop;
  insert into public.client_files (client_id, storage_path, file_name, file_type, file_size) values (c1, c1::text || '/w13.png', 'w13.png', 'image/png', 1000) returning id into fid;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 13)', fid, 'work', '', ''), 'up to 12 photos') then raise exception 'the 13th work photo must be refused'; end if;
  perform public.save_my_site_photo(fid, 'site', '', '', 13);
  reset role;
  -- re-saving an existing work photo at the cap must still work (it is not a new one)
  perform pg_temp.as_user(u1);
  set local role authenticated;
  perform public.save_my_site_photo(f_work[1], 'work', 'renamed', '', 1);
  reset role;
  for i in 1..10 loop
    insert into public.client_files (client_id, storage_path, file_name, file_type, file_size) values (c1, c1::text || '/s' || i || '.webp', 's' || i || '.webp', 'image/webp', 1000) returning id into fid;
    perform pg_temp.as_user(u1);
    set local role authenticated;
    perform public.save_my_site_photo(fid, 'site', '', '', i);
    reset role;
  end loop;
  insert into public.client_files (client_id, storage_path, file_name, file_type, file_size) values (c1, c1::text || '/s11.webp', 's11.webp', 'image/webp', 1000) returning id into fid;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 0)', fid, 'site', '', ''), 'up to 24') then raise exception 'the 25th photo must be refused'; end if;
  reset role;

  -- list: only my photos, with scan state
  perform pg_temp.as_user(u1);
  set local role authenticated;
  r := public.list_my_site_photos();
  reset role;
  if jsonb_array_length(r) <> 24 or (r->0->>'scan_status') <> 'pending' or (r->0->>'released')::boolean is not false then raise exception 'list must show my 24 photos as pending/not released, got % %', jsonb_array_length(r), r->0; end if;
  perform pg_temp.as_user(u2);
  set local role authenticated;
  if jsonb_array_length(public.list_my_site_photos()) <> 0 then raise exception 'another client must see none of my photos'; end if;
  reset role;

  -- ===== (3) the build read returns ONLY clean + released photos =====
  perform pg_temp.as_user(u1);
  set local role authenticated;
  if not pg_temp.fails(format('select public.get_site_photos_for_build(%L)', c1), 'permission denied') then raise exception 'a client must not use the build read'; end if;
  reset role;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if jsonb_array_length(public.get_site_photos_for_build(c1)) <> 0 then raise exception 'unscanned photos must NOT be returned'; end if;
  update public.client_file_security_scans set status = 'clean', quarantine_status = 'released', content_sha256 = repeat('c', 64) where client_file_id = f_work[1];
  update public.client_file_security_scans set status = 'clean', quarantine_status = 'released', content_sha256 = repeat('d', 64) where client_file_id = f_work[5];
  -- the build read is closed while the client is not approved (in setup) or the pipeline is stopped, even for clean photos (QA-only clients can never be billed, so they cannot get here)
  if jsonb_array_length(public.get_site_photos_for_build(c1)) <> 0 then raise exception 'a client still in setup must have no build photos'; end if;
  update public.clients set status = 'approved' where id = c1;
  update public.clients set pipeline_stopped_at = now() where id = c1;
  if jsonb_array_length(public.get_site_photos_for_build(c1)) <> 0 then raise exception 'a stopped pipeline must have no build photos'; end if;
  update public.clients set pipeline_stopped_at = null where id = c1;
  update public.client_file_security_scans set status = 'clean', quarantine_status = 'released' where client_file_id = f_work[1];
  update public.client_file_security_scans set status = 'clean', quarantine_status = 'restricted' where client_file_id = f_work[2];
  update public.client_file_security_scans set status = 'infected', quarantine_status = 'quarantined' where client_file_id = f_work[3];
  update public.client_file_security_scans set status = 'suspicious', quarantine_status = 'released' where client_file_id = f_work[4];
  update public.client_file_security_scans set status = 'clean', quarantine_status = 'released' where client_file_id = f_work[5];
  r := public.get_site_photos_for_build(c1);
  if jsonb_array_length(r) <> 2 then raise exception 'only the 2 clean AND released photos may be returned, got %', jsonb_array_length(r); end if;
  if (r->0->>'file_id')::uuid <> f_work[1] or (r->1->>'file_id')::uuid <> f_work[5] then raise exception 'photos must come back in the client''s order'; end if;
  if (r->0->>'alt_text') <> 'renamed' or (r->0->>'storage_path') not like c1::text || '/%' then raise exception 'build rows must carry alt text and the storage path'; end if;
  if (r->0->>'content_sha256') is distinct from repeat('c', 64) then raise exception 'build rows must carry the scan content hash so the builder can prove the file is the scanned one'; end if;
  if jsonb_array_length(public.get_site_photos_for_build(c2)) <> 0 then raise exception 'another client must have no build photos'; end if;
  update public.client_files set status = 'deleted' where id = f_work[5];
  if jsonb_array_length(public.get_site_photos_for_build(c1)) <> 1 then raise exception 'a deleted file must never be returned'; end if;

  -- ===== (4) removing a tag keeps the file =====
  perform pg_temp.as_user(u2);
  set local role authenticated;
  r := public.remove_my_site_photo(f_work[1]);
  reset role;
  if (r->>'removed')::boolean is not false then raise exception 'another client must not remove my photo tag'; end if;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  r := public.remove_my_site_photo(f_work[1]);
  reset role;
  if (r->>'removed')::boolean is not true then raise exception 'removing my own tag must work'; end if;
  if not exists (select 1 from public.client_files where id = f_work[1]) then raise exception 'removing the tag must keep the uploaded file'; end if;
  if exists (select 1 from public.client_site_photos where client_file_id = f_work[1]) then raise exception 'the tag must be gone'; end if;

  -- denied clients cannot tag photos
  update public.clients set status = 'denied' where id = c1;
  perform pg_temp.as_user(u1);
  set local role authenticated;
  if not pg_temp.fails(format('select public.save_my_site_photo(%L, %L, %L, %L, 0)', f_img, 'work', '', ''), 'does not allow website photos') then raise exception 'a denied client must not save photos'; end if;
  reset role;
end $$;

select 'DRAFT_TEST_OK';
rollback;
