-- Owner-safe provider health controls.
-- These never expose or mutate provider secret values.

create or replace function public.owner_request_provider_recheck(target_connection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare row_data public.nxq_provider_connections%rowtype;
begin
  if not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then raise exception 'Owner access required.'; end if;
  update public.nxq_provider_connections
  set status=case when status='disabled' then 'disabled' else 'configured' end,
      last_checked_at=null,
      last_error=null,
      updated_at=now()
  where id=target_connection_id
  returning * into row_data;
  if row_data.id is null then raise exception 'Provider connection not found.'; end if;
  insert into public.automation_audit_log(event_type,actor_type,details)
  values('provider_health_recheck_requested','owner',jsonb_build_object('provider_connection_id',row_data.id,'provider_key',row_data.provider_key));
  return jsonb_build_object('ok',true,'provider_connection_id',row_data.id,'provider_key',row_data.provider_key,'status',row_data.status,'health_recheck_requested',row_data.status<>'disabled');
end;
$$;

create or replace function public.owner_set_provider_enabled(target_connection_id uuid,target_enabled boolean,target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare row_data public.nxq_provider_connections%rowtype;
begin
  if not exists(select 1 from public.owner_users ou where ou.auth_user_id=auth.uid()) then raise exception 'Owner access required.'; end if;
  update public.nxq_provider_connections
  set status=case when target_enabled then 'configured' else 'disabled' end,
      last_checked_at=null,
      last_error=case when target_enabled then null else left(coalesce(target_reason,'Disabled by owner.'),1000) end,
      updated_at=now()
  where id=target_connection_id
  returning * into row_data;
  if row_data.id is null then raise exception 'Provider connection not found.'; end if;
  insert into public.automation_audit_log(event_type,actor_type,details)
  values(case when target_enabled then 'provider_enabled' else 'provider_disabled' end,'owner',jsonb_build_object('provider_connection_id',row_data.id,'provider_key',row_data.provider_key,'reason',target_reason));
  return jsonb_build_object('ok',true,'provider_connection_id',row_data.id,'provider_key',row_data.provider_key,'status',row_data.status);
end;
$$;

revoke all on function public.owner_request_provider_recheck(uuid) from public,anon;
revoke all on function public.owner_set_provider_enabled(uuid,boolean,text) from public,anon;
grant execute on function public.owner_request_provider_recheck(uuid) to authenticated;
grant execute on function public.owner_set_provider_enabled(uuid,boolean,text) to authenticated;
