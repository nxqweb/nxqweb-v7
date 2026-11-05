-- Wave 11: keep low-risk client change requests synchronized with their exact website automation run.

create or replace function public.sync_change_request_from_website_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  target_status text;
begin
  if tg_op='UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  target_status := case new.status
    when 'preview_ready' then 'preview_ready'
    when 'published' then 'published'
    when 'failed' then 'failed'
    when 'cancelled' then 'failed'
    else null
  end;

  if target_status is null then
    return new;
  end if;

  update public.website_change_requests r
  set status=target_status,
      last_error=case
        when target_status='failed' then coalesce(r.last_error,'Website automation run failed or was cancelled before the requested change could publish.')
        else null
      end,
      automation_plan=coalesce(r.automation_plan,'{}'::jsonb)||jsonb_build_object(
        'website_automation_run_id',new.id,
        'run_status',new.status,
        'source_branch',new.source_branch,
        'synced_at',now()
      ),
      updated_at=now()
  where r.client_id=new.client_id
    and r.project_id=new.project_id
    and r.automation_plan->>'website_automation_run_id'=new.id::text
    and r.status not in ('published','cancelled');

  return new;
end;
$$;

drop trigger if exists sync_change_request_from_website_run on public.website_automation_runs;
create trigger sync_change_request_from_website_run
after insert or update of status on public.website_automation_runs
for each row execute function public.sync_change_request_from_website_run();

revoke all on function public.sync_change_request_from_website_run() from public,anon,authenticated;

comment on function public.sync_change_request_from_website_run() is 'Synchronizes a low-risk website change request with the exact automation run bound by the protected change worker, including preview, publish, and failure outcomes.';
