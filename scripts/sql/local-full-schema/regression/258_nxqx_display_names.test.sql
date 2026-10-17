-- Regression test for migration 258. Rolled back. Proves the NXQX display names are in place, stable identifiers did not change,
-- and the outreach rewrite only touches unsent drafts and is safe to apply twice.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$ declare
  fam record; prod record; n int; pid uuid;
  d_draft uuid; d_review uuid; d_sent uuid; d_approved uuid; r record;
begin
  -- product family display names (slug is the stable identifier and must be unchanged)
  for fam in select * from (values
    ('business','NXQX-Business'),('booking','NXQX-Booking'),('commerce','NXQX-Commerce'),('menu','NXQX-Menu'),
    ('property','NXQX-Property'),('multi-location','NXQX-Multi-Location'),('membership','NXQX-Membership'),
    ('enterprise-systems','NXQX-Enterprise Systems')) as t(slug, expected)
  loop
    if not exists (select 1 from public.product_families where slug = fam.slug) then
      raise exception 'product family slug % is missing (identifiers must not change, and a missing row would make this test vacuous)', fam.slug;
    end if;
    if not exists (select 1 from public.product_families where slug = fam.slug and name = fam.expected) then
      raise exception 'product family % display name is not %', fam.slug, fam.expected;
    end if;
  end loop;
  if exists (select 1 from public.product_families where name ~ '^NXQ-') then raise exception 'an old NXQ- family name remains'; end if;

  -- internal product registry display names
  for prod in select * from (values
    ('web','NXQX-Web'),('systems','NXQX-Systems'),('security','NXQX-Security'),('health','NXQX-Health')) as t(slug, expected)
  loop
    if not exists (select 1 from public.nxq_products where product_slug = prod.slug and product_name = prod.expected) then
      raise exception 'product % display name is not %', prod.slug, prod.expected;
    end if;
  end loop;
  if exists (select 1 from public.nxq_products where product_name ~ '^NXQ-') then raise exception 'an old NXQ- product name remains'; end if;

  -- stable identifiers: table and column names are untouched
  if to_regclass('public.nxq_accounts') is null or to_regclass('public.nxq_products') is null then raise exception 'a stable nxq_ table is gone'; end if;
  if to_regclass('public.nxqx_accounts') is not null then raise exception 'a table was renamed (must never happen)'; end if;

  -- outreach rewrite: only unsent, unapproved drafts change. Fixtures first.
  insert into public.nxq_sales_prospects(business_name) values ('Rewrite Test Tree Care') returning id into pid;
  insert into public.nxq_sales_outreach_drafts(prospect_id, channel, sequence_step, subject, body, status) values (pid,'email',1,'Hi from NXQ Web','Hello from NXQ Web and NXQ-Web','draft') returning id into d_draft;
  insert into public.nxq_sales_outreach_drafts(prospect_id, channel, sequence_step, subject, body, status) values (pid,'email',2,'Hi from NXQ-Web','NXQ-Web here','needs_review') returning id into d_review;
  insert into public.nxq_sales_outreach_drafts(prospect_id, channel, sequence_step, subject, body, status) values (pid,'email',3,'Sent from NXQ-Web','NXQ-Web body','sent') returning id into d_sent;
  insert into public.nxq_sales_outreach_drafts(prospect_id, channel, sequence_step, subject, body, status) values (pid,'email',4,'Approved NXQ Web','NXQ Web body','approved') returning id into d_approved;
  update public.nxq_sales_outreach_settings set sender_display_name = 'Christian at NXQ-Web', sender_business_name = 'NXQ Web' where singleton = true;

  -- the same statements the draft runs (kept identical on purpose; run twice to prove idempotence)
  for n in 1..2 loop
    update public.nxq_sales_outreach_settings
    set sender_display_name = case when sender_display_name in ('Christian at NXQ Web','Christian at NXQ-Web') then 'Christian at NXQX-Web' else sender_display_name end,
        sender_business_name = case when sender_business_name in ('NXQ Web','NXQ-Web') then 'NXQX-Web' else sender_business_name end,
        updated_at = now()
    where singleton = true;
    update public.nxq_sales_outreach_drafts
    set subject = replace(replace(subject, 'NXQ Web', 'NXQX-Web'), 'NXQ-Web', 'NXQX-Web'),
        body = replace(replace(body, 'NXQ Web', 'NXQX-Web'), 'NXQ-Web', 'NXQX-Web'),
        rendered_body = case when rendered_body is null then null else replace(replace(rendered_body, 'NXQ Web', 'NXQX-Web'), 'NXQ-Web', 'NXQX-Web') end,
        updated_at = now()
    where status in ('draft','needs_review');
  end loop;

  select subject, body into r from public.nxq_sales_outreach_drafts where id = d_draft;
  if r.subject <> 'Hi from NXQX-Web' or r.body <> 'Hello from NXQX-Web and NXQX-Web' then raise exception 'draft not rewritten correctly: % / %', r.subject, r.body; end if;
  select subject, body into r from public.nxq_sales_outreach_drafts where id = d_review;
  if r.subject <> 'Hi from NXQX-Web' or r.body <> 'NXQX-Web here' then raise exception 'needs_review draft not rewritten correctly: % / %', r.subject, r.body; end if;
  select subject, body into r from public.nxq_sales_outreach_drafts where id = d_sent;
  if r.subject <> 'Sent from NXQ-Web' or r.body <> 'NXQ-Web body' then raise exception 'SENT outreach was rewritten (must never happen)'; end if;
  select subject, body into r from public.nxq_sales_outreach_drafts where id = d_approved;
  if r.subject <> 'Approved NXQ Web' or r.body <> 'NXQ Web body' then raise exception 'APPROVED outreach was rewritten (must never happen)'; end if;
  if exists (select 1 from public.nxq_sales_outreach_drafts where id in (d_draft, d_review) and (subject like '%NXQXX%' or body like '%NXQXX%')) then raise exception 'double application corrupted the text'; end if;
  if not exists (select 1 from public.nxq_sales_outreach_settings where singleton = true and sender_display_name = 'Christian at NXQX-Web' and sender_business_name = 'NXQX-Web') then
    raise exception 'sender settings were not renamed';
  end if;
end $$;

select 'DRAFT_TEST_OK';
rollback;
