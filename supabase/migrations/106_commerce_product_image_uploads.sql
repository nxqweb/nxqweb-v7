insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'commerce-product-images',
  'commerce-product-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "commerce product images client read" on storage.objects;
drop policy if exists "commerce product images client insert" on storage.objects;
drop policy if exists "commerce product images client update" on storage.objects;
drop policy if exists "commerce product images client delete" on storage.objects;

create policy "commerce product images client read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'commerce-product-images'
  and split_part(name, '/', 1) = public.current_client_id()::text
);

create policy "commerce product images client insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'commerce-product-images'
  and split_part(name, '/', 1) = public.current_client_id()::text
);

create policy "commerce product images client update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'commerce-product-images'
  and split_part(name, '/', 1) = public.current_client_id()::text
)
with check (
  bucket_id = 'commerce-product-images'
  and split_part(name, '/', 1) = public.current_client_id()::text
);

create policy "commerce product images client delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'commerce-product-images'
  and split_part(name, '/', 1) = public.current_client_id()::text
);

create or replace function public.get_my_commerce_product_images(product_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  product_row public.commerce_products%rowtype;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  select * into product_row
  from public.commerce_products
  where id = product_uuid and client_id = client_uuid;

  if product_row.id is null then
    raise exception 'Product was not found.';
  end if;

  return jsonb_build_object(
    'client_id', client_uuid,
    'product_id', product_row.id,
    'image_urls', coalesce(product_row.image_urls, '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_my_commerce_product_images(
  product_uuid uuid,
  image_urls_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_uuid uuid;
  image_url text;
  image_count integer;
begin
  client_uuid := public.current_client_id();
  if client_uuid is null then
    raise exception 'Client workspace not found.';
  end if;

  if jsonb_typeof(image_urls_payload) <> 'array' then
    raise exception 'Product images must be an array.';
  end if;

  image_count := jsonb_array_length(image_urls_payload);
  if image_count > 8 then
    raise exception 'A product can have up to 8 images.';
  end if;

  for image_url in select jsonb_array_elements_text(image_urls_payload)
  loop
    if image_url !~ '^https://[^[:space:]]+/storage/v1/object/public/commerce-product-images/' then
      raise exception 'Every product image must come from protected NXQ product storage.';
    end if;
  end loop;

  update public.commerce_products
  set image_urls = image_urls_payload,
      updated_at = now()
  where id = product_uuid and client_id = client_uuid;

  if not found then
    raise exception 'Product was not found.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'product_id', product_uuid,
    'image_urls', image_urls_payload
  );
end;
$$;

revoke all on function public.get_my_commerce_product_images(uuid) from public, anon;
revoke all on function public.save_my_commerce_product_images(uuid, jsonb) from public, anon;
grant execute on function public.get_my_commerce_product_images(uuid) to authenticated;
grant execute on function public.save_my_commerce_product_images(uuid, jsonb) to authenticated;
