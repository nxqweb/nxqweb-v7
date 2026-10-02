-- Automatic dispatcher for Business SEO artifact generation.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.dispatch_business_seo_artifacts()
returns jsonb
language plpgsql
security definer
set search_path=public,vault,net
as $$
declare
  worker_url text;
  worker_token text;
  due_count integer:=0;
  request_id bigint;
begin
  select count(*) into due_count
  from public.automation_jobs j
  where j.execution_target='edge'
    and j.job_type='website_project_seo_refresh'
    and j.status in ('queued','failed')
    and j.run_after<=now()
    and j.attempts<j.max_attempts;

  if due_count=0 then return jsonb_build_object('ok',true,'due_jobs',0,'dispatched',false); end if;

  select decrypted_secret into worker_url from vault.decrypted_secrets where name='nxq_business_seo_edge_url' order by created_at desc limit 1;
  select decrypted_secret into worker_token from vault.decrypted_secrets where name='nxq_automation_worker_token' order by created_at desc limit 1;

  if nullif(btrim(worker_url),'') is null or nullif(btrim(worker_token),'') is null then
    return jsonb_build_object('ok',false,'configured',false,'reason','business_seo_worker_vault_config_missing','due_jobs',due_count);
  end if;

  select net.http_post(
    url:=worker_url,
    headers:=jsonb_build_object('Content-Type','application/json','x-nxq-worker-token',worker_token),
    body:=jsonb_build_object('source','nxq_business_seo_cron','requested_at',now())
  ) into request_id;

  insert into public.automation_audit_log(event_type,actor_type,details)
  values('business_seo_dispatch_requested','backend',jsonb_build_object('request_id',request_id,'due_jobs',due_count));

  return jsonb_build_object('ok',true,'configured',true,'due_jobs',due_count,'dispatched',true,'request_id',request_id);
end;
$$;

revoke all on function public.dispatch_business_seo_artifacts() from public,anon,authenticated;
grant execute on function public.dispatch_business_seo_artifacts() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='nxq-business-seo-artifacts-every-minute') then perform cron.unschedule('nxq-business-seo-artifacts-every-minute'); end if;
end $$;
select cron.schedule('nxq-business-seo-artifacts-every-minute','* * * * *',$$select public.dispatch_business_seo_artifacts();$$);

comment on function public.dispatch_business_seo_artifacts() is 'Wakes Business SEO artifact generation only when due jobs exist. Endpoint and worker token remain in Vault.';
