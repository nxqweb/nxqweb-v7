-- 286: each store's look (colors, heading style, logo) lives in the database instead of the code. Written 2026-10-29 on the owner's decision (no code change per client).
--   * Stored in commerce_storefronts.settings -> 'look' (jsonb), next to 'profile'. Other settings are never touched (jsonb_set on one key).
--   * Only the OWNER can set it (owner_set_store_look / owner_clear_store_look); shoppers read it with get_public_store_look, which returns the look and nothing else.
--   * Safety rules enforced here, so a bad value can never reach a shopper's page: only the known keys; colors are #rrggbb; the text/background pairs must be readable (contrast 4.5:1,
--     the same bar the accessibility scan uses); the logo can only be a file that ships with the site under /brand/ (no outside web addresses, no scripts).
--   * Seeds the one existing look (Light of the World), previously hardcoded in src/lib/storeBranding.ts, so her store looks the same after this is applied.
-- Adds: nxq_color_luminance(text), nxq_contrast_ratio(text,text), nxq_store_look_problem(jsonb) (all internal), nxq_valid_store_look(jsonb) (internal), owner_set_store_look(text,jsonb), owner_clear_store_look(text), get_public_store_look(text) (public).

create or replace function public.nxq_color_luminance(color text)
returns numeric
language sql
immutable
set search_path = public
as $$
  -- relative luminance of one #rrggbb color (WCAG 2.x)
  select 0.2126 * l.r + 0.7152 * l.g + 0.0722 * l.b
  from (select
    case when c.r <= 0.03928 then c.r / 12.92 else power((c.r + 0.055) / 1.055, 2.4) end as r,
    case when c.g <= 0.03928 then c.g / 12.92 else power((c.g + 0.055) / 1.055, 2.4) end as g,
    case when c.b <= 0.03928 then c.b / 12.92 else power((c.b + 0.055) / 1.055, 2.4) end as b
    from (select (('x' || substr(color, 2, 2))::bit(8)::integer) / 255.0 as r,
                 (('x' || substr(color, 4, 2))::bit(8)::integer) / 255.0 as g,
                 (('x' || substr(color, 6, 2))::bit(8)::integer) / 255.0 as b) c) l
$$;
revoke all on function public.nxq_color_luminance(text) from public, anon, authenticated;

create or replace function public.nxq_contrast_ratio(color_a text, color_b text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select (greatest(public.nxq_color_luminance(color_a), public.nxq_color_luminance(color_b)) + 0.05)
       / (least(public.nxq_color_luminance(color_a), public.nxq_color_luminance(color_b)) + 0.05)
$$;
revoke all on function public.nxq_contrast_ratio(text, text) from public, anon, authenticated;

-- returns an error message, or null when the look is acceptable
create or replace function public.nxq_store_look_problem(look jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  k text; v text;
  color_keys text[] := array['bg','surface','tint','ink','muted','line','accent','accent_dark'];
begin
  if look is null or jsonb_typeof(look) <> 'object' then return 'The look must be an object.'; end if;
  for k in select jsonb_object_keys(look) loop
    if not (k = any (color_keys || array['logo','heading_font'])) then return 'Unknown look setting: ' || left(k, 40); end if;
  end loop;
  foreach k in array color_keys loop
    if look ? k then
      if jsonb_typeof(look -> k) <> 'string' or (look ->> k) !~ '^#[0-9a-fA-F]{6}$' then return k || ' must be a color like #1d2f4f.'; end if;
    end if;
  end loop;
  if look ? 'heading_font' and (look ->> 'heading_font') not in ('serif', 'sans') then return 'heading_font must be serif or sans.'; end if;
  if look ? 'logo' then
    v := look ->> 'logo';
    if jsonb_typeof(look -> 'logo') <> 'string' or v !~ '^/brand/[a-z0-9][a-z0-9._-]{0,80}\.(png|jpg|jpeg|webp|svg)$' or v like '%..%' then return 'The logo must be a file under /brand/ (for example /brand/shop-logo.png).'; end if;
  end if;
  if look ? 'ink' and look ? 'bg' and public.nxq_contrast_ratio(look ->> 'ink', look ->> 'bg') < 4.5 then return 'Text (ink) on the page background is hard to read: it needs a contrast of at least 4.5.'; end if;
  if look ? 'muted' and look ? 'bg' and public.nxq_contrast_ratio(look ->> 'muted', look ->> 'bg') < 4.5 then return 'Soft text (muted) on the page background is hard to read: it needs a contrast of at least 4.5.'; end if;
  if look ? 'accent' and public.nxq_contrast_ratio(look ->> 'accent', '#ffffff') < 4.5 then return 'White text on the accent color is hard to read: the accent needs a contrast of at least 4.5 against white.'; end if;
  if look ? 'accent_dark' and public.nxq_contrast_ratio(look ->> 'accent_dark', '#ffffff') < 4.5 then return 'White text on the dark accent is hard to read: it needs a contrast of at least 4.5 against white.'; end if;
  return null;
end;
$$;
revoke all on function public.nxq_store_look_problem(jsonb) from public, anon, authenticated;

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
  k text;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  problem := public.nxq_store_look_problem(look_value);
  if problem is not null then raise exception '%', problem; end if;
  select * into selected from public.commerce_storefronts where store_slug = lower(btrim(coalesce(store_slug_value, ''))) for update;
  if not found then raise exception 'Store not found.'; end if;
  for k in select jsonb_object_keys(look_value) loop
    cleaned := cleaned || jsonb_build_object(k, case when k in ('logo', 'heading_font') then look_value -> k else to_jsonb(lower(look_value ->> k)) end);
  end loop;
  update public.commerce_storefronts
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{look}', cleaned, true), updated_at = now()
   where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.client_id, 'owner', 'store_look_set', jsonb_build_object('store_slug', selected.store_slug, 'owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'store_slug', selected.store_slug, 'message', 'Saved the look for ' || selected.store_name || '. It shows on the store page right away.');
end;
$$;

create or replace function public.owner_clear_store_look(store_slug_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare selected public.commerce_storefronts%rowtype;
begin
  if not exists (select 1 from public.owner_users where auth_user_id = auth.uid()) then raise exception 'Owner access required.'; end if;
  select * into selected from public.commerce_storefronts where store_slug = lower(btrim(coalesce(store_slug_value, ''))) for update;
  if not found then raise exception 'Store not found.'; end if;
  update public.commerce_storefronts set settings = coalesce(settings, '{}'::jsonb) - 'look', updated_at = now() where id = selected.id;
  insert into public.activity_logs(client_id, actor_type, action, details)
  values (selected.client_id, 'owner', 'store_look_cleared', jsonb_build_object('store_slug', selected.store_slug, 'owner_auth_user_id', auth.uid()));
  return jsonb_build_object('success', true, 'store_slug', selected.store_slug, 'message', selected.store_name || ' is back to the default look.');
end;
$$;

-- Shoppers: the look of an open store, and nothing else from its settings. Returns {} when the store has none.
create or replace function public.get_public_store_look(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.settings -> 'look' from public.commerce_storefronts s
    where s.store_slug = lower(btrim(coalesce(store_slug_value, ''))) and s.status = 'active' limit 1), '{}'::jsonb)
$$;

revoke all on function public.owner_set_store_look(text, jsonb) from public, anon;
revoke all on function public.owner_clear_store_look(text) from public, anon;
revoke all on function public.get_public_store_look(text) from public;
grant execute on function public.owner_set_store_look(text, jsonb) to authenticated;
grant execute on function public.owner_clear_store_look(text) to authenticated;
grant execute on function public.get_public_store_look(text) to anon, authenticated;

-- Seed: Light of the World (this was hardcoded in src/lib/storeBranding.ts). Same values, so her store looks the same.
update public.commerce_storefronts
   set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{look}', jsonb_build_object(
     'bg', '#fdf9f6', 'surface', '#ffffff', 'tint', '#f8ece8', 'ink', '#1d2f4f', 'muted', '#4f5b73', 'line', '#eaddd8',
     'accent', '#a8284f', 'accent_dark', '#861f3e', 'heading_font', 'serif', 'logo', '/brand/light-of-the-world-logo.png'), true)
 where store_slug like 'light-of-the-world%' and not (coalesce(settings, '{}'::jsonb) ? 'look');
