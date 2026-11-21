-- Public lead forms are deny-by-default until a verified production HTTPS origin exists.
update public.business_lead_forms
set status='paused',updated_at=now()
where status='active' and cardinality(allowed_origins)=0;

alter table public.business_lead_forms drop constraint if exists business_lead_forms_active_origin_check;
alter table public.business_lead_forms add constraint business_lead_forms_active_origin_check
check(status<>'active' or cardinality(allowed_origins)>0);

create or replace function public.create_default_business_lead_form(target_client_id uuid,target_project_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare key_value text;
begin
  if not exists(select 1 from public.projects p where p.id=target_project_id and p.client_id=target_client_id) then raise exception 'Project/client mismatch.'; end if;
  insert into public.business_lead_forms(client_id,project_id,form_name,status)
  values(target_client_id,target_project_id,'Primary contact form','paused')
  on conflict(project_id,form_name) do update set updated_at=now()
  returning form_key into key_value;
  return key_value;
end;$$;
revoke all on function public.create_default_business_lead_form(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_default_business_lead_form(uuid,uuid) to service_role;

create or replace function public.sync_business_lead_origin_from_deployment()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  client_uuid uuid;
  origin_value text;
begin
  select client_id into client_uuid from public.projects where id=new.project_id;
  if client_uuid is null then return new; end if;

  if new.last_deployment_status='published' and new.production_url like 'https://%' then
    origin_value:=substring(new.production_url from '^(https://[^/]+)');
    if nullif(origin_value,'') is not null then
      update public.business_lead_forms
      set allowed_origins=array[origin_value],status='active',updated_at=now()
      where project_id=new.project_id and client_id=client_uuid and status<>'retired';
    end if;
  else
    update public.business_lead_forms set status='paused',updated_at=now()
    where project_id=new.project_id and client_id=client_uuid and status='active';
  end if;
  return new;
end;$$;

drop trigger if exists sync_business_lead_origin_from_deployment on public.project_deployment_configs;
create trigger sync_business_lead_origin_from_deployment
after insert or update of production_url,last_deployment_status on public.project_deployment_configs
for each row execute function public.sync_business_lead_origin_from_deployment();

-- Backfill already-verified production deployments.
update public.business_lead_forms f
set allowed_origins=array[substring(d.production_url from '^(https://[^/]+)')],status='active',updated_at=now()
from public.project_deployment_configs d
where d.project_id=f.project_id and d.last_deployment_status='published' and d.production_url like 'https://%'
  and substring(d.production_url from '^(https://[^/]+)') is not null and f.status<>'retired';

comment on function public.sync_business_lead_origin_from_deployment() is 'Automatically activates Business lead intake only for the exact verified production HTTPS origin.';