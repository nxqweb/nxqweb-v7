-- Server-filtered, tenant-derived lead pagination.
-- Prevents client-side filtering of only the newest bounded slice from hiding older matching leads.

create or replace function public.current_client_leads_page(
  target_view text default 'open',
  page_limit integer default 50,
  page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  client_id_value uuid;
  view_value text:=lower(btrim(coalesce(target_view,'open')));
  limit_value integer:=least(greatest(coalesce(page_limit,50),1),100);
  offset_value integer:=greatest(coalesce(page_offset,0),0);
  rows_value jsonb;
  fetched_count integer;
begin
  if auth.role()<>'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;

  select id into client_id_value
  from public.clients
  where auth_user_id=auth.uid()
  order by created_at desc
  limit 1;

  if client_id_value is null then
    raise exception 'Client account was not found.';
  end if;

  if view_value not in ('open','all','new','contacted','qualified','won','lost','spam','archived') then
    raise exception 'Unsupported lead view.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(page_row) order by page_row.created_at desc,page_row.id desc),'[]'::jsonb), count(*)
  into rows_value,fetched_count
  from (
    select
      l.id,l.lead_code,l.status,l.urgency,l.service_key,l.contact_name,
      l.contact_email,l.contact_phone,l.message,l.lead_score,l.created_at
    from public.client_leads l
    where l.client_id=client_id_value
      and (
        view_value='all'
        or (view_value='open' and l.status not in ('won','lost','spam','archived'))
        or (view_value not in ('all','open') and l.status=view_value)
      )
    order by l.created_at desc,l.id desc
    offset offset_value
    limit limit_value+1
  ) page_row;

  return jsonb_build_object(
    'rows', case when fetched_count>limit_value then rows_value - (fetched_count-1) else rows_value end,
    'has_more', fetched_count>limit_value,
    'next_offset', offset_value+least(fetched_count,limit_value),
    'view', view_value
  );
end;
$$;

revoke all on function public.current_client_leads_page(text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.current_client_leads_page(text,integer,integer) to authenticated;

comment on function public.current_client_leads_page(text,integer,integer) is
  'Tenant-derived, server-filtered, bounded lead page. Caller cannot supply a client_id.';

create index if not exists client_leads_client_status_created_idx
on public.client_leads(client_id,status,created_at desc,id desc);

create index if not exists client_leads_client_created_idx
on public.client_leads(client_id,created_at desc,id desc);
