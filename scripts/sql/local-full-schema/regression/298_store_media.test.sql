-- Regression test for migration 298 (was draft 10) (client logo and background). Rolled-back transaction. Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-000000000a01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','media-one@synthetic.invalid','',now(),'{}','{"business_name":"Media One","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-000000000a02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','media-two@synthetic.invalid','',now(),'{}','{"business_name":"Media Two","product_family_slug":"business","product_tier_key":"starter"}'),
 ('ffffffff-0000-0000-0000-000000000a03','00000000-0000-0000-0000-000000000000','authenticated','authenticated','media-nostore@synthetic.invalid','',now(),'{}','{"business_name":"Media NoStore","product_family_slug":"business","product_tier_key":"starter"}');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('ffffffff-0000-0000-0000-000000000a09','00000000-0000-0000-0000-000000000000','authenticated','authenticated','media-owner@synthetic.invalid','',now(),'{}','{}');
insert into public.owner_users(auth_user_id) values ('ffffffff-0000-0000-0000-000000000a09');
insert into public.commerce_storefronts (client_id, store_name, store_slug, status, settings)
select c.id, v.name, v.slug, 'active', '{"paypal_url":"https://paypal.me/mediastore","look":{"bg":"#fdf9f6","ink":"#1d2f4f","muted":"#4f5b73","accent":"#a8284f","accent_dark":"#861f3e","heading_font":"serif","logo":"/brand/x-logo.png"}}'::jsonb
from (values ('ffffffff-0000-0000-0000-000000000a01'::uuid, 'Media One Store', 'media-one'),
             ('ffffffff-0000-0000-0000-000000000a02'::uuid, 'Media Two Store', 'media-two')) as v(uid, name, slug)
join public.clients c on c.auth_user_id = v.uid;

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
  one uuid := 'ffffffff-0000-0000-0000-000000000a01';
  two uuid := 'ffffffff-0000-0000-0000-000000000a02';
  none_store uuid := 'ffffffff-0000-0000-0000-000000000a03';
  c1 uuid; c2 uuid; base text; r jsonb; pub jsonb;
begin
  select id into c1 from public.clients where auth_user_id = one;
  select id into c2 from public.clients where auth_user_id = two;
  base := 'https://abcdefgh.supabase.co/storage/v1/object/public/commerce-website-content/';

  if has_function_privilege('anon', 'public.save_my_store_media(jsonb)', 'execute') or has_function_privilege('anon', 'public.get_my_store_media()', 'execute')
     or has_function_privilege('authenticated', 'public.nxq_store_look_problem(jsonb)', 'execute') then
    raise exception 'client functions must not be callable by anon, and the check by nobody';
  end if;
  if not has_function_privilege('authenticated', 'public.save_my_store_media(jsonb)', 'execute') or not has_function_privilege('authenticated', 'public.get_my_store_media()', 'execute') then
    raise exception 'signed-in clients must be able to call the two client functions';
  end if;

  -- the look check: old values still pass, new own-folder pictures pass, everything else is refused
  if public.nxq_store_look_problem('{"logo":"/brand/light-of-the-world-logo.png","bg":"#fdf9f6"}') is not null then raise exception 'shipped /brand/ logos must still pass'; end if;
  if public.nxq_store_look_problem(jsonb_build_object('logo', base || c1 || '/branding/logo-1.png', 'background', base || c1 || '/branding/bg-1.webp', 'background_overlay', 0.4)) is not null then raise exception 'own-folder pictures must pass'; end if;
  if public.nxq_store_look_problem('{"logo":"https://evil.example.com/x.png"}') is null then raise exception 'outside logo refused'; end if;
  if public.nxq_store_look_problem('{"logo":"/brand/x.svg?a=1"}') is null then raise exception 'query string logo refused'; end if;
  if public.nxq_store_look_problem(jsonb_build_object('background', base || c1 || '/branding/bg.svg')) is null then raise exception 'svg background refused'; end if;
  if public.nxq_store_look_problem(jsonb_build_object('background', 'http://abcdefgh.supabase.co/storage/v1/object/public/commerce-website-content/' || c1 || '/branding/bg.png')) is null then raise exception 'plain http refused'; end if;
  if public.nxq_store_look_problem(jsonb_build_object('background', 'https://evil.example.com/storage/v1/object/public/commerce-website-content/' || c1 || '/branding/bg.png')) is null then raise exception 'wrong host refused'; end if;
  if public.nxq_store_look_problem(jsonb_build_object('background', base || c1 || '/branding/../bg.png')) is null then raise exception 'dot-dot refused'; end if;
  if public.nxq_store_look_problem(jsonb_build_object('background', base || c1 || '/other/bg.png')) is null then raise exception 'outside the branding folder refused'; end if;
  if public.nxq_store_look_problem('{"background_overlay":0.9}') is null or public.nxq_store_look_problem('{"background_overlay":-0.1}') is null or public.nxq_store_look_problem('{"background_overlay":"0.3"}') is null then raise exception 'overlay must be a number 0 to 0.75'; end if;
  if public.nxq_store_look_problem('{"background_overlay":0.75}') is not null or public.nxq_store_look_problem('{"background_overlay":0}') is not null then raise exception 'overlay edges are allowed'; end if;

  -- a client saves their own pictures; the colors the owner set stay exactly as they were
  perform pg_temp.as_user(one);
  r := public.get_my_store_media();
  if (r->>'client_id')::uuid <> c1 then raise exception 'the client id must be returned so the page can build its own folder path: %', r; end if;
  if (r->>'has_storefront')::boolean is not true or r->'logo' <> 'null'::jsonb or (r->>'owner_logo')::boolean is not true then raise exception 'before saving: owner logo is not shown as the client logo: %', r; end if;
  r := public.save_my_store_media(jsonb_build_object('logo', base || c1 || '/branding/logo-1.png', 'background', base || c1 || '/branding/bg-1.webp', 'background_overlay', 0.35));
  if r->>'success' <> 'true' or r->>'background' <> base || c1 || '/branding/bg-1.webp' then raise exception 'save failed: %', r; end if;
  r := public.get_my_store_media();
  if r->>'logo' <> base || c1 || '/branding/logo-1.png' or (r->>'background_overlay')::numeric <> 0.35 or (r->>'owner_logo')::boolean is not false then raise exception 'not read back: %', r; end if;
  perform pg_temp.as_user(null);
  pub := public.get_public_store_look('media-one');
  if pub->>'bg' <> '#fdf9f6' or pub->>'heading_font' <> 'serif' or pub->>'accent' <> '#a8284f' then raise exception 'the owner''s colors must be untouched: %', pub; end if;
  if pub->>'background' <> base || c1 || '/branding/bg-1.webp' or pub->>'logo' <> base || c1 || '/branding/logo-1.png' then raise exception 'shoppers must see the saved pictures: %', pub; end if;

  -- refusals
  perform pg_temp.as_user(one);
  if not pg_temp.fails(format($q$select public.save_my_store_media(jsonb_build_object('background', %L))$q$, base || c2 || '/branding/bg.png'), 'own store folder') then raise exception 'another client''s folder refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_media('{"logo":"/brand/x.png"}')$q$, 'own store folder') then raise exception 'a client cannot pick a shipped /brand/ logo'; end if;
  if not pg_temp.fails($q$select public.save_my_store_media('{"bg":"#ffffff"}')$q$, 'only change the logo and the background') then raise exception 'a client cannot change colors'; end if;
  if not pg_temp.fails($q$select public.save_my_store_media('{"background_overlay":0.9}')$q$, 'background_overlay') then raise exception 'overlay too big refused'; end if;
  if not pg_temp.fails(format($q$select public.save_my_store_media(jsonb_build_object('background', %L))$q$, base || c1 || '/branding/bg.svg'), 'PNG, JPEG or WEBP') then raise exception 'svg refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_media('{"background": 5}')$q$, 'picture link') then raise exception 'non-text refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_media('[]')$q$, 'Nothing to save') then raise exception 'array refused'; end if;
  if not pg_temp.fails($q$select public.save_my_store_media(null)$q$, 'Nothing to save') then raise exception 'null refused'; end if;
  r := public.get_my_store_media();
  if r->>'background' <> base || c1 || '/branding/bg-1.webp' then raise exception 'a refused save must change nothing: %', r; end if;

  -- another client's store is untouched, and a client with no store or no workspace is told so
  perform pg_temp.as_user(two);
  r := public.get_my_store_media();
  if r->'background' <> 'null'::jsonb or r->'logo' <> 'null'::jsonb then raise exception 'the other client must see none of it: %', r; end if;
  perform pg_temp.as_user(none_store);
  if not pg_temp.fails($q$select public.save_my_store_media('{"background_overlay":0.2}')$q$, 'Create your store first') then raise exception 'no store refused'; end if;
  perform pg_temp.as_user('ffffffff-0000-0000-0000-000000000aff');
  if not pg_temp.fails($q$select public.get_my_store_media()$q$, 'Client workspace not found') then raise exception 'unknown login refused'; end if;
  perform pg_temp.as_user(null);
  if not pg_temp.fails($q$select public.save_my_store_media('{"background_overlay":0.2}')$q$, 'Client workspace not found') then raise exception 'signed-out caller refused'; end if;

  -- the owner's color save must not wipe the client's pictures
  perform pg_temp.as_user('ffffffff-0000-0000-0000-000000000a09');
  perform public.owner_set_store_look('media-one', '{"bg":"#fdf9f6","ink":"#1d2f4f","muted":"#4f5b73","accent":"#a8284f","accent_dark":"#861f3e","heading_font":"sans"}');
  perform pg_temp.as_user(null);
  pub := public.get_public_store_look('media-one');
  if pub->>'heading_font' <> 'sans' then raise exception 'the owner''s change must apply: %', pub; end if;
  if pub->>'background' <> base || c1 || '/branding/bg-1.webp' or (pub->>'background_overlay')::numeric <> 0.35 or pub->>'logo' <> base || c1 || '/branding/logo-1.png' then raise exception 'an owner color save must keep the client pictures: %', pub; end if;
  perform pg_temp.as_user('ffffffff-0000-0000-0000-000000000a09');
  perform public.owner_set_store_look('media-one', '{"bg":"#fdf9f6","ink":"#1d2f4f","muted":"#4f5b73","accent":"#a8284f","accent_dark":"#861f3e","logo":"/brand/x-logo.png"}');
  perform pg_temp.as_user(null);
  pub := public.get_public_store_look('media-one');
  if pub->>'logo' <> '/brand/x-logo.png' or pub->>'background' <> base || c1 || '/branding/bg-1.webp' then raise exception 'an owner-sent logo replaces the uploaded one, the background stays: %', pub; end if;
  perform pg_temp.as_user(one);
  perform public.save_my_store_media(jsonb_build_object('logo', base || c1 || '/branding/logo-1.png'));

  -- removing: a JSON null clears one setting and leaves the rest
  perform pg_temp.as_user(one);
  r := public.save_my_store_media('{"background": null, "background_overlay": null}');
  r := public.get_my_store_media();
  if r->'background' <> 'null'::jsonb or r->>'logo' <> base || c1 || '/branding/logo-1.png' then raise exception 'clearing the background must keep the logo: %', r; end if;
  perform pg_temp.as_user(null);
  pub := public.get_public_store_look('media-one');
  if pub ? 'background' or pub->>'bg' <> '#fdf9f6' then raise exception 'cleared background must be gone and colors kept: %', pub; end if;
  if not exists (select 1 from public.activity_logs where client_id = c1 and action = 'store_media_set') then raise exception 'saves must be logged'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
