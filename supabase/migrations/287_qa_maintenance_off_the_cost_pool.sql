-- 287: promoted from draft 05 on 2026-11-04 (owner chose option C in chat); NOT applied until the owner approves the guarded run.
-- Disposable QA clients' maintenance must not draw from the shared monthly platform cost pool.
-- Why (found 2026-11-04): migration 246's nxq_guard_maintenance_transition() reserves 1 cent from the shared pool every time a maintenance task of a
-- QA-only client starts running. On 2026-11-01 the leftover disposable QA clients made 500 attempts in the first hour of the month, which used the
-- whole 500-cent monthly cap, so every later paid job of a QA run (prepare_build_plan, provisioning...) was refused with
-- "PLATFORM_COST_BLOCKER: monthly platform cost limit reached" and the first measured approve QA run stalled before building anything. It would recur on the
-- 1st of every month. Nothing real is behind those cents: QA traffic has no paid provider.
--
-- What this changes (only QA-only clients; real clients keep exactly their old path, which never used this pool for maintenance anyway):
--  * the reservation estimate is 0 cents instead of 1, so QA maintenance no longer fills the pool;
--  * a full pool (PLATFORM_COST_BLOCKER) no longer stops a QA client's maintenance task;
--  * every OTHER check inside nxq_authorize_paid_capability still applies to QA clients (a stopped, denied or unentitled QA client is still refused).
-- Same trigger, same privileges; only the function body changes.
create or replace function public.nxq_guard_maintenance_transition()
returns trigger language plpgsql security definer set search_path=public as $$
declare is_qa boolean;
begin
  if new.status='running' and old.status is distinct from 'running' then
    select coalesce(c.qa_only,false) into is_qa from public.clients c where c.id=new.client_id;
    if coalesce(is_qa,false) then
      begin
        perform public.nxq_authorize_paid_capability(new.client_id,'technical_maintenance',
          jsonb_build_object('automation_jobs',1,'bandwidth_bytes',2097152),0,
          'maintenance:'||new.id::text||':attempt:'||(old.attempts+1)::text,
          jsonb_build_object('task_id',new.id,'task_type',new.task_type));
      exception when others then
        -- Only the shared pool is excused; any other refusal (lifecycle, entitlement, ...) must still surface.
        if sqlerrm !~ 'PLATFORM_COST_BLOCKER' then raise; end if;
      end;
    else
      perform public.nxq_authorize_paid_capability(new.client_id,'technical_maintenance',
        jsonb_build_object('automation_jobs',1,'bandwidth_bytes',2097152),1,
        'maintenance:'||new.id::text||':attempt:'||(old.attempts+1)::text,
        jsonb_build_object('task_id',new.id,'task_type',new.task_type));
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.nxq_guard_maintenance_transition() from public,anon,authenticated,service_role;
