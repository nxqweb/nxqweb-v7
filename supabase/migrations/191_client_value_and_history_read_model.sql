-- Tenant-derived client history. Reports recorded work only; never estimates ROI or savings.
create or replace function public.current_client_value_history()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  client_row public.clients%rowtype; project_uuid uuid;
  published_deployments integer:=0; completed_maintenance integer:=0; published_changes integer:=0;
  delivered_reports integer:=0; recorded_payments integer:=0;
  events jsonb:='[]'::jsonb; payments jsonb:='[]'::jsonb;
begin
  select * into client_row from public.clients where auth_user_id=auth.uid() order by created_at desc limit 1;
  if not found then raise exception 'Client account not found.'; end if;
  select id into project_uuid from public.projects where client_id=client_row.id order by created_at desc limit 1;
  select count(*) into published_deployments from public.project_deployments where client_id=client_row.id and status='published';
  select count(*) into completed_maintenance from public.website_maintenance_tasks where client_id=client_row.id and status='completed';
  select count(*) into published_changes from public.website_change_requests where client_id=client_row.id and status='published';
  select count(*) into delivered_reports from public.client_monthly_business_reports where client_id=client_row.id and status in ('ready','delivered','archived');
  select count(*) into recorded_payments from public.payment_records where client_id=client_row.id;

  select coalesce(jsonb_agg(event order by occurred_at desc),'[]'::jsonb) into events from (
    select occurred_at,jsonb_build_object('key',event_key,'category',category,'title',title,'detail',detail,'status',status,'occurred_at',occurred_at,'href',href) event
    from (
      select 'client-created:'||client_row.id::text event_key,'account'::text category,'NXQ Web workspace created'::text title,'Your secure client workspace was created.'::text detail,'complete'::text status,client_row.created_at occurred_at,'/client'::text href
      union all
      select 'approval:'||a.id::text,'approval',case when a.status::text='accepted' then 'Website setup approved' else 'Website setup decision recorded' end,case when a.status::text='accepted' then 'NXQ approved the setup and released the protected automation path.' else 'The website setup was '||replace(a.status::text,'_',' ')||'.' end,a.status::text,coalesce(a.resolved_at,a.created_at),'/client/journey' from public.owner_approval_requests a where a.client_id=client_row.id and a.request_type='website_setup_review' and a.status::text in ('accepted','denied')
      union all
      select 'deployment:'||d.id::text,'deployment',case when d.deploy_kind='production' then 'Production website published' else 'Protected preview published' end,case when d.deploy_kind='production' then 'NXQ recorded a verified production deployment.' else 'NXQ recorded a protected preview deployment.' end,d.status,coalesce(d.completed_at,d.created_at),case when d.deploy_kind='production' then '/client/health' else '/client/journey' end from public.project_deployments d where d.client_id=client_row.id and d.status='published'
      union all
      select 'maintenance:'||t.id::text,'maintenance',initcap(replace(t.task_type,'_',' '))||' completed','NXQ recorded a completed website care task.',t.status,coalesce(t.completed_at,t.updated_at,t.created_at),'/client/health' from public.website_maintenance_tasks t where t.client_id=client_row.id and t.status='completed'
      union all
      select 'change:'||r.id::text,'change','Website update published',r.title,r.status,coalesce(r.completed_at,r.updated_at,r.created_at),'/client/business/changes' from public.website_change_requests r where r.client_id=client_row.id and r.status='published'
      union all
      select 'report:'||r.id::text,'report','Monthly value report '||replace(r.status,'_',' '),to_char(r.report_month,'FMMonth YYYY')||' website evidence is available.',r.status,coalesce(r.delivered_at,r.generated_at,r.updated_at,r.created_at),'/client/business/reports' from public.client_monthly_business_reports r where r.client_id=client_row.id and r.status in ('ready','delivered','archived')
      union all
      select 'payment:'||p.id::text,'billing','Payment record added',trim(to_char(p.amount,'FM999999990.00'))||' '||upper(p.currency)||' · '||replace(p.status,'_',' '),p.status,p.created_at,'/client/billing' from public.payment_records p where p.client_id=client_row.id
    ) raw_events order by occurred_at desc limit 120
  ) history;

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'provider',p.provider,'status',p.status,'amount',p.amount,'currency',upper(p.currency),'recorded_at',p.created_at) order by p.created_at desc),'[]'::jsonb)
  into payments from public.payment_records p where p.client_id=client_row.id;
  return jsonb_build_object('client_id',client_row.id,'project_id',project_uuid,'business_name',client_row.business_name,'summary',jsonb_build_object('published_deployments',published_deployments,'completed_maintenance',completed_maintenance,'published_changes',published_changes,'delivered_reports',delivered_reports,'recorded_payments',recorded_payments),'events',events,'payments',payments,'claims_policy','recorded_evidence_only','generated_at',now());
end; $$;
revoke all on function public.current_client_value_history() from public,anon;
grant execute on function public.current_client_value_history() to authenticated,service_role;
comment on function public.current_client_value_history() is 'Tenant-derived history and payment list without invented ROI, savings, invoice, or receipt claims.';
