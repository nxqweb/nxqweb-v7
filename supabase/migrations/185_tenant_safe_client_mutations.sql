-- Close the final direct client table mutations and repair the captured file
-- metadata shape used by the portals. All tenant identity, timestamps, quotas,
-- lifecycle evidence, and audit rows are now server-derived.

alter table public.client_files
  add column if not exists bucket_id text not null default 'client-files',
  add column if not exists status text not null default 'uploaded',
  add column if not exists uploaded_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz;

update public.client_files
set bucket_id=coalesce(nullif(bucket_id,''),nullif(bucket_name,''),'client-files'),
    status=coalesce(nullif(status,''),'uploaded'),
    uploaded_at=coalesce(uploaded_at,created_at,now())
where bucket_id is null or bucket_id='' or status is null or status='' or uploaded_at is null;

create index if not exists client_files_bucket_path_idx
on public.client_files(bucket_id,storage_path);

create or replace function public.current_client_update_lead_status(
  target_lead_id uuid,
  target_status text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  client_row public.clients%rowtype;
  lead_row public.client_leads%rowtype;
  status_value text:=lower(btrim(coalesce(target_status,'')));
begin
  if auth.role()<>'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id=auth.uid() for update;
  if not found then raise exception 'Client account was not found.'; end if;
  if client_row.qa_only or client_row.pipeline_stopped_at is not null
     or client_row.status::text not in ('approved','active','overdue') then
    raise exception 'Client lifecycle does not allow lead updates.';
  end if;
  if status_value not in ('new','contacted','qualified','won','lost','spam','archived') then
    raise exception 'Unsupported lead status.';
  end if;
  select * into lead_row from public.client_leads
  where id=target_lead_id and client_id=client_row.id for update;
  if not found then raise exception 'Lead was not found in this client workspace.'; end if;
  if lead_row.status=status_value then return to_jsonb(lead_row); end if;
  if lead_row.status='archived' then raise exception 'Archived leads cannot be changed.'; end if;

  update public.client_leads set
    status=status_value,
    contacted_at=case when status_value='contacted' then coalesce(contacted_at,now()) else contacted_at end,
    converted_at=case when status_value='won' then coalesce(converted_at,now()) else converted_at end,
    updated_at=now()
  where id=lead_row.id returning * into lead_row;

  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(client_row.id,'client_lead_status_changed','client',jsonb_build_object(
    'lead_id',lead_row.id,'lead_code',lead_row.lead_code,'status',lead_row.status,
    'server_timestamped',true,'external_notification_sent',false
  ));
  return to_jsonb(lead_row);
end;
$$;

create or replace function public.current_client_create_location(
  target_display_name text,
  target_city text,
  target_state_region text,
  target_postal_code text default null,
  target_phone text default null,
  target_email text default null,
  target_service_area text default null,
  target_services text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  client_row public.clients%rowtype;
  tier_key_value text;
  location_row public.client_locations%rowtype;
  display_value text:=btrim(coalesce(target_display_name,''));
  city_value text:=btrim(coalesce(target_city,''));
  region_value text:=btrim(coalesce(target_state_region,''));
  postal_value text:=nullif(btrim(coalesce(target_postal_code,'')),'');
  phone_value text:=nullif(btrim(coalesce(target_phone,'')),'');
  email_value text:=nullif(lower(btrim(coalesce(target_email,''))),'');
  area_value text:=nullif(btrim(coalesce(target_service_area,'')),'');
  base_slug text;
  slug_value text;
  code_value text;
  location_count integer;
  location_limit integer;
  service_value text;
  service_slug_value text;
  normalized_services text[]:=array[]::text[];
begin
  if auth.role()<>'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id=auth.uid() for update;
  if not found then raise exception 'Client account was not found.'; end if;
  if client_row.qa_only or client_row.pipeline_stopped_at is not null
     or client_row.status::text not in ('approved','active') then
    raise exception 'Client lifecycle does not allow location changes.';
  end if;
  select tier_key into tier_key_value from public.product_family_tiers
  where id=client_row.product_tier_id and product_family_id=client_row.product_family_id;
  if tier_key_value is null then raise exception 'An active Business tier is required.'; end if;
  location_limit:=case when tier_key_value='enterprise' then 100 else 1 end;
  select count(*) into location_count from public.client_locations
  where client_id=client_row.id and status<>'closed';
  if location_count>=location_limit then
    raise exception 'Current plan location limit reached (%). Request Enterprise for multi-location support.',location_limit;
  end if;
  if display_value='' then display_value:=concat_ws(', ',city_value,region_value); end if;
  if length(display_value) not between 2 and 120
     or length(city_value) not between 2 and 100
     or length(region_value) not between 2 and 100 then
    raise exception 'Location name, city, and state/region are required.';
  end if;
  if postal_value is not null and length(postal_value)>20 then raise exception 'Postal code is too long.'; end if;
  if phone_value is not null and (length(phone_value)>40 or phone_value !~ '^[0-9+(). xX-]+$') then
    raise exception 'Phone number contains unsupported characters.';
  end if;
  if email_value is not null and (length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Email address is invalid.';
  end if;
  if area_value is not null and length(area_value)>500 then raise exception 'Service area is too long.'; end if;
  if coalesce(array_length(target_services,1),0)>30 then raise exception 'A location supports at most 30 services.'; end if;

  foreach service_value in array coalesce(target_services,array[]::text[]) loop
    service_value:=btrim(service_value);
    if service_value<>'' and length(service_value)<=120 and not service_value=any(normalized_services) then
      normalized_services:=array_append(normalized_services,service_value);
    end if;
  end loop;

  base_slug:=left(trim(both '-' from regexp_replace(lower(city_value||'-'||region_value||'-'||display_value),'[^a-z0-9]+','-','g')),80);
  if base_slug='' then base_slug:='location'; end if;
  slug_value:=base_slug;
  if exists(select 1 from public.client_locations where client_id=client_row.id and seo_slug=slug_value) then
    slug_value:=left(base_slug,80)||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
  end if;
  code_value:='LOC-'||upper(left(regexp_replace(slug_value,'[^a-z0-9]','','g'),12))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.client_locations(
    client_id,location_code,display_name,is_primary,status,city,state_region,
    postal_code,phone,email,service_area,seo_slug,seo_title,seo_description
  ) values(
    client_row.id,code_value,display_value,location_count=0,'active',city_value,region_value,
    postal_value,phone_value,email_value,area_value,slug_value,
    left(display_value||' | '||city_value||', '||region_value,160),
    left('Professional services from '||display_value||' in '||city_value||', '||region_value||'.',155)
  ) returning * into location_row;

  foreach service_value in array normalized_services loop
    service_slug_value:=left(trim(both '-' from regexp_replace(lower(service_value),'[^a-z0-9]+','-','g')),100);
    if service_slug_value<>'' then
      insert into public.client_location_services(
        client_id,location_id,service_name,service_slug,summary
      ) values(
        client_row.id,location_row.id,service_value,service_slug_value,
        left(service_value||' available from this location.',500)
      ) on conflict(location_id,service_slug) do nothing;
    end if;
  end loop;

  insert into public.automation_audit_log(client_id,event_type,actor_type,details)
  values(client_row.id,'client_location_created','client',jsonb_build_object(
    'location_id',location_row.id,'location_code',location_row.location_code,
    'seo_slug',location_row.seo_slug,'service_count',cardinality(normalized_services),
    'tier_key',tier_key_value,'location_limit',location_limit,'atomic',true
  ));
  return jsonb_build_object('ok',true,'location',to_jsonb(location_row),'service_count',cardinality(normalized_services));
end;
$$;

create or replace function public.current_client_register_uploaded_file(
  target_storage_path text,
  target_file_name text,
  target_file_type text,
  target_file_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path=public,storage
as $$
declare
  client_row public.clients%rowtype;
  file_row public.client_files%rowtype;
  path_value text:=btrim(coalesce(target_storage_path,''));
  name_value text:=btrim(coalesce(target_file_name,''));
  type_value text:=lower(btrim(coalesce(target_file_type,'')));
  allowed_types constant text[]:=array[
    'application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
begin
  if auth.role()<>'authenticated' or auth.uid() is null then
    raise exception 'Authenticated client access required.';
  end if;
  select * into client_row from public.clients where auth_user_id=auth.uid() for update;
  if not found then raise exception 'Client account was not found.'; end if;
  if client_row.qa_only or client_row.pipeline_stopped_at is not null
     or client_row.status::text in ('denied','frozen','dormant','archived') then
    raise exception 'Client lifecycle does not allow file uploads.';
  end if;
  if path_value='' or split_part(path_value,'/',1)<>client_row.id::text
     or path_value like '%..%' or path_value like '/%' or path_value like '%//%' then
    raise exception 'Storage path does not match this client workspace.';
  end if;
  if length(name_value) not between 1 and 255 or name_value like '%/%' or position(chr(92) in name_value)>0 then
    raise exception 'File name is invalid.';
  end if;
  if target_file_size is null or target_file_size<1 or target_file_size>26214400 then
    raise exception 'File size must be between 1 byte and 25 MB.';
  end if;
  if not type_value=any(allowed_types) then raise exception 'This file type is not supported.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='client-files' and name=path_value) then
    raise exception 'Uploaded storage object was not found.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('client-file:'||path_value,0));
  if exists(select 1 from public.client_files where bucket_id='client-files' and storage_path=path_value) then
    raise exception 'This uploaded file is already registered.';
  end if;

  insert into public.client_files(
    client_id,bucket_name,bucket_id,storage_path,file_name,file_type,file_size,
    status,uploaded_at,expires_at
  ) values(
    client_row.id,'client-files','client-files',path_value,name_value,type_value,target_file_size,
    'uploaded',now(),now()+interval '30 days'
  ) returning * into file_row;

  insert into public.activity_logs(client_id,actor_type,action,details)
  values(client_row.id,'client','client_file_uploaded',jsonb_build_object(
    'file_id',file_row.id,'file_name',name_value,'file_path',path_value,
    'file_size',target_file_size,'file_type',type_value,'expires_in_days',30,
    'quarantine_required',true,'server_authoritative',true
  ));
  return jsonb_build_object('ok',true,'file',to_jsonb(file_row),'quarantine_status','restricted');
end;
$$;

revoke insert,update,delete on public.client_leads from authenticated;
revoke insert,update,delete on public.client_locations from authenticated;
revoke insert,update,delete on public.client_location_services from authenticated;
revoke insert,update,delete on public.client_files from authenticated;
revoke insert,update,delete on public.activity_logs from authenticated;

revoke all on function public.current_client_update_lead_status(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.current_client_create_location(text,text,text,text,text,text,text,text[]) from public,anon,authenticated,service_role;
revoke all on function public.current_client_register_uploaded_file(text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.current_client_update_lead_status(uuid,text) to authenticated;
grant execute on function public.current_client_create_location(text,text,text,text,text,text,text,text[]) to authenticated;
grant execute on function public.current_client_register_uploaded_file(text,text,text,bigint) to authenticated;

comment on function public.current_client_update_lead_status(uuid,text) is
  'Tenant-derived client lead status transition with server timestamps and audit evidence.';
comment on function public.current_client_create_location(text,text,text,text,text,text,text,text[]) is
  'Atomic tenant-derived location/service creation with standard-tier and Enterprise limits.';
comment on function public.current_client_register_uploaded_file(text,text,text,bigint) is
  'Registers an existing client-owned private object and queues its mandatory quarantine scan.';
