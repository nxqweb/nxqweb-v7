-- DRAFT 04 (not applied; migrations are a hard stop-and-ask gate). Forward-only.
-- Purpose: owner decision 2026-10-05 - every customer-facing "NXQ" brand name becomes "NXQX".
-- Migration 232 stored NXQ-* display names; this renames the DISPLAY values only.
-- Stable identifiers (slugs, ids, table/column names, secret names, nxq_accounts) do NOT change.

update public.product_families
set name = case slug
  when 'business' then 'NXQX-Business'
  when 'booking' then 'NXQX-Booking'
  when 'commerce' then 'NXQX-Commerce'
  when 'menu' then 'NXQX-Menu'
  when 'property' then 'NXQX-Property'
  when 'multi-location' then 'NXQX-Multi-Location'
  when 'membership' then 'NXQX-Membership'
  when 'enterprise-systems' then 'NXQX-Enterprise Systems'
  else name
end
where slug in ('business','booking','commerce','menu','property','multi-location','membership','enterprise-systems');

update public.nxq_products
set product_name = case product_slug
  when 'web' then 'NXQX-Web'
  when 'systems' then 'NXQX-Systems'
  when 'security' then 'NXQX-Security'
  when 'health' then 'NXQX-Health'
  else product_name
end
where product_slug in ('web','systems','security','health');

update public.nxq_sales_outreach_settings
set sender_display_name = case
      when sender_display_name in ('Christian at NXQ Web','Christian at NXQ-Web') then 'Christian at NXQX-Web'
      else sender_display_name
    end,
    sender_business_name = case
      when sender_business_name in ('NXQ Web','NXQ-Web') then 'NXQX-Web'
      else sender_business_name
    end,
    updated_at = now()
where singleton = true;

-- Only unsent, unapproved drafts may be rewritten; approved/sent outreach is never touched.
update public.nxq_sales_outreach_drafts
set subject = replace(replace(subject, 'NXQ Web', 'NXQX-Web'), 'NXQ-Web', 'NXQX-Web'),
    body = replace(replace(body, 'NXQ Web', 'NXQX-Web'), 'NXQ-Web', 'NXQX-Web'),
    rendered_body = case when rendered_body is null then null
                         else replace(replace(rendered_body, 'NXQ Web', 'NXQX-Web'), 'NXQ-Web', 'NXQX-Web') end,
    updated_at = now()
where status in ('draft','needs_review');

comment on table public.nxq_products is
  'Stable internal product registry. Customer-facing names use NXQX-* branding under the NXQX parent company.';
