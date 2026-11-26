-- Harden Commerce media ownership and client-controlled public links.
-- Uses database triggers so future UI/RPC paths cannot bypass these checks.

create or replace function public.commerce_storage_object_owned_by_client(
  storage_url text,
  expected_bucket text,
  expected_client_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  clean_url text := trim(coalesce(storage_url, ''));
  marker text;
  object_name text;
begin
  if clean_url = '' or expected_bucket is null or expected_client_id is null then
    return false;
  end if;

  if clean_url !~* '^https://[^[:space:]]+$' then
    return false;
  end if;

  marker := '/storage/v1/object/public/' || expected_bucket || '/';
  if position(marker in clean_url) = 0 then
    return false;
  end if;

  object_name := split_part(split_part(clean_url, marker, 2), '?', 1);
  if object_name = '' or split_part(object_name, '/', 1) <> expected_client_id::text then
    return false;
  end if;

  return exists (
    select 1
    from storage.objects o
    where o.bucket_id = expected_bucket
      and o.name = object_name
  );
end;
$$;

create or replace function public.guard_commerce_product_image_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  image_url text;
begin
  new.image_urls := coalesce(new.image_urls, '[]'::jsonb);

  if jsonb_typeof(new.image_urls) <> 'array' then
    raise exception 'Product images must be an array.';
  end if;

  if jsonb_array_length(new.image_urls) > 8 then
    raise exception 'A product can have up to 8 images.';
  end if;

  for image_url in select jsonb_array_elements_text(new.image_urls)
  loop
    if not public.commerce_storage_object_owned_by_client(
      image_url,
      'commerce-product-images',
      new.client_id
    ) then
      raise exception 'Every product image must be an existing image owned by this client workspace.';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists guard_commerce_product_image_ownership_trigger on public.commerce_products;
create trigger guard_commerce_product_image_ownership_trigger
before insert or update of image_urls on public.commerce_products
for each row execute function public.guard_commerce_product_image_ownership();

create or replace function public.guard_commerce_website_content_links()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  url_value text;
begin
  if trim(coalesce(new.custom_page_image_url, '')) <> ''
     and not public.commerce_storage_object_owned_by_client(
       new.custom_page_image_url,
       'commerce-website-content',
       new.client_id
     ) then
    raise exception 'The custom page image must be an existing image owned by this client workspace.';
  end if;

  foreach url_value in array array[
    new.custom_page_button_url,
    new.instagram_url,
    new.facebook_url,
    new.tiktok_url,
    new.youtube_url
  ]
  loop
    if trim(coalesce(url_value, '')) <> ''
       and trim(url_value) !~* '^https://[^[:space:]]+$' then
      raise exception 'Public website links must use a valid HTTPS URL.';
    end if;
  end loop;

  return new;
end;
$$;

-- Remove any previously stored unsafe non-HTTPS public links before enforcing the trigger.
update public.commerce_website_content
set custom_page_button_url = case
      when trim(coalesce(custom_page_button_url, '')) = '' or trim(custom_page_button_url) ~* '^https://[^[:space:]]+$'
        then custom_page_button_url else '' end,
    instagram_url = case
      when trim(coalesce(instagram_url, '')) = '' or trim(instagram_url) ~* '^https://[^[:space:]]+$'
        then instagram_url else '' end,
    facebook_url = case
      when trim(coalesce(facebook_url, '')) = '' or trim(facebook_url) ~* '^https://[^[:space:]]+$'
        then facebook_url else '' end,
    tiktok_url = case
      when trim(coalesce(tiktok_url, '')) = '' or trim(tiktok_url) ~* '^https://[^[:space:]]+$'
        then tiktok_url else '' end,
    youtube_url = case
      when trim(coalesce(youtube_url, '')) = '' or trim(youtube_url) ~* '^https://[^[:space:]]+$'
        then youtube_url else '' end,
    updated_at = now()
where (trim(coalesce(custom_page_button_url, '')) <> '' and trim(custom_page_button_url) !~* '^https://[^[:space:]]+$')
   or (trim(coalesce(instagram_url, '')) <> '' and trim(instagram_url) !~* '^https://[^[:space:]]+$')
   or (trim(coalesce(facebook_url, '')) <> '' and trim(facebook_url) !~* '^https://[^[:space:]]+$')
   or (trim(coalesce(tiktok_url, '')) <> '' and trim(tiktok_url) !~* '^https://[^[:space:]]+$')
   or (trim(coalesce(youtube_url, '')) <> '' and trim(youtube_url) !~* '^https://[^[:space:]]+$');

drop trigger if exists guard_commerce_website_content_links_trigger on public.commerce_website_content;
create trigger guard_commerce_website_content_links_trigger
before insert or update of custom_page_image_url, custom_page_button_url, instagram_url, facebook_url, tiktok_url, youtube_url
on public.commerce_website_content
for each row execute function public.guard_commerce_website_content_links();

revoke all on function public.commerce_storage_object_owned_by_client(text,text,uuid) from public, anon, authenticated;
revoke all on function public.guard_commerce_product_image_ownership() from public, anon, authenticated;
revoke all on function public.guard_commerce_website_content_links() from public, anon, authenticated;
