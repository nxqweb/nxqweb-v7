-- !!! UNTESTED DRAFT (2026-10-15). Not yet run against the local full-schema harness. Do NOT run on staging until a passing test exists. !!!
-- Owner script: sets up ONE client's Commerce store (store settings, payment link, products) through the SAME functions the client's own
-- dashboard uses, so every normal rule applies. Paste into the Supabase SQL editor of the STAGING project. Re-running is safe: a product with the
-- same name is updated, not duplicated.
--
-- HOW TO USE: build the two lines below with `node scripts/make-commerce-seed.mjs her-info.json` (it prints this whole script with her details filled
-- in), or edit the JSON by hand. The first statement stores her details for this session only; the block after it reads them.
--
-- Needs, in this order: her account exists, the owner approved her website setup (clients.status approved), and the complimentary billing step
-- (docs/OWNER_COMPLIMENTARY_BILLING_ACTIVATION.md) made billing active. The block stops with a plain message if either is missing.
--
-- seed JSON shape:
--   { "client_email": "her contact email", "store_name": "Her Store", "store_slug": "her-store" (optional, pretty web name),
--     "stripe_payment_link": "https://buy.stripe.com/...", "paypal_url": "", "venmo_url": "", "payment_note": "How to pay / shipping note",
--     "make_live": true,
--     "products": [ { "name": "...", "short_description": "...", "description": "...", "base_price": 24.00, "featured": false,
--                     "image_url": "https://... (optional)", "attributes": [ {"label": "Scent", "value": "Lavender"} ],
--                     "variants": [ {"title": "8 oz", "price": 24.00, "inventory_quantity": 20} ] } ] }
--
-- select set_config('nxq.commerce_seed', $nxq$ {...json...} $nxq$, false);   -- <- the generator writes this line for you

do $$
declare
  seed jsonb := nullif(current_setting('nxq.commerce_seed', true), '')::jsonb;
  c record;
  prod jsonb;
  existing uuid;
  saved jsonb;
  product_id uuid;
  made int := 0;
  updated int := 0;
  slug_wanted text;
  final_slug text;
  stripe_link text;
begin
  if seed is null or jsonb_typeof(seed) <> 'object' then
    raise exception 'Run the select set_config(''nxq.commerce_seed'', ...) line first (in the same run as this block).';
  end if;
  if nullif(btrim(seed->>'client_email'), '') is null then raise exception 'client_email is required.'; end if;
  if nullif(btrim(seed->>'store_name'), '') is null then raise exception 'store_name is required.'; end if;
  if jsonb_typeof(coalesce(seed->'products', '[]'::jsonb)) <> 'array' then raise exception 'products must be a list.'; end if;

  select cl.id, cl.auth_user_id, cl.status, cl.billing_status, coalesce(cl.qa_only, false) as qa_only into c
  from public.clients cl
  where lower(cl.contact_email) = lower(btrim(seed->>'client_email'));
  if c.id is null then raise exception 'No client has the contact email %. Create her account first.', seed->>'client_email'; end if;
  if (select count(*) from public.clients where lower(contact_email) = lower(btrim(seed->>'client_email'))) <> 1 then
    raise exception 'More than one client has that contact email; refusing to guess.';
  end if;
  if c.qa_only then raise exception 'That is a QA-only test client. Use a real client.'; end if;
  if c.status not in ('approved', 'active', 'overdue') then
    raise exception 'She is not approved yet (status: %). Approve her website setup in the owner portal first.', c.status;
  end if;
  if c.billing_status::text not in ('active', 'past_due') then
    raise exception 'Her billing is not active yet (billing: %). Run the complimentary billing step first.', c.billing_status;
  end if;

  -- Act as HER (same trick as the billing runbook), so current_client_id() and every rule inside the client functions apply.
  perform set_config('request.jwt.claim.sub', c.auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', c.auth_user_id, 'role', 'authenticated')::text, true);

  stripe_link := nullif(btrim(coalesce(seed->>'stripe_payment_link', '')), '');
  perform public.save_my_stripe_ready_storefront_settings(
    btrim(seed->>'store_name'), stripe_link,
    nullif(btrim(coalesce(seed->>'paypal_url', '')), ''), nullif(btrim(coalesce(seed->>'venmo_url', '')), ''),
    nullif(btrim(coalesce(seed->>'payment_note', '')), ''), false);

  for prod in select * from jsonb_array_elements(coalesce(seed->'products', '[]'::jsonb)) loop
    existing := null;
    select p.id into existing from public.commerce_products p
    where p.client_id = c.id and lower(p.name) = lower(btrim(prod->>'name')) limit 1;
    saved := public.save_my_commerce_product(
      (prod - 'image_url') || case when existing is null then '{}'::jsonb else jsonb_build_object('id', existing) end);
    product_id := (saved->>'id')::uuid;
    perform public.set_my_commerce_product_live(product_id, true, nullif(btrim(coalesce(prod->>'image_url', '')), ''));
    if existing is null then made := made + 1; else updated := updated + 1; end if;
  end loop;

  -- A pretty web name (optional). The default includes her client id; this replaces it when she wants /store/her-store.
  slug_wanted := nullif(lower(btrim(coalesce(seed->>'store_slug', ''))), '');
  if slug_wanted is not null then
    if slug_wanted !~ '^[a-z0-9][a-z0-9-]{2,60}$' then raise exception 'store_slug must be 3-61 letters, numbers or dashes.'; end if;
    if exists (select 1 from public.commerce_storefronts where store_slug = slug_wanted and client_id <> c.id) then
      raise exception 'The web name % is already taken.', slug_wanted;
    end if;
    update public.commerce_storefronts set store_slug = slug_wanted where client_id = c.id;
  end if;

  if coalesce((seed->>'make_live')::boolean, false) then
    perform public.save_my_stripe_ready_storefront_settings(
      btrim(seed->>'store_name'), stripe_link,
      nullif(btrim(coalesce(seed->>'paypal_url', '')), ''), nullif(btrim(coalesce(seed->>'venmo_url', '')), ''),
      nullif(btrim(coalesce(seed->>'payment_note', '')), ''), true);
  end if;

  select store_slug into final_slug from public.commerce_storefronts where client_id = c.id;
  raise notice 'DONE: % product(s) created, % updated. Store is %. Public page: /store/%',
    made, updated, case when coalesce((seed->>'make_live')::boolean, false) then 'LIVE' else 'a DRAFT (not public yet)' end, final_slug;
end $$;
