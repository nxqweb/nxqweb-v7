-- Wave 11: remove legacy duplicate AI classification enqueue from client change submission.
-- Risk classification + routing is now authoritative in migration 137 triggers.

create or replace function public.submit_current_client_change_request(
  target_project_id uuid,
  target_request_type text,
  target_title text,
  target_description text,
  target_priority text default 'normal',
  target_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  client_uuid uuid;
  request_uuid uuid;
begin
  select id into client_uuid
  from public.clients
  where auth_user_id=auth.uid()
  order by created_at desc
  limit 1;

  if client_uuid is null then raise exception 'Client account not found.'; end if;
  if not exists(select 1 from public.projects p where p.id=target_project_id and p.client_id=client_uuid) then
    raise exception 'Project does not belong to the current client.';
  end if;
  if target_request_type not in ('content','image','service','pricing','new_page','domain','seo','design','location','other') then
    raise exception 'Unsupported change request type.';
  end if;
  if length(btrim(coalesce(target_title,'')))<3 or length(target_title)>160 then raise exception 'Title length is invalid.'; end if;
  if length(btrim(coalesce(target_description,'')))<5 or length(target_description)>6000 then raise exception 'Description length is invalid.'; end if;
  if target_priority not in ('low','normal','high','urgent') then raise exception 'Priority is invalid.'; end if;

  insert into public.website_change_requests(
    client_id,project_id,request_type,title,description,priority,
    requested_by_auth_user_id,requested_payload
  ) values(
    client_uuid,target_project_id,target_request_type,btrim(target_title),btrim(target_description),target_priority,
    auth.uid(),coalesce(target_payload,'{}'::jsonb)
  ) returning id into request_uuid;

  -- Do not enqueue here. classify_change_request_risk + route_submitted_change_request
  -- are the single routing authority and choose exactly one safe lane.
  return request_uuid;
end;
$$;

revoke all on function public.submit_current_client_change_request(uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.submit_current_client_change_request(uuid,text,text,text,text,jsonb) to authenticated;

comment on function public.submit_current_client_change_request(uuid,text,text,text,text,jsonb) is 'Creates one tenant-owned change request. Trigger-based risk classification/routing is the single queue authority, preventing duplicate AI + Edge jobs.';
