-- Forward-only display-name migration for the NXQX parent brand and NXQ-* branches.
-- Stable database identifiers, account IDs, slugs, secrets, and historical evidence do not change.

update public.product_families
set name = case slug
  when 'business' then 'NXQ-Business'
  when 'booking' then 'NXQ-Booking'
  when 'commerce' then 'NXQ-Commerce'
  when 'menu' then 'NXQ-Menu'
  when 'property' then 'NXQ-Property'
  when 'multi-location' then 'NXQ-Multi-Location'
  when 'membership' then 'NXQ-Membership'
  when 'enterprise-systems' then 'NXQ-Enterprise Systems'
  else name
end
where slug in ('business','booking','commerce','menu','property','multi-location','membership','enterprise-systems');

update public.nxq_products
set product_name = case product_slug
  when 'web' then 'NXQ-Web'
  when 'systems' then 'NXQ-Systems'
  when 'security' then 'NXQ-Security'
  when 'health' then 'NXQ-Health'
  else product_name
end
where product_slug in ('web','systems','security','health');

update public.nxq_sales_outreach_settings
set sender_display_name = case
      when sender_display_name in ('Christian at NXQ Web','Christian at NXQ-Web') then 'Christian at NXQ-Web'
      else sender_display_name
    end,
    sender_business_name = case
      when sender_business_name in ('NXQ Web','NXQ-Web') then 'NXQ-Web'
      else sender_business_name
    end,
    updated_at = now()
where singleton = true;

-- Only unsent, unapproved drafts may receive the display-name correction.
update public.nxq_sales_outreach_drafts
set subject = replace(subject, 'NXQ Web', 'NXQ-Web'),
    body = replace(body, 'NXQ Web', 'NXQ-Web'),
    rendered_body = case when rendered_body is null then null else replace(rendered_body, 'NXQ Web', 'NXQ-Web') end,
    updated_at = now()
where status in ('draft','needs_review')
  and (subject like '%NXQ Web%' or body like '%NXQ Web%' or coalesce(rendered_body,'') like '%NXQ Web%');

comment on table public.nxq_products is
  'Stable internal product registry. Customer-facing names use NXQ-* branch branding under the NXQX parent company.';
