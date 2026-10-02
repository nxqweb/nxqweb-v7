-- Analytics collection is deny-by-default until a verified production HTTPS origin exists.
update public.website_analytics_profiles set status='paused',updated_at=now()
where status='enabled' and cardinality(allowed_origins)=0;

alter table public.website_analytics_profiles drop constraint if exists website_analytics_profiles_enabled_origin_check;
alter table public.website_analytics_profiles add constraint website_analytics_profiles_enabled_origin_check
check(status<>'enabled' or cardinality(allowed_origins)>0);

create or replace function public.configure_website_analytics_for_project(target_client_id uuid,target_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  advanced_access jsonb;mouse_access jsonb;profile_row public.website_analytics_profiles%rowtype;production_origin text;
begin
  if auth.role()<>'service_role' and not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Owner or service-role access required.'; end if;
  if not exists(select 1 from public.projects p where p.id=target_project_id and p.client_id=target_client_id) then raise exception 'Project/client relationship not found.'; end if;
  advanced_access:=public.client_feature_access(target_client_id,'advanced_analytics');mouse_access:=public.client_feature_access(target_client_id,'mouse_tracking');
  select substring(d.production_url from '^(https://[^/]+)') into production_origin from public.project_deployment_configs d where d.project_id=target_project_id and d.last_deployment_status='published' and d.production_url like 'https://%';
  insert into public.website_analytics_profiles(client_id,project_id,status,consent_mode,page_view_enabled,click_enabled,scroll_depth_enabled,mouse_tracking_enabled,retention_days,allowed_origins)
  values(target_client_id,target_project_id,case when coalesce((advanced_access->>'allowed')::boolean,false) and production_origin is not null then 'enabled' when coalesce((advanced_access->>'allowed')::boolean,false) then 'paused' else 'disabled' end,'required',true,true,true,coalesce((mouse_access->>'allowed')::boolean,false),case when coalesce((mouse_access->>'allowed')::boolean,false) then 90 else 30 end,case when production_origin is null then '{}'::text[] else array[production_origin] end)
  on conflict(project_id) do update set status=excluded.status,mouse_tracking_enabled=excluded.mouse_tracking_enabled,retention_days=excluded.retention_days,allowed_origins=excluded.allowed_origins,updated_at=now()
  returning * into profile_row;
  return jsonb_build_object('ok',true,'analytics_profile_id',profile_row.id,'status',profile_row.status,'mouse_tracking_enabled',profile_row.mouse_tracking_enabled,'consent_mode',profile_row.consent_mode,'retention_days',profile_row.retention_days,'allowed_origins',profile_row.allowed_origins);
end;$$;
revoke all on function public.configure_website_analytics_for_project(uuid,uuid) from public,anon,authenticated;
grant execute on function public.configure_website_analytics_for_project(uuid,uuid) to service_role,authenticated;

create or replace function public.sync_business_analytics_origin_from_deployment()
returns trigger language plpgsql security definer set search_path=public as $$
declare client_uuid uuid;origin_value text;advanced_access jsonb;
begin
  select client_id into client_uuid from public.projects where id=new.project_id;if client_uuid is null then return new;end if;
  advanced_access:=public.client_feature_access(client_uuid,'advanced_analytics');
  if new.last_deployment_status='published' and new.production_url like 'https://%' then
    origin_value:=substring(new.production_url from '^(https://[^/]+)');
    update public.website_analytics_profiles set allowed_origins=case when origin_value is null then '{}'::text[] else array[origin_value] end,status=case when origin_value is not null and coalesce((advanced_access->>'allowed')::boolean,false) then 'enabled' else 'disabled' end,updated_at=now() where project_id=new.project_id and client_id=client_uuid;
  else
    update public.website_analytics_profiles set status=case when coalesce((advanced_access->>'allowed')::boolean,false) then 'paused' else 'disabled' end,allowed_origins='{}'::text[],updated_at=now() where project_id=new.project_id and client_id=client_uuid;
  end if;
  return new;
end;$$;
drop trigger if exists sync_business_analytics_origin_from_deployment on public.project_deployment_configs;
create trigger sync_business_analytics_origin_from_deployment after insert or update of production_url,last_deployment_status on public.project_deployment_configs for each row execute function public.sync_business_analytics_origin_from_deployment();

comment on function public.sync_business_analytics_origin_from_deployment() is 'Enables entitled privacy-safe analytics only after a verified production HTTPS origin exists.';