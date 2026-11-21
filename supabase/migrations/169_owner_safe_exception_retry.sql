-- Owner exception actions: retry is allowed, force-success is not.
create or replace function public.owner_retry_automation_exception(target_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  job_row public.automation_jobs%rowtype;
begin
  if not exists(select 1 from public.owner_users where auth_user_id=auth.uid()) then
    raise exception 'Owner access required.';
  end if;

  select * into job_row from public.automation_jobs where id=target_job_id for update;
  if not found then raise exception 'Automation job not found.'; end if;
  if job_row.status not in ('failed','blocked') then raise exception 'Only failed or blocked jobs can be retried from the Exception Center.'; end if;

  -- Retrying never bypasses automation governance or worker safety checks. The worker must reclaim
  -- and independently revalidate client status, approval, provider state, and publication invariants.
  update public.automation_jobs
  set status='queued',attempts=0,run_after=now(),last_error=null,locked_at=null,locked_by=null,completed_at=null
  where id=target_job_id;

  insert into public.automation_audit_log(client_id,project_id,automation_job_id,event_type,actor_type,details)
  values(job_row.client_id,job_row.project_id,job_row.id,'owner_exception_retry_requested','owner',jsonb_build_object('job_type',job_row.job_type,'execution_target',job_row.execution_target,'previous_status',job_row.status,'previous_attempts',job_row.attempts));

  return jsonb_build_object('ok',true,'job_id',job_row.id,'status','queued','execution_target',job_row.execution_target,'force_success',false);
end;
$$;
revoke all on function public.owner_retry_automation_exception(uuid) from public,anon;
grant execute on function public.owner_retry_automation_exception(uuid) to authenticated;
comment on function public.owner_retry_automation_exception(uuid) is 'Owner-only safe retry. Never marks work successful; it only requeues so normal safety checks run again.';