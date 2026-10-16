-- Migration 269: optional public store profile for NXQX-Commerce stores (About text and contact details). Promoted from draft 05 on 2026-10-16 (owner approved in chat); applied to staging only after a separate explicit approval and the guarded workflow.
--
-- Why: today a customer on a client's store cannot reach the shop owner at all. This lets the owner add a short "About" and how to
-- contact them, shown at the bottom of their public store. Everything is optional and opt-in: nothing is published until the owner
-- types it, and only while the store is open (status 'active').
--
-- What it adds (three functions, no tables, no change to any existing function):
--   get_my_store_profile()                      the signed-in owner reads their own profile
--   save_my_store_profile(about, email, phone, social_url)   the signed-in owner saves it (all four optional, empty clears)
--   get_public_store_profile(store_slug)        anyone can read the profile of an OPEN store; only these four fields, never payment links
--
-- Where it lives: commerce_storefronts.settings -> 'profile' (jsonb). The existing payment-settings function merges into settings with ||,
-- so saving payment links keeps the profile; the draft test proves it.
-- Validation keeps junk and markup out: About max 600 chars; email must look like an email; phone digits and + ( ) - . only, max 40; the
-- social link must be https:// with no spaces or angle brackets, max 300. The page renders everything as plain text.

create or replace function public.get_my_store_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_row public.commerce_storefronts%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  select * into storefront_row from public.commerce_storefronts where client_id = client_uuid;
  if storefront_row.id is null then
    return jsonb_build_object('has_storefront', false, 'about', null, 'contact_email', null, 'contact_phone', null, 'social_url', null);
  end if;

  return jsonb_build_object(
    'has_storefront', true,
    'about', storefront_row.settings -> 'profile' ->> 'about',
    'contact_email', storefront_row.settings -> 'profile' ->> 'contact_email',
    'contact_phone', storefront_row.settings -> 'profile' ->> 'contact_phone',
    'social_url', storefront_row.settings -> 'profile' ->> 'social_url'
  );
end;
$$;

create or replace function public.save_my_store_profile(
  about_value text default null,
  contact_email_value text default null,
  contact_phone_value text default null,
  social_url_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  clean_about text := nullif(btrim(coalesce(about_value, '')), '');
  clean_email text := nullif(lower(btrim(coalesce(contact_email_value, ''))), '');
  clean_phone text := nullif(btrim(coalesce(contact_phone_value, '')), '');
  clean_social text := nullif(btrim(coalesce(social_url_value, '')), '');
  changed integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  if clean_about is not null and length(clean_about) > 600 then raise exception 'About text must be 600 characters or fewer.'; end if;
  if clean_email is not null and (length(clean_email) > 254 or clean_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$') then raise exception 'Enter a valid contact email.'; end if;
  if clean_phone is not null and (length(clean_phone) > 40 or clean_phone !~ '^[0-9+()\-.\s]+$') then raise exception 'Enter a valid contact phone number.'; end if;
  if clean_social is not null and (length(clean_social) > 300 or clean_social !~* '^https://[^\s<>"]+$') then raise exception 'Enter a social link that starts with https://.'; end if;

  update public.commerce_storefronts
  set settings = jsonb_set(
        coalesce(settings, '{}'::jsonb),
        '{profile}',
        jsonb_strip_nulls(jsonb_build_object('about', clean_about, 'contact_email', clean_email, 'contact_phone', clean_phone, 'social_url', clean_social)),
        true
      ),
      updated_at = now()
  where client_id = client_uuid;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'Create your storefront first.'; end if;

  return public.get_my_store_profile();
end;
$$;

-- Public read: only an OPEN store, only the four profile fields. An unknown or not-open store returns null (reveals nothing).
create or replace function public.get_public_store_profile(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'about', s.settings -> 'profile' ->> 'about',
    'contact_email', s.settings -> 'profile' ->> 'contact_email',
    'contact_phone', s.settings -> 'profile' ->> 'contact_phone',
    'social_url', s.settings -> 'profile' ->> 'social_url'
  ))
  from public.commerce_storefronts s
  where s.store_slug = store_slug_value and s.status = 'active'
$$;

revoke all on function public.get_my_store_profile() from public, anon;
revoke all on function public.save_my_store_profile(text, text, text, text) from public, anon;
revoke all on function public.get_public_store_profile(text) from public;
grant execute on function public.get_my_store_profile() to authenticated;
grant execute on function public.save_my_store_profile(text, text, text, text) to authenticated;
grant execute on function public.get_public_store_profile(text) to anon, authenticated;

comment on function public.get_public_store_profile(text) is
  'Public About and contact details of an open store. Returns only the four profile fields, never payment links or settings.';
