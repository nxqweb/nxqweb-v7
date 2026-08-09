-- Wave 20: owner-only control/read model for future online billing provider hookup.
create or replace function public.owner_billing_provider_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  providers jsonb:='[]'::jsonb;
  links jsonb:='[]'::jsonb;
  recent_events jsonb:='[]'::jsonb;
  client_options jsonb:='[]'::jsonb;
  readiness jsonb:='{}'::jsonb;
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Owner access required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'provider_key',p.provider_key,'status',p.status,'capabilities',p.capabilities,'required_secret_names',p.required_secret_names,'config',p.config,'last_checked_at',p.last_checked_at,'last_success_at',p.last_success_at,'last_error',p.last_error) order by p.provider_key),'[]'::jsonb) into providers from public.nxq_provider_connections p where p.provider_category='payments';
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'provider_key',l.provider_key,'provider_customer_id',l.provider_customer_id,'client_id',l.client_id,'business_name',c.business_name,'status',l.status,'verified_at',l.verified_at,'created_at',l.created_at,'updated_at',l.updated_at) order by l.updated_at desc),'[]'::jsonb) into links from public.billing_provider_customer_links l join public.clients c on c.id=l.client_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'business_name',c.business_name,'billing_status',c.billing_status,'billing_provider',c.billing_provider) order by c.business_name),'[]'::jsonb) into client_options from public.clients c where c.status::text in ('approved','active');
  select coalesce(jsonb_agg(jsonb_build_object('id',bounded.id,'provider_key',bounded.provider_key,'provider_event_id',bounded.provider_event_id,'provider_customer_id',bounded.provider_customer_id,'client_id',bounded.client_id,'business_name',bounded.business_name,'event_type',bounded.event_type,'amount',bounded.amount,'currency',bounded.currency,'occurred_at',bounded.occurred_at,'received_at',bounded.received_at,'applied',bounded.applied,'ignored',bounded.ignored,'ignore_reason',bounded.ignore_reason,'apply_error',bounded.apply_error) order by bounded.received_at desc),'[]'::jsonb) into recent_events from (select e.*,c.business_name from public.billing_provider_events e join public.clients c on c.id=e.client_id order by e.received_at desc limit 100) bounded;
  select jsonb_build_object('check_key',r.check_key,'required',r.required,'status',r.status,'evidence',r.evidence,'last_checked_at',r.last_checked_at,'checked_by',r.checked_by) into readiness from public.launch_readiness_checks r where r.check_key='billing_provider_hook_ready';
  return jsonb_build_object('providers',providers,'customer_links',links,'client_options',client_options,'recent_events',recent_events,'readiness',coalesce(readiness,'{}'::jsonb),'generated_at',now(),'secret_values_exposed',false,'direct_charge_action_available',false);
end;
$$;

create or replace function public.owner_link_billing_provider_customer(target_provider_key text,target_client_id uuid,target_provider_customer_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare provider_key_value text:=lower(btrim(coalesce(target_provider_key,'')));customer_value text:=btrim(coalesce(target_provider_customer_id,''));link_id uuid;previous_link public.billing_provider_customer_links%rowtype;
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Owner access required.'; end if;
  if provider_key_value !~ '^[a-z0-9][a-z0-9_-]{1,79}$' then raise exception 'Invalid payment provider key.'; end if;
  if length(customer_value)<3 or length(customer_value)>180 then raise exception 'Provider customer id length is invalid.'; end if;
  if not exists(select 1 from public.clients where id=target_client_id) then raise exception 'Client not found.'; end if;
  if not exists(select 1 from public.nxq_provider_connections where provider_key=provider_key_value and provider_category='payments' and status<>'disabled') then raise exception 'Payment provider is not registered and enabled.'; end if;
  if exists(select 1 from public.billing_provider_customer_links where provider_key=provider_key_value and provider_customer_id=customer_value and client_id<>target_client_id and status='active') then raise exception 'Provider customer id is already linked to another NXQ client.'; end if;
  select * into previous_link from public.billing_provider_customer_links where provider_key=provider_key_value and client_id=target_client_id for update;
  if previous_link.id is null then insert into public.billing_provider_customer_links(provider_key,provider_customer_id,client_id,status,verified_at) values(provider_key_value,customer_value,target_client_id,'active',now()) returning id into link_id;
  else update public.billing_provider_customer_links set provider_customer_id=customer_value,status='active',verified_at=now(),updated_at=now() where id=previous_link.id returning id into link_id; end if;
  insert into public.automation_audit_log(client_id,event_type,actor_type,details) values(target_client_id,'billing_provider_customer_linked','owner',jsonb_build_object('provider_key',provider_key_value,'provider_customer_id',customer_value,'link_id',link_id,'replaced_existing_link',previous_link.id is not null,'secret_value_changed',false,'charge_processed',false));
  return jsonb_build_object('ok',true,'link_id',link_id,'provider_key',provider_key_value,'client_id',target_client_id,'provider_customer_id',customer_value,'charge_processed',false);
end;$$;

create or replace function public.owner_set_online_billing_enabled(target_provider_key text,target_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare provider_row public.nxq_provider_connections%rowtype;
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then raise exception 'Owner access required.'; end if;
  select * into provider_row from public.nxq_provider_connections where provider_key=lower(btrim(target_provider_key)) and provider_category='payments' for update;
  if not found then raise exception 'Payment provider connection not found.'; end if;
  update public.nxq_provider_connections set config=coalesce(config,'{}'::jsonb)||jsonb_build_object('online_billing_enabled',target_enabled),updated_at=now() where id=provider_row.id;
  update public.launch_readiness_checks set required=target_enabled,status=case when target_enabled then 'unknown' else 'not_applicable' end,evidence=jsonb_build_object('online_billing_enabled',target_enabled,'manual_billing_supported',true,'pending_runtime_evaluation',target_enabled),updated_at=now(),checked_by='owner-billing-provider-control' where check_key='billing_provider_hook_ready';
  insert into public.automation_audit_log(event_type,actor_type,details) values('online_billing_mode_changed','owner',jsonb_build_object('provider_key',provider_row.provider_key,'online_billing_enabled',target_enabled,'charge_processed',false,'secret_value_changed',false));
  return jsonb_build_object('ok',true,'provider_key',provider_row.provider_key,'online_billing_enabled',target_enabled,'readiness_status',case when target_enabled then 'unknown' else 'not_applicable' end,'charge_processed',false);
end;$$;

revoke all on function public.owner_billing_provider_summary() from public,anon;
revoke all on function public.owner_link_billing_provider_customer(text,uuid,text) from public,anon;
revoke all on function public.owner_set_online_billing_enabled(text,boolean) from public,anon;
grant execute on function public.owner_billing_provider_summary() to authenticated;
grant execute on function public.owner_link_billing_provider_customer(text,uuid,text) to authenticated;
grant execute on function public.owner_set_online_billing_enabled(text,boolean) to authenticated;
comment on function public.owner_billing_provider_summary() is 'Owner-only provider state, server-side customer mappings, bounded event evidence, and readiness. Never exposes secret values or a direct charge action.';
comment on function public.owner_link_billing_provider_customer(text,uuid,text) is 'Owner maps a provider customer reference to one NXQ client. It never processes a charge.';
comment on function public.owner_set_online_billing_enabled(text,boolean) is 'Owner explicitly enables/disables online billing readiness. Enabling does not imply ready and does not process money.';
