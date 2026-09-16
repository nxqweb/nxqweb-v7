-- Route a change to deterministic Edge work only when the entire structured
-- patch is supported and correctly typed. Mixed or malformed patches must go
-- through classification instead of consuming retries in the Edge worker.

create or replace function public.route_submitted_change_request()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  patch jsonb:=coalesce(new.requested_payload->'patch','{}'::jsonb);
  structured_safe boolean:=false;
begin
  if new.status<>'submitted' or (tg_op='UPDATE' and old.status='submitted') then return new; end if;

  if not public.nxq_automation_scope_allowed('client',new.client_id::text) then
    update public.website_change_requests
    set status='blocked',last_error='Client automation is paused by governance.',updated_at=now()
    where id=new.id;
    return new;
  end if;

  if jsonb_typeof(patch)='object' and patch<>'{}'::jsonb then
    select not exists (
      select 1
      from jsonb_each(patch) as item(key,value)
      where item.key not in (
        'contact_phone','contact_email','service_area','goals','desired_style','about',
        'add_services','remove_services'
      )
      or case
        when item.key in ('add_services','remove_services') then jsonb_typeof(item.value)<>'array'
        else jsonb_typeof(item.value)<>'string'
      end
    ) into structured_safe;
  end if;

  if new.risk_level='low' and structured_safe then
    perform public.enqueue_automation_job(
      new.client_id,new.project_id,'website_apply_change_request',
      'change-request:'||new.id::text||':apply:v2',
      jsonb_build_object(
        'execution_target','edge',
        'change_request_id',new.id,
        'requires_external_worker',true,
        'risk_level',new.risk_level,
        'structured_safe',true
      ),
      now(),40
    );
    update public.website_change_requests
    set status='queued',
        automation_plan=jsonb_build_object('route','automatic_structured_safe_branch','risk_level',new.risk_level,'structured_safe',true),
        last_error=null,
        updated_at=now()
    where id=new.id;
  else
    perform public.enqueue_automation_job(
      new.client_id,new.project_id,'classify_website_change_request',
      'change-request:'||new.id::text||':classify:v3',
      jsonb_build_object(
        'execution_target','ai',
        'change_request_id',new.id,
        'requires_ai_worker',true,
        'risk_level',new.risk_level,
        'structured_safe',structured_safe,
        'reason',case when new.risk_level<>'low' then 'risk_review_required' else 'unstructured_request_requires_classification' end
      ),
      now(),35
    );
    update public.website_change_requests
    set status='classifying',
        automation_plan=jsonb_build_object(
          'route','classification_required',
          'risk_level',new.risk_level,
          'structured_safe',structured_safe,
          'reason',case when new.risk_level<>'low' then 'risk_review_required' else 'unstructured_request_requires_classification' end
        ),
        last_error=null,
        updated_at=now()
    where id=new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.route_submitted_change_request() from public,anon,authenticated;

comment on function public.route_submitted_change_request() is
  'Routes only wholly allowlisted, correctly typed, low-risk structured patches to deterministic Edge work; mixed, malformed, unstructured, and higher-risk requests require classification.';
