create table if not exists public.commerce_website_content (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  storefront_id uuid references public.commerce_storefronts(id) on delete cascade,
  announcement_enabled boolean not null default false,
  announcement_text text not null default '',
  homepage_message_enabled boolean not null default false,
  homepage_message_heading text not null default '',
  homepage_message_body text not null default '',
  verse_enabled boolean not null default false,
  verse_text text not null default '',
  verse_reference text not null default '',
  verse_message text not null default '',
  story_heading text not null default '',
  story_body text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  business_hours text not null default '',
  pickup_details text not null default '',
  shipping_policy text not null default '',
  returns_policy text not null default '',
  custom_order_policy text not null default '',
  instagram_url text not null default '',
  facebook_url text not null default '',
  tiktok_url text not null default '',
  youtube_url text not null default '',
  custom_page_addon_enabled boolean not null default false,
  custom_page_title text not null default '',
  custom_page_slug text not null default 'updates',
  custom_page_body text not null default '',
  custom_page_image_url text not null default '',
  custom_page_button_text text not null default '',
  custom_page_button_url text not null default '',
  custom_page_show_in_menu boolean not null default false,
  custom_page_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.commerce_website_content enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'commerce-website-content',
  'commerce-website-content',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "commerce website content client image read" on storage.objects;
drop policy if exists "commerce website content client image insert" on storage.objects;
drop policy if exists "commerce website content client image update" on storage.objects;
drop policy if exists "commerce website content client image delete" on storage.objects;

create policy "commerce website content client image read"
on storage.objects for select to authenticated
using (bucket_id = 'commerce-website-content' and split_part(name, '/', 1) = public.current_client_id()::text);

create policy "commerce website content client image insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'commerce-website-content' and split_part(name, '/', 1) = public.current_client_id()::text);

create policy "commerce website content client image update"
on storage.objects for update to authenticated
using (bucket_id = 'commerce-website-content' and split_part(name, '/', 1) = public.current_client_id()::text)
with check (bucket_id = 'commerce-website-content' and split_part(name, '/', 1) = public.current_client_id()::text);

create policy "commerce website content client image delete"
on storage.objects for delete to authenticated
using (bucket_id = 'commerce-website-content' and split_part(name, '/', 1) = public.current_client_id()::text);

create or replace function public.get_my_commerce_website_content()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  storefront_uuid uuid;
  content_row public.commerce_website_content%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  select id into storefront_uuid from public.commerce_storefronts where client_id = client_uuid limit 1;

  insert into public.commerce_website_content (client_id, storefront_id)
  values (client_uuid, storefront_uuid)
  on conflict (client_id) do update set storefront_id = coalesce(public.commerce_website_content.storefront_id, excluded.storefront_id)
  returning * into content_row;

  return to_jsonb(content_row);
end;
$$;

create or replace function public.save_my_commerce_website_content(content_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  current_row public.commerce_website_content%rowtype;
  clean_slug text;
  clean_image text;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then raise exception 'Client workspace not found.'; end if;

  perform public.get_my_commerce_website_content();
  select * into current_row from public.commerce_website_content where client_id = client_uuid for update;

  clean_slug := lower(regexp_replace(trim(coalesce(content_payload->>'custom_page_slug', 'updates')), '[^a-zA-Z0-9-]+', '-', 'g'));
  clean_slug := trim(both '-' from clean_slug);
  if clean_slug = '' then clean_slug := 'updates'; end if;
  if clean_slug in ('products', 'store', 'cart', 'checkout', 'admin', 'client', 'owner') then
    raise exception 'Choose a different custom page URL.';
  end if;

  clean_image := trim(coalesce(content_payload->>'custom_page_image_url', ''));
  if clean_image <> '' and clean_image !~ '^https://[^[:space:]]+/storage/v1/object/public/commerce-website-content/' then
    raise exception 'The custom page image must come from NXQ website content storage.';
  end if;

  update public.commerce_website_content set
    announcement_enabled = coalesce((content_payload->>'announcement_enabled')::boolean, false),
    announcement_text = left(trim(coalesce(content_payload->>'announcement_text', '')), 300),
    homepage_message_enabled = coalesce((content_payload->>'homepage_message_enabled')::boolean, false),
    homepage_message_heading = left(trim(coalesce(content_payload->>'homepage_message_heading', '')), 120),
    homepage_message_body = left(trim(coalesce(content_payload->>'homepage_message_body', '')), 2000),
    verse_enabled = coalesce((content_payload->>'verse_enabled')::boolean, false),
    verse_text = left(trim(coalesce(content_payload->>'verse_text', '')), 1200),
    verse_reference = left(trim(coalesce(content_payload->>'verse_reference', '')), 120),
    verse_message = left(trim(coalesce(content_payload->>'verse_message', '')), 600),
    story_heading = left(trim(coalesce(content_payload->>'story_heading', '')), 160),
    story_body = left(trim(coalesce(content_payload->>'story_body', '')), 4000),
    contact_phone = left(trim(coalesce(content_payload->>'contact_phone', '')), 80),
    contact_email = left(lower(trim(coalesce(content_payload->>'contact_email', ''))), 200),
    business_hours = left(trim(coalesce(content_payload->>'business_hours', '')), 1000),
    pickup_details = left(trim(coalesce(content_payload->>'pickup_details', '')), 2000),
    shipping_policy = left(trim(coalesce(content_payload->>'shipping_policy', '')), 5000),
    returns_policy = left(trim(coalesce(content_payload->>'returns_policy', '')), 5000),
    custom_order_policy = left(trim(coalesce(content_payload->>'custom_order_policy', '')), 5000),
    instagram_url = left(trim(coalesce(content_payload->>'instagram_url', '')), 500),
    facebook_url = left(trim(coalesce(content_payload->>'facebook_url', '')), 500),
    tiktok_url = left(trim(coalesce(content_payload->>'tiktok_url', '')), 500),
    youtube_url = left(trim(coalesce(content_payload->>'youtube_url', '')), 500),
    custom_page_title = left(trim(coalesce(content_payload->>'custom_page_title', '')), 160),
    custom_page_slug = clean_slug,
    custom_page_body = left(trim(coalesce(content_payload->>'custom_page_body', '')), 12000),
    custom_page_image_url = clean_image,
    custom_page_button_text = left(trim(coalesce(content_payload->>'custom_page_button_text', '')), 80),
    custom_page_button_url = left(trim(coalesce(content_payload->>'custom_page_button_url', '')), 500),
    custom_page_show_in_menu = coalesce((content_payload->>'custom_page_show_in_menu')::boolean, false),
    custom_page_published = case when current_row.custom_page_addon_enabled then coalesce((content_payload->>'custom_page_published')::boolean, false) else false end,
    updated_at = now()
  where client_id = client_uuid;

  return (select to_jsonb(c) from public.commerce_website_content c where c.client_id = client_uuid);
end;
$$;

create or replace function public.get_public_commerce_website_content(store_slug_value text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'announcement', jsonb_build_object('enabled', c.announcement_enabled, 'text', c.announcement_text),
    'homepage_message', jsonb_build_object('enabled', c.homepage_message_enabled, 'heading', c.homepage_message_heading, 'body', c.homepage_message_body),
    'verse', jsonb_build_object('enabled', c.verse_enabled, 'text', c.verse_text, 'reference', c.verse_reference, 'message', c.verse_message),
    'story', jsonb_build_object('heading', c.story_heading, 'body', c.story_body),
    'contact', jsonb_build_object('phone', c.contact_phone, 'email', c.contact_email, 'business_hours', c.business_hours, 'pickup_details', c.pickup_details),
    'policies', jsonb_build_object('shipping', c.shipping_policy, 'returns', c.returns_policy, 'custom_orders', c.custom_order_policy),
    'social', jsonb_build_object('instagram', c.instagram_url, 'facebook', c.facebook_url, 'tiktok', c.tiktok_url, 'youtube', c.youtube_url),
    'custom_page', case when c.custom_page_addon_enabled and c.custom_page_published then jsonb_build_object(
      'enabled', true,
      'title', c.custom_page_title,
      'slug', c.custom_page_slug,
      'body', c.custom_page_body,
      'image_url', c.custom_page_image_url,
      'button_text', c.custom_page_button_text,
      'button_url', c.custom_page_button_url,
      'show_in_menu', c.custom_page_show_in_menu
    ) else jsonb_build_object('enabled', false) end
  )
  from public.commerce_website_content c
  join public.commerce_storefronts s on s.id = c.storefront_id
  where s.store_slug = store_slug_value and s.status = 'active'
$$;

revoke all on function public.get_my_commerce_website_content() from public, anon;
revoke all on function public.save_my_commerce_website_content(jsonb) from public, anon;
revoke all on function public.get_public_commerce_website_content(text) from public;
grant execute on function public.get_my_commerce_website_content() to authenticated;
grant execute on function public.save_my_commerce_website_content(jsonb) to authenticated;
grant execute on function public.get_public_commerce_website_content(text) to anon, authenticated;
