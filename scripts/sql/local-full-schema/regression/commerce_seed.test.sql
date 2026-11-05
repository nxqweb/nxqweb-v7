-- Regression test for scripts/sql/commerce-seed.sql (the owner-run script that fills ONE client's Commerce store through her own dashboard functions).
-- Rolled back. Proves, on a real database: the store, payment link, pretty web name and products are created and the store goes live; a second run UPDATES instead of duplicating;
-- the script refuses an unknown email, an unapproved client, a client whose billing is not active, a QA-only client, a taken web name and a bad payment link, and it changes nothing when it refuses.
-- The SQL block below must stay word for word the same as the block in scripts/sql/commerce-seed.sql (scripts/test-commerce-seed.mjs checks that). Must end by selecting DRAFT_TEST_OK.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','candle@synthetic.invalid','',now(),'{}','{"business_name":"Glow Candle Co"}'),
 ('eeeeeeee-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pending@synthetic.invalid','',now(),'{}','{"business_name":"Pending Candles"}'),
 ('eeeeeeee-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nobilling@synthetic.invalid','',now(),'{}','{"business_name":"No Billing Candles"}'),
 ('eeeeeeee-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa@synthetic.invalid','',now(),'{}','{"business_name":"QA Candles"}'),
 ('eeeeeeee-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@synthetic.invalid','',now(),'{}','{"business_name":"Other Store"}');
update public.clients set contact_email = business_name;
update public.clients set contact_email = case business_name when 'Glow Candle Co' then 'candle@synthetic.invalid' when 'Pending Candles' then 'pending@synthetic.invalid' when 'No Billing Candles' then 'nobilling@synthetic.invalid' when 'QA Candles' then 'qa@synthetic.invalid' else 'other@synthetic.invalid' end;
update public.clients set status = 'approved' where business_name in ('Glow Candle Co', 'No Billing Candles', 'Other Store');
update public.clients set billing_status = 'active', billing_provider = 'manual' where business_name in ('Glow Candle Co', 'Pending Candles', 'Other Store');

create function pg_temp.run_seed() returns void language plpgsql as $nxqseed$
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
end
$nxqseed$;

-- the happy path: store, payment link, pretty web name, two products, store live
select set_config('nxq.commerce_seed', $nxq${"client_email":"candle@synthetic.invalid","store_name":"Glow Candle Co","store_slug":"glow-candle-co","stripe_payment_link":"https://buy.stripe.com/test123ABC","payment_note":"Pay by link, ships in 3 days","make_live":true,"products":[
 {"name":"Lavender Calm","short_description":"Soy candle","description":"Hand poured soy candle with lavender.","base_price":24.00,"featured":true,"attributes":[{"label":"Scent","value":"Lavender"}],"variants":[{"title":"8 oz","price":24.00,"inventory_quantity":20},{"title":"12 oz","price":32.00,"inventory_quantity":10}]},
 {"name":"Vanilla Bean Soap","short_description":"Bar soap","description":"Cold process vanilla soap.","base_price":9.50,"featured":false,"variants":[{"title":"Bar","price":9.50,"inventory_quantity":40}]}]}$nxq$, false);
select pg_temp.run_seed();
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
do $$ declare s record; n int; v int; img text; begin
  select * into s from public.commerce_storefronts where store_slug = 'glow-candle-co';
  if s.id is null then raise exception 'the pretty web name was not applied'; end if;
  if s.store_name <> 'Glow Candle Co' or s.status <> 'active' then raise exception 'store not live or misnamed: % %', s.store_name, s.status; end if;
  if s.payment_provider <> 'stripe_payment_link' or s.settings->>'stripe_payment_link' <> 'https://buy.stripe.com/test123ABC' then raise exception 'payment link not saved: %', s.settings; end if;
  if s.public_payment_note <> 'Pay by link, ships in 3 days' then raise exception 'payment note not saved'; end if;
  select count(*) into n from public.commerce_products p where p.client_id = s.client_id;
  if n <> 2 then raise exception 'expected 2 products, got %', n; end if;
  select count(*) into n from public.commerce_products p where p.client_id = s.client_id and p.status = 'active';
  if n <> 2 then raise exception 'expected both products visible (active), got %', n; end if;
  select count(*) into v from public.commerce_product_variants pv join public.commerce_products p on p.id = pv.product_id where p.client_id = s.client_id;
  if v <> 3 then raise exception 'expected 3 variants, got %', v; end if;
  if (select base_price from public.commerce_products where client_id = s.client_id and name = 'Lavender Calm') <> 24.00 then raise exception 'price wrong'; end if;
end $$;

-- the public storefront function shows it (what a customer's browser gets)
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;
do $$ declare r jsonb; begin
  r := public.get_public_stripe_ready_commerce_storefront('glow-candle-co');
  if r is null or r::text not like '%Lavender Calm%' or r::text not like '%Vanilla Bean Soap%' then raise exception 'public storefront does not list the products: %', r; end if;
end $$;
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- a second run with a changed price UPDATES (no duplicates)
select set_config('nxq.commerce_seed', $nxq${"client_email":"candle@synthetic.invalid","store_name":"Glow Candle Co","store_slug":"glow-candle-co","stripe_payment_link":"https://buy.stripe.com/test123ABC","payment_note":"Pay by link, ships in 3 days","make_live":true,"products":[
 {"name":"Lavender Calm","short_description":"Soy candle, updated","description":"Hand poured soy candle with lavender.","base_price":26.00,"featured":true,"attributes":[{"label":"Scent","value":"Lavender"}],"variants":[{"title":"8 oz","price":24.00,"inventory_quantity":20},{"title":"12 oz","price":32.00,"inventory_quantity":10}]},
 {"name":"Vanilla Bean Soap","short_description":"Bar soap","description":"Cold process vanilla soap.","base_price":9.50,"featured":false,"variants":[{"title":"Bar","price":9.50,"inventory_quantity":40}]}]}$nxq$, false);
select pg_temp.run_seed();
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
do $$ declare n int; begin
  select count(*) into n from public.commerce_products p join public.clients c on c.id = p.client_id where c.business_name = 'Glow Candle Co';
  if n <> 2 then raise exception 'a re-run duplicated products: %', n; end if;
  if (select base_price from public.commerce_products p join public.clients c on c.id = p.client_id where c.business_name = 'Glow Candle Co' and p.name = 'Lavender Calm') <> 26.00 then raise exception 'the re-run did not update the price'; end if;
end $$;

-- refusals (each leaves everything unchanged)
do $$ begin
  perform set_config('nxq.commerce_seed', $nxq${"client_email":"nobody@synthetic.invalid","store_name":"X","products":[]}$nxq$, false);
  begin perform pg_temp.run_seed(); raise exception 'the seed should have refused: unknown email';
  exception when others then if sqlerrm not like '%No client has the contact email%' then raise exception 'unknown email: wrong refusal message: %', sqlerrm; end if; end;
end $$;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform set_config('nxq.commerce_seed', $nxq${"client_email":"pending@synthetic.invalid","store_name":"X","products":[]}$nxq$, false);
  begin perform pg_temp.run_seed(); raise exception 'the seed should have refused: not approved';
  exception when others then if sqlerrm not like '%not approved yet%' then raise exception 'not approved: wrong refusal message: %', sqlerrm; end if; end;
end $$;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform set_config('nxq.commerce_seed', $nxq${"client_email":"nobilling@synthetic.invalid","store_name":"X","products":[]}$nxq$, false);
  begin perform pg_temp.run_seed(); raise exception 'the seed should have refused: billing not active';
  exception when others then if sqlerrm not like '%billing is not active%' then raise exception 'billing not active: wrong refusal message: %', sqlerrm; end if; end;
end $$;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
update public.clients set status = 'approved', billing_status = 'active', billing_provider = 'manual' where business_name = 'QA Candles';
update public.clients set qa_only = true, monthly_price = 0, billing_status = 'not_configured', billing_provider = null where business_name = 'QA Candles';
do $$ begin
  perform set_config('nxq.commerce_seed', $nxq${"client_email":"qa@synthetic.invalid","store_name":"X","products":[]}$nxq$, false);
  begin perform pg_temp.run_seed(); raise exception 'the seed should have refused: QA-only';
  exception when others then if sqlerrm not like '%QA-only%' then raise exception 'QA-only: wrong refusal message: %', sqlerrm; end if; end;
end $$;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
do $$ begin perform set_config('request.jwt.claim.sub', '', true); end $$;
-- a second real client takes a web name, then the first tries to take it too
select set_config('nxq.commerce_seed', $nxq${"client_email":"other@synthetic.invalid","store_name":"Other Store","store_slug":"taken-name","stripe_payment_link":"https://buy.stripe.com/other1","make_live":false,"products":[]}$nxq$, false);
select pg_temp.run_seed();
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform set_config('nxq.commerce_seed', $nxq${"client_email":"candle@synthetic.invalid","store_name":"Glow Candle Co","store_slug":"taken-name","stripe_payment_link":"https://buy.stripe.com/test123ABC","products":[]}$nxq$, false);
  begin perform pg_temp.run_seed(); raise exception 'the seed should have refused: taken web name';
  exception when others then if sqlerrm not like '%already taken%' then raise exception 'taken web name: wrong refusal message: %', sqlerrm; end if; end;
end $$;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform set_config('nxq.commerce_seed', $nxq${"client_email":"candle@synthetic.invalid","store_name":"Glow Candle Co","stripe_payment_link":"https://evil.example.com/pay","products":[]}$nxq$, false);
  begin perform pg_temp.run_seed(); raise exception 'the seed should have refused: bad payment link';
  exception when others then if sqlerrm not like '%Stripe Payment Link%' then raise exception 'bad payment link: wrong refusal message: %', sqlerrm; end if; end;
end $$;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform set_config('nxq.commerce_seed', $nxq${"client_email":"candle@synthetic.invalid","store_name":"Glow Candle Co","store_slug":"Bad Name!","stripe_payment_link":"https://buy.stripe.com/test123ABC","products":[]}$nxq$, false);
  begin perform pg_temp.run_seed(); raise exception 'the seed should have refused: bad web name';
  exception when others then if sqlerrm not like '%store_slug must be%' then raise exception 'bad web name: wrong refusal message: %', sqlerrm; end if; end;
end $$;
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);
do $$ declare s record; begin
  select * into s from public.commerce_storefronts where store_slug = 'glow-candle-co';
  if s.id is null or s.status <> 'active' or s.settings->>'stripe_payment_link' <> 'https://buy.stripe.com/test123ABC' then raise exception 'a refused run changed the store: %', s; end if;
  if (select count(*) from public.commerce_storefronts where store_slug = 'taken-name') <> 1 then raise exception 'taken web name should still belong to exactly one store'; end if;
end $$;

rollback;
select 'DRAFT_TEST_OK';
