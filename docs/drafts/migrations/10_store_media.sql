-- Draft 10: a client's own logo and background for the store look (added 2026-11-23). ADDITIVE: one internal check is re-created with extra allowed values,
-- and two client functions are new. No table, bucket, policy or upload rule changes: the pictures go into the EXISTING commerce-website-content bucket,
-- which already lets a Commerce client write only inside their own folder (migration 108) and already needs an upload ticket (nxq_authorize_storage_upload).
--
-- What the look may now hold, besides what migration 286 allows:
--   logo               either a shipped file under /brand/ (owner only, as before) OR a picture the client uploaded to their own folder:
--                      https://<project>.supabase.co/storage/v1/object/public/commerce-website-content/<client id>/branding/<file>.png|jpg|jpeg|webp
--   background         the same kind of own-folder picture (never SVG: a stored SVG could carry script)
--   background_overlay a number 0 to 0.75: how much white to lay over the background so text stays readable (the app works it out from the picture)
-- Only the OWNER can still set colors and the shipped /brand/ logo (owner_set_store_look, unchanged). A client can only change logo, background and
-- background_overlay, only in their own store, only to pictures in their own branding folder. The server checks the folder against the login, never an argument.
-- The result is live at once (the client owns the store). The owner can still clear or replace the look with owner_set_store_look / owner_clear_store_look.

create or replace function public.nxq_store_look_problem(look jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  k text; v text;
  color_keys text[] := array['bg','surface','tint','ink','muted','line','accent','accent_dark'];
  own_picture constant text := '^https://[a-z0-9][a-z0-9-]{0,62}\.supabase\.co/storage/v1/object/public/commerce-website-content/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/branding/[a-z0-9][a-z0-9._-]{0,80}\.(png|jpg|jpeg|webp)$';
begin
  if look is null or jsonb_typeof(look) <> 'object' then return 'The look must be an object.'; end if;
  for k in select jsonb_object_keys(look) loop
    if not (k = any (color_keys || array['logo','heading_font','background','background_overlay'])) then return 'Unknown look setting: ' || left(k, 40); end if;
  end loop;
  foreach k in array color_keys loop
    if look ? k then
      if jsonb_typeof(look -> k) <> 'string' or (look ->> k) !~ '^#[0-9a-fA-F]{6}$' then return k || ' must be a color like #1d2f4f.'; end if;
    end if;
  end loop;
  if look ? 'heading_font' and (look ->> 'heading_font') not in ('serif', 'sans') then return 'heading_font must be serif or sans.'; end if;
  if look ? 'logo' then
    v := look ->> 'logo';
    if jsonb_typeof(look -> 'logo') <> 'string' or v like '%..%'
       or (v !~ '^/brand/[a-z0-9][a-z0-9._-]{0,80}\.(png|jpg|jpeg|webp|svg)$' and v !~ own_picture) then
      return 'The logo must be a file under /brand/ (for example /brand/shop-logo.png) or a picture uploaded to your own store folder.';
    end if;
  end if;
  if look ? 'background' then
    v := look ->> 'background';
    if jsonb_typeof(look -> 'background') <> 'string' or v like '%..%' or v !~ own_picture then
      return 'The background must be a PNG, JPEG or WEBP picture uploaded to your own store folder.';
    end if;
  end if;
  if look ? 'background_overlay' then
    if jsonb_typeof(look -> 'background_overlay') <> 'number' or (look ->> 'background_overlay')::numeric < 0 or (look ->> 'background_overlay')::numeric > 0.75 then
      return 'background_overlay must be a number from 0 to 0.75.';
    end if;
  end if;
  if look ? 'ink' and look ? 'bg' and public.nxq_contrast_ratio(look ->> 'ink', look ->> 'bg') < 4.5 then return 'Text (ink) on the page background is hard to read: it needs a contrast of at least 4.5.'; end if;
  if look ? 'muted' and look ? 'bg' and public.nxq_contrast_ratio(look ->> 'muted', look ->> 'bg') < 4.5 then return 'Soft text (muted) on the page background is hard to read: it needs a contrast of at least 4.5.'; end if;
  if look ? 'accent' and public.nxq_contrast_ratio(look ->> 'accent', '#ffffff') < 4.5 then return 'White text on the accent color is hard to read: the accent needs a contrast of at least 4.5 against white.'; end if;
  if look ? 'accent_dark' and public.nxq_contrast_ratio(look ->> 'accent_dark', '#ffffff') < 4.5 then return 'White text on the dark accent is hard to read: it needs a contrast of at least 4.5 against white.'; end if;
  return null;
end;
$$;
revoke all on function public.nxq_store_look_problem(jsonb) from public, anon, authenticated;

-- The owner's look page can only hold colors, the heading style and a shipped /brand/ logo. When the owner saves it, the client's own background (and their
-- uploaded logo, when the owner's save does not name a logo) must survive. Same function as migration 286 with ONE addition: those pictures are carried over.
-- Owner can still replace the logo by sending one, or remove everything with owner_clear_store_look.
create or replace function public.owner_set_store_look(store_slug_value text, look_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.commerce_storefronts%rowtype;
  problem text;
  cleaned jsonb := '{}'::jsonb;
  existing jsonb;
  k text;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  problem := public.nxq_store_look_problem(look_value);
  if problem is not null then raise exception '%', problem; end if;
  select * into selected from public.commerce_storefronts where store_slug = lower(btrim(coalesce(store_slug_value, ''))) for update;
  if not found then raise exception 'Store not found.'; end if;
  for k in select jsonb_object_keys(look_value) loop
    cleaned := cleaned || jsonb_build_object(k, case when k in ('logo', 'heading_font', 'background', 'background_overlay') then look_value -> k else to_jsonb(lower(look_value ->> k)) end);
  end loop;
  existing := coalesce(selected.settings -> 'look', '{}'::jsonb);
  if not (look_value ? 'background') and existing ? 'background' then cleaned := cleaned || jsonb_build_object('background', existing -> 'background'); end if;
  if not (look_value ? 'background_overlay') and existing ? 'background_overlay' and cleaned ? 'background' then cleaned := cleaned || jsonb_build_object('background_overlay', existing -> 'background_overlay'); end if;
  if not (look_value ? 'logo') and (existing ->> 'logo') like 'https://%' then cleaned := cleaned || jsonb_build_object('logo', existing -> 'logo'); end if;
  update public.commerce_storefronts
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{look}', cleaned, true), updated_at = now()
   where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.client_id, 'owner', 'store_look_set', jsonb_build_object('store_slug', selected.store_slug, 'owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'store_slug', selected.store_slug, 'message', 'Saved the look for ' || selected.store_name || '. It shows on the store page right away.');
end;
$$;
revoke all on function public.owner_set_store_look(text, jsonb) from public, anon;
grant execute on function public.owner_set_store_look(text, jsonb) to authenticated;

-- The signed-in client's own logo and background settings (nothing else from the look).
create or replace function public.get_my_store_media()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  look_value jsonb;
  found_store boolean := false;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  select true, settings -> 'look' into found_store, look_value from public.commerce_storefronts where client_id = client_uuid;
  return jsonb_build_object(
    'has_storefront', coalesce(found_store, false),
    'logo', case when look_value ->> 'logo' like 'https://%' then look_value -> 'logo' else null end,
    'background', look_value -> 'background',
    'background_overlay', look_value -> 'background_overlay',
    'owner_logo', case when look_value ->> 'logo' like '/brand/%' then true else false end
  );
end;
$$;

-- Change the client's own logo / background. media_patch is an object with any of: logo, background, background_overlay.
-- A JSON null removes that setting. The picture must sit in THIS client's own branding folder; everything else in the look is left exactly as it was.
create or replace function public.save_my_store_media(media_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  selected public.commerce_storefronts%rowtype;
  merged jsonb;
  k text; v jsonb; text_value text; problem text;
  own_prefix text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;
  if media_patch is null or jsonb_typeof(media_patch) <> 'object' then raise exception 'Nothing to save.'; end if;
  select * into selected from public.commerce_storefronts where client_id = client_uuid for update;
  if not found then raise exception 'Create your store first.'; end if;
  own_prefix := '/storage/v1/object/public/commerce-website-content/' || client_uuid::text || '/branding/';
  merged := coalesce(selected.settings -> 'look', '{}'::jsonb);
  for k, v in select * from jsonb_each(media_patch) loop
    if k not in ('logo', 'background', 'background_overlay') then raise exception 'You can only change the logo and the background.'; end if;
    if jsonb_typeof(v) = 'null' then
      merged := merged - k;
    elsif k = 'background_overlay' then
      merged := merged || jsonb_build_object(k, v);
    else
      if jsonb_typeof(v) <> 'string' then raise exception 'The % must be a picture link.', k; end if;
      text_value := v #>> '{}';
      if position(own_prefix in text_value) = 0 then raise exception 'The % must be a picture uploaded to your own store folder.', k; end if;
      merged := merged || jsonb_build_object(k, v);
    end if;
  end loop;
  problem := public.nxq_store_look_problem(merged);
  if problem is not null then raise exception '%', problem; end if;
  update public.commerce_storefronts
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{look}', merged, true), updated_at = now()
   where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (client_uuid, 'client', 'store_media_set', jsonb_build_object('store_slug', selected.store_slug, 'changed', (select jsonb_agg(key) from jsonb_object_keys(media_patch) as key)));
  return jsonb_build_object('success', true, 'logo', merged -> 'logo', 'background', merged -> 'background', 'background_overlay', merged -> 'background_overlay',
    'message', 'Saved. It shows on your store page right away.');
end;
$$;

revoke all on function public.get_my_store_media() from public, anon;
revoke all on function public.save_my_store_media(jsonb) from public, anon;
grant execute on function public.get_my_store_media() to authenticated;
grant execute on function public.save_my_store_media(jsonb) to authenticated;
