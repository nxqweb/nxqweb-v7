-- Additive: one new read-only function, no table or column changes.
-- Purpose: let a client see WHERE their leads come from (UTM source / medium / campaign) without exposing any personal data.
-- client_leads.source is always 'website' (hard-coded by ingest-business-lead) and client_leads.utm is stored but never returned
-- by any client RPC; this function returns aggregated, sanitized counts only.
--
-- Security notes
--  * Caller must be a signed-in client; only that client's own leads are counted (same lookup as current_client_leads_page).
--  * utm comes from a PUBLIC website form, so every value is treated as untrusted: lower-cased, reduced to [a-z0-9 _.+-], max 60 chars.
--  * No contact name, email, phone or message is ever returned.
--  * Spam leads are excluded. EXECUTE is granted to authenticated only.

create or replace function public.current_client_lead_sources(target_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  client_id_value uuid;
  days_value integer := least(greatest(coalesce(target_days, 90), 1), 365);
  since_value timestamptz;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;

  select id into client_id_value
  from public.clients
  where auth_user_id = auth.uid()
  order by created_at desc
  limit 1;

  if client_id_value is null then
    raise exception 'Client account was not found.';
  end if;

  since_value := now() - make_interval(days => days_value);

  return (
    with lead_rows as materialized (
      select
        nullif(left(regexp_replace(lower(btrim(coalesce(l.source, ''))), '[^a-z0-9 _.+-]', '', 'g'), 60), '') as channel,
        nullif(left(regexp_replace(lower(btrim(coalesce(l.utm ->> 'utm_source', ''))), '[^a-z0-9 _.+-]', '', 'g'), 60), '') as utm_source,
        nullif(left(regexp_replace(lower(btrim(coalesce(l.utm ->> 'utm_medium', ''))), '[^a-z0-9 _.+-]', '', 'g'), 60), '') as utm_medium,
        nullif(left(regexp_replace(lower(btrim(coalesce(l.utm ->> 'utm_campaign', ''))), '[^a-z0-9 _.+-]', '', 'g'), 60), '') as utm_campaign,
        (l.status = 'won') as won
      from public.client_leads l
      where l.client_id = client_id_value
        and l.status <> 'spam'
        and l.created_at >= since_value
    )
    select jsonb_build_object(
      'days', days_value,
      'total', (select count(*)::integer from lead_rows),
      'tagged', (select count(*)::integer from lead_rows where utm_source is not null or utm_medium is not null or utm_campaign is not null),
      'channels', coalesce((select jsonb_agg(jsonb_build_object('value', t.v, 'leads', t.leads, 'won', t.won) order by t.leads desc, t.v nulls last)
        from (select channel as v, count(*)::integer as leads, (count(*) filter (where won))::integer as won from lead_rows group by channel order by count(*) desc, channel nulls last limit 10) t), '[]'::jsonb),
      'sources', coalesce((select jsonb_agg(jsonb_build_object('value', t.v, 'leads', t.leads, 'won', t.won) order by t.leads desc, t.v nulls last)
        from (select utm_source as v, count(*)::integer as leads, (count(*) filter (where won))::integer as won from lead_rows group by utm_source order by count(*) desc, utm_source nulls last limit 10) t), '[]'::jsonb),
      'mediums', coalesce((select jsonb_agg(jsonb_build_object('value', t.v, 'leads', t.leads, 'won', t.won) order by t.leads desc, t.v nulls last)
        from (select utm_medium as v, count(*)::integer as leads, (count(*) filter (where won))::integer as won from lead_rows group by utm_medium order by count(*) desc, utm_medium nulls last limit 10) t), '[]'::jsonb),
      'campaigns', coalesce((select jsonb_agg(jsonb_build_object('value', t.v, 'leads', t.leads, 'won', t.won) order by t.leads desc, t.v nulls last)
        from (select utm_campaign as v, count(*)::integer as leads, (count(*) filter (where won))::integer as won from lead_rows group by utm_campaign order by count(*) desc, utm_campaign nulls last limit 10) t), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.current_client_lead_sources(integer) from public, anon, authenticated, service_role;
grant execute on function public.current_client_lead_sources(integer) to authenticated;

comment on function public.current_client_lead_sources(integer) is
  'Aggregated, sanitized lead channel / UTM source / medium / campaign counts for the signed-in client. Returns no personal data. Spam excluded.';
